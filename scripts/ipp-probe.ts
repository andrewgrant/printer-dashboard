/**
 * Phase 0 diagnostic — query a printer via IPP (port 631) to see what status
 * data is available. Used for SNMP-less devices (Canon SELPHY).
 *
 *   npx tsx scripts/ipp-probe.ts 192.168.0.186
 *   npx tsx scripts/ipp-probe.ts http://192.168.0.186:631/ipp/print
 */

// @ts-expect-error no types for 'ipp'
import ipp from 'ipp';

interface IppValue {
  [key: string]: unknown;
}
interface IppResponse {
  statusCode?: string;
  'printer-attributes-tag'?: IppValue;
  [tag: string]: IppValue | string | undefined;
}

function printerUrl(arg: string): string {
  if (arg.startsWith('http://') || arg.startsWith('https://')) return arg;
  return `http://${arg}:631/ipp/print`;
}

async function getAttrs(url: string): Promise<IppResponse> {
  return new Promise((resolve, reject) => {
    const printer = new ipp.Printer(url);
    const msg = {
      'operation-attributes-tag': {
        'attributes-charset': 'utf-8',
        'attributes-natural-language': 'en-us',
        'requested-attributes': [
          'printer-name',
          'printer-state',
          'printer-state-reasons',
          'printer-state-message',
          'printer-is-accepting-jobs',
          'printer-up-time',
          'printer-make-and-model',
          'printer-info',
          'printer-location',
          'device-uuid',
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
        ],
      },
    };
    printer.execute('Get-Printer-Attributes', msg, (err: unknown, res: IppResponse) => {
      if (err) return reject(err);
      resolve(res);
    });
  });
}

const PRINTER_STATE_NAMES: Record<number, string> = {
  3: 'idle',
  4: 'processing',
  5: 'stopped',
};

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    console.error('usage: ipp-probe.ts <ip-or-url>');
    process.exit(2);
  }
  const url = printerUrl(arg);
  console.log(`IPP probe: ${url}`);

  try {
    const res = await getAttrs(url);
    const attrs = (res['printer-attributes-tag'] ?? {}) as Record<string, unknown>;

    console.log(`\nstatusCode: ${res.statusCode ?? '?'}`);
    console.log('\nkey attributes:');
    const keys = [
      'printer-name',
      'printer-make-and-model',
      'printer-info',
      'printer-location',
      'printer-state',
      'printer-state-reasons',
      'printer-state-message',
      'printer-is-accepting-jobs',
      'printer-up-time',
      'device-uuid',
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
    for (const k of keys) {
      if (attrs[k] === undefined) continue;
      let v = attrs[k];
      if (k === 'printer-state' && typeof v === 'number') v = `${v} (${PRINTER_STATE_NAMES[v] ?? '?'})`;
      console.log(`  ${k.padEnd(30)} ${JSON.stringify(v)}`);
    }

    console.log('\nall returned attribute keys:');
    console.log('  ' + Object.keys(attrs).sort().join('\n  '));
  } catch (err) {
    console.error(`IPP probe failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}

main();
