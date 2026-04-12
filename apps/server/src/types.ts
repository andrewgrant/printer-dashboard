export type AdapterName = 'snmp' | 'ledm' | 'ipp';

export type SupplyState = 'ok' | 'low' | 'veryLow' | 'empty' | 'unknown';

export type PrinterStatus = 'online' | 'offline' | 'warning' | 'unknown';

export interface Supply {
  /** Colorant label: "cyan" | "magenta" | "yellow" | "black" | "color" | "other" */
  colorant: string;
  /** Human label, e.g. "Cyan ink HP 3JA86A" or "Color Ink Ribbon" */
  label: string;
  /** Percent 0-100. null = unknown (printer can't report it). */
  levelPercent: number | null;
  state: SupplyState;
}

export interface PrinterSnapshot {
  takenAt: number;
  status: PrinterStatus;
  model?: string;
  name?: string;
  deviceStatus?: string;
  printerStatus?: string;
  statusMessage?: string;
  pageCount?: number;
  pageCountColor?: number;
  pageCountMono?: number;
  supplies: Supply[];
  /** Which adapters contributed to this snapshot. */
  sources: AdapterName[];
}

export interface PartialSnapshot {
  adapter: AdapterName;
  ok: boolean;
  error?: string;
  model?: string;
  name?: string;
  status?: PrinterStatus;
  deviceStatus?: string;
  printerStatus?: string;
  statusMessage?: string;
  pageCount?: number;
  pageCountColor?: number;
  pageCountMono?: number;
  supplies?: Supply[];
}

export interface AdapterOpts {
  community: string;
  snmpTimeoutMs: number;
  httpTimeoutMs: number;
}

export interface Adapter {
  name: AdapterName;
  /** Quick probe to see if this adapter can talk to this printer at all. */
  detect(ip: string, opts: AdapterOpts): Promise<boolean>;
  /** Full status query. Always resolves; sets ok=false with error on failure. */
  fetch(ip: string, opts: AdapterOpts): Promise<PartialSnapshot>;
}

export const DEFAULT_ADAPTER_OPTS: AdapterOpts = {
  community: 'public',
  snmpTimeoutMs: 3000,
  httpTimeoutMs: 5000,
};
