// @ts-expect-error no types for 'ipp'
import ipp from 'ipp';
import type { Adapter, AdapterOpts, PartialSnapshot, PrinterStatus, Supply, SupplyState } from '../types.js';
import { guessColorant } from './snmp.js';

const PRINTER_STATE_TO_STATUS: Record<string, PrinterStatus> = {
  idle: 'online',
  processing: 'online',
  stopped: 'warning',
};

interface IppAttrs {
  'printer-name'?: string;
  'printer-make-and-model'?: string;
  'printer-state'?: string;
  'printer-state-reasons'?: string | string[];
  'printer-state-message'?: string;
  'printer-is-accepting-jobs'?: boolean;
  'marker-names'?: string | string[];
  'marker-levels'?: number | number[];
  'marker-high-levels'?: number | number[];
  'marker-low-levels'?: number | number[];
  'marker-colors'?: string | string[];
  'marker-types'?: string | string[];
  'printer-supply'?: string | string[];
  'printer-supply-description'?: string | string[];
  'job-media-sheets-completed'?: number;
  'printer-pages-completed'?: number;
}

const REQUESTED_ATTRIBUTES = [
  'printer-name',
  'printer-make-and-model',
  'printer-state',
  'printer-state-reasons',
  'printer-state-message',
  'printer-is-accepting-jobs',
  'marker-names',
  'marker-levels',
  'marker-high-levels',
  'marker-low-levels',
  'marker-colors',
  'marker-types',
  'printer-supply',
  'printer-supply-description',
  'job-media-sheets-completed',
  'printer-pages-completed',
];

function toArr<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function buildPrinterUrl(ip: string): string {
  return `http://${ip}:631/ipp/print`;
}

/** Pure transform — exposed for unit tests with canned IPP attribute objects. */
export function buildSnapshotFromAttrs(attrs: IppAttrs): PartialSnapshot {
  const snap: PartialSnapshot = { adapter: 'ipp', ok: true };

  snap.name = attrs['printer-name'];
  snap.model = attrs['printer-make-and-model'];

  const stateStr = attrs['printer-state'];
  if (stateStr) {
    snap.printerStatus = stateStr;
    snap.status = PRINTER_STATE_TO_STATUS[stateStr] ?? 'unknown';
  }
  if (attrs['printer-is-accepting-jobs'] === false && snap.status !== 'warning') {
    snap.status = 'warning';
  }

  const reasons = toArr(attrs['printer-state-reasons']).filter((r) => r && r !== 'none');
  if (reasons.length > 0) {
    snap.statusMessage = reasons.join(', ');
    if (reasons.some((r) => r.endsWith('-error') || r === 'media-empty' || r === 'toner-empty')) {
      snap.status = 'warning';
    }
  }

  if (typeof attrs['printer-pages-completed'] === 'number') {
    snap.pageCount = attrs['printer-pages-completed'];
  } else if (typeof attrs['job-media-sheets-completed'] === 'number') {
    snap.pageCount = attrs['job-media-sheets-completed'];
  }

  const names = toArr(attrs['marker-names']);
  const levels = toArr(attrs['marker-levels']);
  const highs = toArr(attrs['marker-high-levels']);

  const supplies: Supply[] = [];
  for (let i = 0; i < names.length; i++) {
    const name = String(names[i] ?? '');
    const level = Number(levels[i] ?? -2);
    const high = Number(highs[i] ?? 100);
    // IPP convention: -1 = supply low-warning, -2 = unknown, -3 = not supported
    let levelPercent: number | null;
    if (!Number.isFinite(level) || level < 0) levelPercent = null;
    else if (high > 0) levelPercent = Math.round((level / high) * 100);
    else levelPercent = null;
    const state: SupplyState = levelPercent === null
      ? 'unknown'
      : levelPercent <= 0
        ? 'empty'
        : levelPercent <= 10
          ? 'veryLow'
          : levelPercent <= 25
            ? 'low'
            : 'ok';
    supplies.push({
      colorant: guessColorant(name),
      label: name,
      levelPercent,
      state,
    });
  }
  snap.supplies = supplies;

  return snap;
}

interface IppGetMsg {
  'operation-attributes-tag': Record<string, unknown>;
}

interface IppPrinterClient {
  execute(
    op: string,
    msg: IppGetMsg,
    cb: (err: Error | null, res: { 'printer-attributes-tag'?: IppAttrs }) => void,
  ): void;
}

function buildGetAttrsMsg(): IppGetMsg {
  return {
    'operation-attributes-tag': {
      'attributes-charset': 'utf-8',
      'attributes-natural-language': 'en-us',
      'requested-attributes': REQUESTED_ATTRIBUTES,
    },
  };
}

async function getPrinterAttrs(ip: string, timeoutMs: number): Promise<IppAttrs> {
  const client = new (ipp as { Printer: new (url: string) => IppPrinterClient }).Printer(
    buildPrinterUrl(ip),
  );
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('IPP request timed out')), timeoutMs);
    client.execute('Get-Printer-Attributes', buildGetAttrsMsg(), (err, res) => {
      clearTimeout(timer);
      if (err) return reject(err);
      resolve(res['printer-attributes-tag'] ?? {});
    });
  });
}

export const ippAdapter: Adapter = {
  name: 'ipp',

  async detect(ip, opts) {
    try {
      const attrs = await getPrinterAttrs(ip, Math.min(opts.httpTimeoutMs, 3000));
      return Boolean(attrs['printer-state'] || attrs['printer-name']);
    } catch {
      return false;
    }
  },

  async fetch(ip, opts) {
    try {
      const attrs = await getPrinterAttrs(ip, opts.httpTimeoutMs);
      return buildSnapshotFromAttrs(attrs);
    } catch (err) {
      return {
        adapter: 'ipp',
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
