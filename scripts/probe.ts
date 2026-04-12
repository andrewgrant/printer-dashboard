/**
 * Phase 0 probe — validates SNMP + mDNS against real printers before any
 * other work. Standalone, no Fastify, no DB, no build step.
 *
 *   npm run probe                          # all defaults + mDNS
 *   npm run probe -- 192.168.0.137         # one printer
 *   npm run probe -- --discover-only       # mDNS only
 *   npm run probe -- --community private   # override community
 *   npm run probe -- --snmp-only           # skip mDNS
 */

import snmp from 'net-snmp';
import { Bonjour } from 'bonjour-service';

// SNMP-capable defaults (the Canon SELPHY at .186 is IPP-only — use ipp-probe.ts for it).
const DEFAULT_TARGETS = ['192.168.0.137', '192.168.0.159'];
const DISCOVERY_WINDOW_MS = 10_000;

const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  hrDeviceStatus: '1.3.6.1.2.1.25.3.2.1.5.1',
  hrPrinterStatus: '1.3.6.1.2.1.25.3.5.1.1.1',
  prtMarkerLifeCount: '1.3.6.1.2.1.43.10.2.1.4.1.1',
  prtMarkerSuppliesDescription: '1.3.6.1.2.1.43.11.1.1.6',
  prtMarkerSuppliesMaxCapacity: '1.3.6.1.2.1.43.11.1.1.8',
  prtMarkerSuppliesLevel: '1.3.6.1.2.1.43.11.1.1.9',
};

const DEVICE_STATUS = { 1: 'unknown', 2: 'running', 3: 'warning', 4: 'testing', 5: 'down' } as const;
const PRINTER_STATUS = { 1: 'other', 2: 'unknown', 3: 'idle', 4: 'printing', 5: 'warmup' } as const;

interface Supply {
  index: number;
  description: string;
  level: number;
  max: number;
  pct: number | null;
}

interface ProbeResult {
  ip: string;
  reachable: boolean;
  sysDescr?: string;
  sysName?: string;
  deviceStatus?: string;
  printerStatus?: string;
  pageCount?: number;
  supplies?: Supply[];
  error?: string;
}

function decode(v: unknown): string {
  if (Buffer.isBuffer(v)) return v.toString('utf8').replace(/\u0000+$/, '').trim();
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

function sessionGet(session: snmp.Session, oids: string[]): Promise<Map<string, snmp.Varbind>> {
  return new Promise((resolve, reject) => {
    session.get(oids, (err, varbinds) => {
      if (err) return reject(err);
      const map = new Map<string, snmp.Varbind>();
      for (const vb of varbinds ?? []) {
        if (snmp.isVarbindError(vb)) continue;
        map.set(vb.oid, vb);
      }
      resolve(map);
    });
  });
}

function walkSubtree(session: snmp.Session, rootOid: string): Promise<snmp.Varbind[]> {
  return new Promise((resolve, reject) => {
    const collected: snmp.Varbind[] = [];
    session.subtree(
      rootOid,
      20,
      (vbs) => {
        for (const vb of vbs) {
          if (!snmp.isVarbindError(vb)) collected.push(vb);
        }
      },
      (err) => {
        if (err) return reject(err);
        resolve(collected);
      },
    );
  });
}

function indexFromOid(oid: string, root: string): number {
  const tail = oid.slice(root.length + 1).split('.');
  return Number(tail[tail.length - 1]);
}

async function probeOne(ip: string, community: string, timeoutMs: number): Promise<ProbeResult> {
  const session = snmp.createSession(ip, community, {
    version: snmp.Version2c,
    timeout: timeoutMs,
    retries: 1,
  });

  const result: ProbeResult = { ip, reachable: false };

  const sessionError = new Promise<never>((_, reject) => {
    session.on('error', reject);
  });

  try {
    const scalars = await Promise.race([
      sessionGet(session, [
        OID.sysDescr,
        OID.sysName,
        OID.hrDeviceStatus,
        OID.hrPrinterStatus,
        OID.prtMarkerLifeCount,
      ]),
      sessionError,
    ]);

    result.reachable = true;
    result.sysDescr = scalars.has(OID.sysDescr) ? decode(scalars.get(OID.sysDescr)!.value) : undefined;
    result.sysName = scalars.has(OID.sysName) ? decode(scalars.get(OID.sysName)!.value) : undefined;

    const devStatusVal = scalars.get(OID.hrDeviceStatus)?.value;
    if (typeof devStatusVal === 'number') {
      result.deviceStatus = DEVICE_STATUS[devStatusVal as keyof typeof DEVICE_STATUS] ?? `code ${devStatusVal}`;
    }

    const prtStatusVal = scalars.get(OID.hrPrinterStatus)?.value;
    if (typeof prtStatusVal === 'number') {
      result.printerStatus = PRINTER_STATUS[prtStatusVal as keyof typeof PRINTER_STATUS] ?? `code ${prtStatusVal}`;
    }

    const pageCountVal = scalars.get(OID.prtMarkerLifeCount)?.value;
    if (typeof pageCountVal === 'number') result.pageCount = pageCountVal;

    const [descVbs, maxVbs, levelVbs] = await Promise.all([
      walkSubtree(session, OID.prtMarkerSuppliesDescription),
      walkSubtree(session, OID.prtMarkerSuppliesMaxCapacity),
      walkSubtree(session, OID.prtMarkerSuppliesLevel),
    ]);

    const supplies = new Map<number, Partial<Supply>>();
    for (const vb of descVbs) {
      const idx = indexFromOid(vb.oid, OID.prtMarkerSuppliesDescription);
      const entry = supplies.get(idx) ?? { index: idx };
      entry.description = decode(vb.value);
      supplies.set(idx, entry);
    }
    for (const vb of maxVbs) {
      const idx = indexFromOid(vb.oid, OID.prtMarkerSuppliesMaxCapacity);
      const entry = supplies.get(idx) ?? { index: idx };
      entry.max = typeof vb.value === 'number' ? vb.value : Number(vb.value);
      supplies.set(idx, entry);
    }
    for (const vb of levelVbs) {
      const idx = indexFromOid(vb.oid, OID.prtMarkerSuppliesLevel);
      const entry = supplies.get(idx) ?? { index: idx };
      entry.level = typeof vb.value === 'number' ? vb.value : Number(vb.value);
      supplies.set(idx, entry);
    }

    result.supplies = [...supplies.values()]
      .filter((s): s is Supply & { description: string; level: number; max: number } =>
        typeof s.description === 'string' && typeof s.level === 'number' && typeof s.max === 'number',
      )
      .map((s) => ({
        index: s.index!,
        description: s.description,
        level: s.level,
        max: s.max,
        pct: s.max > 0 && s.level >= 0 ? Math.round((s.level / s.max) * 100) : null,
      }))
      .sort((a, b) => a.index - b.index);
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  } finally {
    session.close();
  }

  return result;
}

function fmtProbe(r: ProbeResult): string {
  const lines: string[] = [];
  lines.push(`\n── ${r.ip} ──`);
  if (!r.reachable) {
    lines.push(`  UNREACHABLE: ${r.error ?? 'no response'}`);
    return lines.join('\n');
  }
  if (r.sysDescr) lines.push(`  sysDescr:    ${r.sysDescr.slice(0, 100)}`);
  if (r.sysName) lines.push(`  sysName:     ${r.sysName}`);
  if (r.deviceStatus) lines.push(`  device:      ${r.deviceStatus}`);
  if (r.printerStatus) lines.push(`  printer:     ${r.printerStatus}`);
  if (r.pageCount !== undefined) lines.push(`  lifetime:    ${r.pageCount} pages`);
  if (r.supplies && r.supplies.length > 0) {
    lines.push(`  supplies:`);
    for (const s of r.supplies) {
      const pct = s.pct !== null ? `${String(s.pct).padStart(3)}%` : ' n/a';
      lines.push(`    [${s.index}] ${pct}  ${s.description}  (${s.level}/${s.max})`);
    }
  } else {
    lines.push(`  supplies:    (none reported)`);
  }
  return lines.join('\n');
}

interface DiscoveredService {
  type: string;
  name: string;
  host?: string;
  addresses: string[];
  port: number;
  txt?: Record<string, string>;
}

async function discoverMdns(windowMs: number): Promise<DiscoveredService[]> {
  const bonjour = new Bonjour();
  const seen = new Map<string, DiscoveredService>();

  const types = ['ipp', 'printer', 'pdl-datastream'];
  const browsers = types.map((type) => {
    const browser = bonjour.find({ type });
    browser.on('up', (service: {
      type: string;
      name: string;
      host?: string;
      addresses?: string[];
      port: number;
      txt?: Record<string, string>;
    }) => {
      const key = `${service.type}::${service.name}`;
      seen.set(key, {
        type: service.type,
        name: service.name,
        host: service.host,
        addresses: service.addresses ?? [],
        port: service.port,
        txt: service.txt,
      });
    });
    return browser;
  });

  await new Promise((resolve) => setTimeout(resolve, windowMs));

  for (const b of browsers) b.stop();
  bonjour.destroy();

  return [...seen.values()];
}

function fmtDiscovered(services: DiscoveredService[], targets: string[]): string {
  const lines: string[] = [];
  lines.push(`\n── mDNS discovery (${services.length} service${services.length === 1 ? '' : 's'} seen) ──`);
  if (services.length === 0) {
    lines.push('  (nothing advertised on _ipp/_printer/_pdl-datastream)');
  } else {
    for (const s of services) {
      const addrs = s.addresses.filter((a) => !a.includes(':')).join(', ') || '?';
      lines.push(`  _${s.type}._tcp  ${s.name}`);
      lines.push(`    host=${s.host ?? '?'}  addrs=${addrs}  port=${s.port}`);
      if (s.txt && Object.keys(s.txt).length > 0) {
        const hints = ['ty', 'product', 'note', 'rp'].flatMap((k) =>
          s.txt && s.txt[k] ? [`${k}=${s.txt[k]}`] : [],
        );
        if (hints.length > 0) lines.push(`    txt: ${hints.join('  ')}`);
      }
    }
  }

  lines.push(`\n── target-vs-discovery hit check ──`);
  const allAddrs = new Set(services.flatMap((s) => s.addresses));
  for (const ip of targets) {
    lines.push(`  ${allAddrs.has(ip) ? '✓' : '✗'} ${ip}`);
  }
  return lines.join('\n');
}

interface Args {
  targets: string[];
  community: string;
  discoverOnly: boolean;
  snmpOnly: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    targets: [],
    community: 'public',
    discoverOnly: false,
    snmpOnly: false,
    timeoutMs: 3000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--discover-only') out.discoverOnly = true;
    else if (a === '--snmp-only') out.snmpOnly = true;
    else if (a === '--community') out.community = argv[++i] ?? 'public';
    else if (a === '--timeout') out.timeoutMs = Number(argv[++i] ?? 3000);
    else if (a.startsWith('-')) {
      console.error(`unknown flag: ${a}`);
      process.exit(2);
    } else out.targets.push(a);
  }
  if (out.targets.length === 0) out.targets = DEFAULT_TARGETS;
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log('printer-dashboard probe');
  console.log(`  targets:   ${args.targets.join(', ')}`);
  console.log(`  community: ${args.community}`);
  console.log(`  mode:      ${args.discoverOnly ? 'mDNS only' : args.snmpOnly ? 'SNMP only' : 'SNMP + mDNS'}`);

  let snmpFailures = 0;

  if (!args.discoverOnly) {
    console.log('\n[1/2] SNMP probe');
    const results = await Promise.all(args.targets.map((ip) => probeOne(ip, args.community, args.timeoutMs)));
    for (const r of results) {
      console.log(fmtProbe(r));
      if (!r.reachable) snmpFailures++;
    }
  }

  if (!args.snmpOnly) {
    console.log(`\n[2/2] mDNS discovery (${DISCOVERY_WINDOW_MS / 1000}s window)`);
    const services = await discoverMdns(DISCOVERY_WINDOW_MS);
    console.log(fmtDiscovered(services, args.targets));
  }

  console.log();
  if (snmpFailures > 0) {
    console.error(`FAIL: ${snmpFailures}/${args.targets.length} printer(s) unreachable via SNMP`);
    process.exit(1);
  }
  console.log('OK');
}

main().catch((err) => {
  console.error('probe crashed:', err);
  process.exit(1);
});
