import snmp, { type Session, type Varbind } from 'net-snmp';
import type { Adapter, PartialSnapshot, Supply, SupplyState, PrinterStatus } from '../types.js';

const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  hrDeviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',
  hrPrinterStatus: '1.3.6.1.2.1.25.3.5.1.1.1',
  hrPrinterDetectedErrorState: '1.3.6.1.2.1.25.3.5.1.2.1',
  prtMarkerLifeCount: '1.3.6.1.2.1.43.10.2.1.4.1.1',
  prtMarkerSuppliesDescription: '1.3.6.1.2.1.43.11.1.1.6',
  prtMarkerSuppliesMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8',
  prtMarkerSuppliesLevel: '1.3.6.1.2.1.43.11.1.1.9',
} as const;

const DEVICE_STATUS: Record<number, string> = {
  1: 'unknown',
  2: 'running',
  3: 'warning',
  4: 'testing',
  5: 'down',
};

const PRINTER_STATUS: Record<number, string> = {
  1: 'other',
  2: 'unknown',
  3: 'idle',
  4: 'printing',
  5: 'warmup',
};

function decodeString(v: unknown): string {
  if (v instanceof Uint8Array || Buffer.isBuffer(v)) {
    return Buffer.from(v).toString('utf8').replace(/\u0000+$/, '').trim();
  }
  return typeof v === 'string' ? v : String(v);
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function indexFromOid(oid: string, rootOid: string): number {
  const tail = oid.slice(rootOid.length + 1).split('.');
  return Number(tail[tail.length - 1]);
}

/** Normalize a printer-supplied description into a standard colorant label. */
export function guessColorant(description: string): Supply['colorant'] {
  const d = description.toLowerCase();
  if (d.includes('tri-color') || d.includes('tri color') || d.includes('cmy')) return 'color';
  if (d.includes('cyan')) return 'cyan';
  if (d.includes('magenta')) return 'magenta';
  if (d.includes('yellow')) return 'yellow';
  if (d.includes('black') || d.includes('noir')) return 'black';
  if (d.includes('photo')) return 'photo';
  // Bare "Color" (e.g. Canon SELPHY dye-sub ribbon) → multi-color ribbon.
  if (/\bcolor\b/.test(d)) return 'color';
  return 'other';
}

export function supplyStateFromPercent(pct: number | null): SupplyState {
  if (pct === null) return 'unknown';
  if (pct <= 0) return 'empty';
  if (pct <= 10) return 'veryLow';
  if (pct <= 25) return 'low';
  return 'ok';
}

export function deviceStatusToPrinterStatus(code: number | null): PrinterStatus {
  if (code === null) return 'unknown';
  if (code === 2) return 'online';
  if (code === 3 || code === 4) return 'warning';
  if (code === 5) return 'offline';
  return 'unknown';
}

interface SnmpSupplyRow {
  index: number;
  description?: string;
  max?: number;
  level?: number;
}

/**
 * Pure transform: varbinds -> PartialSnapshot.
 * Separated from the network call so it can be unit-tested with canned data.
 */
export function buildSnapshotFromVarbinds(varbinds: Map<string, unknown>): PartialSnapshot {
  const snap: PartialSnapshot = { adapter: 'snmp', ok: true };

  const sysDescr = varbinds.get(OID.sysDescr);
  if (sysDescr !== undefined) snap.model = decodeString(sysDescr);

  const sysName = varbinds.get(OID.sysName);
  if (sysName !== undefined) snap.name = decodeString(sysName);

  const devStatusNum = toNumber(varbinds.get(OID.hrDeviceStatus));
  if (devStatusNum !== null) {
    snap.deviceStatus = DEVICE_STATUS[devStatusNum] ?? `code ${devStatusNum}`;
    snap.status = deviceStatusToPrinterStatus(devStatusNum);
  }

  const prtStatusNum = toNumber(varbinds.get(OID.hrPrinterStatus));
  if (prtStatusNum !== null) {
    snap.printerStatus = PRINTER_STATUS[prtStatusNum] ?? `code ${prtStatusNum}`;
  }

  const pageCount = toNumber(varbinds.get(OID.prtMarkerLifeCount));
  if (pageCount !== null) snap.pageCount = pageCount;

  const rows = new Map<number, SnmpSupplyRow>();
  const ensure = (i: number): SnmpSupplyRow => {
    let r = rows.get(i);
    if (!r) {
      r = { index: i };
      rows.set(i, r);
    }
    return r;
  };

  for (const [oid, value] of varbinds) {
    if (oid.startsWith(OID.prtMarkerSuppliesDescription + '.')) {
      const idx = indexFromOid(oid, OID.prtMarkerSuppliesDescription);
      ensure(idx).description = decodeString(value);
    } else if (oid.startsWith(OID.prtMarkerSuppliesMaxCapacity + '.')) {
      const idx = indexFromOid(oid, OID.prtMarkerSuppliesMaxCapacity);
      const n = toNumber(value);
      if (n !== null) ensure(idx).max = n;
    } else if (oid.startsWith(OID.prtMarkerSuppliesLevel + '.')) {
      const idx = indexFromOid(oid, OID.prtMarkerSuppliesLevel);
      const n = toNumber(value);
      if (n !== null) ensure(idx).level = n;
    }
  }

  const supplies: Supply[] = [];
  for (const row of [...rows.values()].sort((a, b) => a.index - b.index)) {
    if (!row.description || row.level === undefined || row.max === undefined) continue;
    // RFC 3805: level<0 indicates unknown (-2) or inactive (-3); level=0 means empty.
    let pct: number | null;
    if (row.level < 0) pct = null;
    else if (row.max > 0) pct = Math.round((row.level / row.max) * 100);
    else pct = null;
    supplies.push({
      colorant: guessColorant(row.description),
      label: row.description,
      levelPercent: pct,
      state: supplyStateFromPercent(pct),
    });
  }
  snap.supplies = supplies;

  return snap;
}

/** net-snmp session wrapper with promise-based get/walk. */
class SnmpSession {
  private readonly session: Session;

  constructor(ip: string, community: string, timeoutMs: number) {
    this.session = snmp.createSession(ip, community, {
      version: snmp.Version2c,
      timeout: timeoutMs,
      retries: 1,
    });
  }

  get(oids: readonly string[]): Promise<Map<string, unknown>> {
    return new Promise((resolve, reject) => {
      const onErr = (err: Error): void => {
        this.session.off('error', onErr);
        reject(err);
      };
      this.session.on('error', onErr);
      this.session.get([...oids], (err: Error | null, varbinds: Varbind[]) => {
        this.session.off('error', onErr);
        if (err) return reject(err);
        const map = new Map<string, unknown>();
        for (const vb of varbinds ?? []) {
          if (!snmp.isVarbindError(vb)) map.set(vb.oid, vb.value);
        }
        resolve(map);
      });
    });
  }

  walk(rootOid: string): Promise<Map<string, unknown>> {
    return new Promise((resolve, reject) => {
      const collected = new Map<string, unknown>();
      this.session.subtree(
        rootOid,
        20,
        (vbs: Varbind[]) => {
          for (const vb of vbs) {
            if (!snmp.isVarbindError(vb)) collected.set(vb.oid, vb.value);
          }
        },
        (err: Error | null) => {
          if (err) return reject(err);
          resolve(collected);
        },
      );
    });
  }

  close(): void {
    this.session.close();
  }
}

export const snmpAdapter: Adapter = {
  name: 'snmp',

  async detect(ip, opts) {
    const session = new SnmpSession(ip, opts.community, Math.min(opts.snmpTimeoutMs, 2000));
    try {
      const res = await session.get([OID.sysDescr]);
      return res.has(OID.sysDescr);
    } catch {
      return false;
    } finally {
      session.close();
    }
  },

  async fetch(ip, opts) {
    const session = new SnmpSession(ip, opts.community, opts.snmpTimeoutMs);
    try {
      const scalars = await session.get([
        OID.sysDescr,
        OID.sysName,
        OID.hrDeviceStatus,
        OID.hrPrinterStatus,
        OID.prtMarkerLifeCount,
      ]);
      const [descVbs, maxVbs, levelVbs] = await Promise.all([
        session.walk(OID.prtMarkerSuppliesDescription),
        session.walk(OID.prtMarkerSuppliesMaxCapacity),
        session.walk(OID.prtMarkerSuppliesLevel),
      ]);
      const merged = new Map<string, unknown>([
        ...scalars,
        ...descVbs,
        ...maxVbs,
        ...levelVbs,
      ]);
      return buildSnapshotFromVarbinds(merged);
    } catch (err) {
      return {
        adapter: 'snmp',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      session.close();
    }
  },
};
