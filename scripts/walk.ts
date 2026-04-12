/**
 * Diagnostic walker — dump an arbitrary SNMP subtree to stdout.
 * Used in Phase 0 to investigate vendor OIDs when the standard Printer MIB
 * returns suspicious values (e.g. HP ENVY 6000 showing 0/100 for all inks).
 *
 *   npx tsx scripts/walk.ts <ip> <oid> [--community public]
 *   npx tsx scripts/walk.ts 192.168.0.159 1.3.6.1.2.1.43.11
 *   npx tsx scripts/walk.ts 192.168.0.159 1.3.6.1.4.1.11.2.3.9
 */

import snmp from 'net-snmp';

function decode(v: unknown): string {
  if (Buffer.isBuffer(v)) {
    const str = v.toString('utf8').replace(/\u0000+$/, '').trim();
    if (/^[\x20-\x7e]*$/.test(str) && str.length > 0) return JSON.stringify(str);
    return `hex:${v.toString('hex')}`;
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

const TYPE_NAMES: Record<number, string> = {
  2: 'INT',
  4: 'OCTSTR',
  5: 'NULL',
  6: 'OID',
  64: 'IPADDR',
  65: 'COUNTER',
  66: 'GAUGE',
  67: 'TIMETICKS',
  70: 'COUNTER64',
};

async function walk(ip: string, community: string, root: string, timeoutMs: number): Promise<number> {
  const session = snmp.createSession(ip, community, {
    version: snmp.Version2c,
    timeout: timeoutMs,
    retries: 1,
  });

  let count = 0;
  return new Promise((resolve, reject) => {
    session.on('error', reject);
    session.subtree(
      root,
      20,
      (vbs) => {
        for (const vb of vbs) {
          if (snmp.isVarbindError(vb)) {
            console.log(`  ${vb.oid}  ERROR  ${snmp.varbindError(vb)}`);
            continue;
          }
          const t = TYPE_NAMES[vb.type] ?? `T${vb.type}`;
          console.log(`  ${vb.oid}  [${t}]  ${decode(vb.value)}`);
          count++;
        }
      },
      (err) => {
        session.close();
        if (err) return reject(err);
        resolve(count);
      },
    );
  });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let community = 'public';
  let timeoutMs = 5000;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === '--community') community = args[++i] ?? 'public';
    else if (a === '--timeout') timeoutMs = Number(args[++i] ?? 5000);
    else positional.push(a);
  }
  const [ip, root] = positional;
  if (!ip || !root) {
    console.error('usage: walk.ts <ip> <oid> [--community X] [--timeout MS]');
    process.exit(2);
  }

  console.log(`walking ${root} on ${ip} (community=${community})`);
  try {
    const n = await walk(ip, community, root, timeoutMs);
    console.log(`\ndone: ${n} varbind(s)`);
  } catch (err) {
    console.error(`walk failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
