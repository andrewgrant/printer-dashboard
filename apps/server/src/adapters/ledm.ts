import { XMLParser } from 'fast-xml-parser';
import { request } from 'undici';
import type { Adapter, AdapterOpts, PartialSnapshot, Supply, SupplyState } from '../types.js';

const PATHS = {
  consumables: '/DevMgmt/ConsumableConfigDyn.xml',
  usage: '/DevMgmt/ProductUsageDyn.xml',
  config: '/DevMgmt/ProductConfigDyn.xml',
} as const;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

const LABEL_CODE_TO_COLORANT: Record<string, Supply['colorant']> = {
  C: 'cyan',
  M: 'magenta',
  Y: 'yellow',
  K: 'black',
  CMY: 'color',
  CMYK: 'color',
};

const LABEL_CODE_NAME: Record<string, string> = {
  C: 'Cyan',
  M: 'Magenta',
  Y: 'Yellow',
  K: 'Black',
  CMY: 'Tri-color',
  CMYK: 'Tri-color',
};

const STATE_MAP: Record<string, SupplyState> = {
  ok: 'ok',
  low: 'low',
  veryLow: 'veryLow',
  exhausted: 'empty',
  outOfInk: 'empty',
  missing: 'unknown',
  unknown: 'unknown',
};

export function mapMeasuredQuantityState(raw: string | undefined): SupplyState {
  if (!raw) return 'unknown';
  return STATE_MAP[raw] ?? 'unknown';
}

function toArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function firstNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (v && typeof v === 'object' && '#text' in v) {
    const n = Number((v as { '#text': unknown })['#text']);
    return Number.isFinite(n) ? n : undefined;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function text(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && '#text' in v) {
    return String((v as { '#text': unknown })['#text']);
  }
  return undefined;
}

/**
 * Parse the LEDM ConsumableConfigDyn.xml payload into a list of supplies.
 * Exported for unit testing against captured fixtures.
 */
export function parseConsumables(xml: string): Supply[] {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.ConsumableConfigDyn as Record<string, unknown> | undefined;
  if (!root) return [];
  const infos = toArray(root.ConsumableInfo as unknown);

  const supplies: Supply[] = [];
  for (const info of infos as Record<string, unknown>[]) {
    const typeEnum = text(info.ConsumableTypeEnum);
    // HP uses "ink" on enterprise models, "inkCartridge" on consumer ones.
    // Skip printheads and anything else; we only care about user-replaceable inks/toners.
    const isInk =
      typeEnum === 'ink' ||
      typeEnum === 'inkCartridge' ||
      typeEnum === 'toner' ||
      typeEnum === 'tonerCartridge';
    if (!isInk) continue;

    const labelCode = text(info.ConsumableLabelCode) ?? '';
    const pctRaw = firstNumber(info.ConsumablePercentageLevelRemaining);
    const lifeState = info.ConsumableLifeState as Record<string, unknown> | undefined;
    const measured = lifeState ? text(lifeState.MeasuredQuantityState) : undefined;

    const colorant = LABEL_CODE_TO_COLORANT[labelCode] ?? 'other';
    const labelName = LABEL_CODE_NAME[labelCode] ?? (labelCode || 'Ink');
    const levelPercent = pctRaw !== undefined && pctRaw >= 0 ? pctRaw : null;

    let state = mapMeasuredQuantityState(measured);
    if (state === 'unknown' && levelPercent !== null) {
      if (levelPercent <= 0) state = 'empty';
      else if (levelPercent <= 10) state = 'veryLow';
      else if (levelPercent <= 25) state = 'low';
      else state = 'ok';
    }

    supplies.push({
      colorant,
      label: labelName,
      levelPercent,
      state,
    });
  }
  return supplies;
}

export interface UsageCounts {
  pageCount?: number;
  pageCountColor?: number;
  pageCountMono?: number;
}

/**
 * Parse ProductUsageDyn.xml. The file has many TotalImpressions across
 * subunits (scan, fax, print); we want the PrinterSubunit totals.
 */
export function parseUsage(xml: string): UsageCounts {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.ProductUsageDyn as Record<string, unknown> | undefined;
  if (!root) return {};

  // Find the first PrinterSubunit entry — that's where lifetime print counts live.
  const printerSubunit = root.PrinterSubunit as Record<string, unknown> | undefined;
  if (!printerSubunit) return {};

  return {
    pageCount: firstNumber(printerSubunit.TotalImpressions),
    pageCountColor: firstNumber(printerSubunit.ColorImpressions),
    pageCountMono: firstNumber(printerSubunit.MonochromeImpressions),
  };
}

export interface ConfigInfo {
  model?: string;
  serial?: string;
}

export function parseConfig(xml: string): ConfigInfo {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const root = parsed.ProductConfigDyn as Record<string, unknown> | undefined;
  if (!root) return {};
  const info = root.ProductInformation as Record<string, unknown> | undefined;
  if (!info) return {};
  return {
    model: text(info.MakeAndModel) ?? text(info.MakeAndModelBase),
    serial: text(info.SerialNumber),
  };
}

async function fetchXml(ip: string, path: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(`http://${ip}${path}`, {
      method: 'GET',
      signal: controller.signal,
      headersTimeout: timeoutMs,
      bodyTimeout: timeoutMs,
    });
    if (res.statusCode !== 200) {
      await res.body.dump();
      return null;
    }
    return await res.body.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const ledmAdapter: Adapter = {
  name: 'ledm',

  async detect(ip, opts) {
    const xml = await fetchXml(ip, PATHS.consumables, Math.min(opts.httpTimeoutMs, 3000));
    if (!xml) return false;
    return xml.includes('ConsumableConfigDyn');
  },

  async fetch(ip, opts) {
    const [consXml, usageXml, cfgXml] = await Promise.all([
      fetchXml(ip, PATHS.consumables, opts.httpTimeoutMs),
      fetchXml(ip, PATHS.usage, opts.httpTimeoutMs),
      fetchXml(ip, PATHS.config, opts.httpTimeoutMs),
    ]);

    if (!consXml) {
      return { adapter: 'ledm', ok: false, error: 'ConsumableConfigDyn unreachable' };
    }

    const supplies = parseConsumables(consXml);
    const usage = usageXml ? parseUsage(usageXml) : {};
    const cfg = cfgXml ? parseConfig(cfgXml) : {};

    return {
      adapter: 'ledm',
      ok: true,
      model: cfg.model,
      supplies,
      pageCount: usage.pageCount,
      pageCountColor: usage.pageCountColor,
      pageCountMono: usage.pageCountMono,
      status: 'online',
    };
  },
};
