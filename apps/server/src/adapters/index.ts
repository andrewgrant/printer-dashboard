import type {
  Adapter,
  AdapterName,
  AdapterOpts,
  PartialSnapshot,
  PrinterSnapshot,
  PrinterStatus,
  Supply,
} from '../types.js';
import { snmpAdapter } from './snmp.js';
import { ledmAdapter } from './ledm.js';
import { ippAdapter } from './ipp.js';

export const ALL_ADAPTERS: readonly Adapter[] = [snmpAdapter, ledmAdapter, ippAdapter];

const ADAPTER_BY_NAME: Record<AdapterName, Adapter> = {
  snmp: snmpAdapter,
  ledm: ledmAdapter,
  ipp: ippAdapter,
};

/** Precedence for fields that multiple adapters may supply. Higher index wins. */
const SOURCE_PRIORITY: Record<AdapterName, number> = {
  ipp: 1,
  snmp: 2,
  ledm: 3,
};

/** Run detection in parallel and return the set of adapters that responded. */
export async function detectAdapters(
  ip: string,
  opts: AdapterOpts,
  adapters: readonly Adapter[] = ALL_ADAPTERS,
): Promise<AdapterName[]> {
  const detections = await Promise.all(
    adapters.map(async (a) => ({ name: a.name, ok: await a.detect(ip, opts).catch(() => false) })),
  );
  return detections.filter((d) => d.ok).map((d) => d.name);
}

/** Run a specific set of adapters in parallel and return their raw partials. */
export async function fetchPartials(
  ip: string,
  names: readonly AdapterName[],
  opts: AdapterOpts,
): Promise<PartialSnapshot[]> {
  const adapters = names.map((n) => ADAPTER_BY_NAME[n]);
  return Promise.all(adapters.map((a) => a.fetch(ip, opts)));
}

/** Merge partials by precedence. Higher priority overrides lower. */
export function mergePartials(partials: readonly PartialSnapshot[]): PrinterSnapshot {
  // Sort ascending by priority, so later writes in the loop win.
  const ordered = [...partials]
    .filter((p) => p.ok)
    .sort((a, b) => SOURCE_PRIORITY[a.adapter] - SOURCE_PRIORITY[b.adapter]);

  const snap: PrinterSnapshot = {
    takenAt: Date.now(),
    status: 'unknown',
    supplies: [],
    sources: ordered.map((p) => p.adapter),
  };

  for (const p of ordered) {
    if (p.model !== undefined) snap.model = p.model;
    if (p.name !== undefined) snap.name = p.name;
    if (p.deviceStatus !== undefined) snap.deviceStatus = p.deviceStatus;
    if (p.printerStatus !== undefined) snap.printerStatus = p.printerStatus;
    if (p.statusMessage !== undefined) snap.statusMessage = p.statusMessage;
    if (p.status !== undefined) snap.status = p.status;
    if (p.pageCount !== undefined) snap.pageCount = p.pageCount;
    if (p.pageCountColor !== undefined) snap.pageCountColor = p.pageCountColor;
    if (p.pageCountMono !== undefined) snap.pageCountMono = p.pageCountMono;
    if (p.supplies !== undefined && p.supplies.length > 0) snap.supplies = p.supplies;
  }

  if (ordered.length === 0) {
    const errors = partials
      .filter((p) => !p.ok)
      .map((p) => `${p.adapter}: ${p.error ?? 'unknown error'}`)
      .join('; ');
    snap.status = 'offline';
    snap.statusMessage = errors || 'all adapters failed';
  }

  return snap;
}

/** Full run: use the recorded adapter set (or all of them) and merge. */
export async function runAdapters(
  ip: string,
  opts: AdapterOpts,
  recordedAdapters?: readonly AdapterName[],
): Promise<{ snapshot: PrinterSnapshot; partials: PartialSnapshot[] }> {
  const names = recordedAdapters ?? (await detectAdapters(ip, opts));
  if (names.length === 0) {
    return {
      snapshot: {
        takenAt: Date.now(),
        status: 'offline',
        supplies: [],
        sources: [],
        statusMessage: 'no adapter could reach this printer',
      },
      partials: [],
    };
  }
  const partials = await fetchPartials(ip, names, opts);
  return { snapshot: mergePartials(partials), partials };
}
