export type PrinterStatus = 'online' | 'offline' | 'warning' | 'unknown';
export type SupplyState = 'ok' | 'low' | 'veryLow' | 'empty' | 'unknown';
export type AdapterName = 'snmp' | 'ledm' | 'ipp';

export interface Supply {
  colorant: string;
  label: string;
  levelPercent: number | null;
  state: SupplyState;
}

export interface Snapshot {
  takenAt: number;
  status: PrinterStatus;
  statusMessage?: string | null;
  pageCount: number | null;
  pageCountColor: number | null;
  pageCountMono: number | null;
  supplies: Supply[];
  sources: AdapterName[];
}

export interface Printer {
  id: string;
  ip: string;
  name: string | null;
  model: string | null;
  source: 'discovered' | 'manual';
  adapters: AdapterName[];
  lastSeenAt: number | null;
  createdAt: number;
  snapshot: Snapshot | null;
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listPrinters(): Promise<Printer[]> {
    return fetch('/api/printers').then((r) => jsonOrThrow<Printer[]>(r));
  },
  addPrinter(body: { ip: string; name?: string; community?: string }): Promise<Printer> {
    return fetch('/api/printers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => jsonOrThrow<Printer>(r));
  },
  deletePrinter(id: string): Promise<void> {
    return fetch(`/api/printers/${id}`, { method: 'DELETE' }).then((r) => {
      if (!r.ok) throw new Error(`delete failed: ${r.status}`);
    });
  },
  pollNow(id: string): Promise<{ snapshot: Snapshot }> {
    return fetch(`/api/printers/${id}/poll`, { method: 'POST' }).then((r) =>
      jsonOrThrow<{ snapshot: Snapshot }>(r),
    );
  },
  discover(): Promise<{ ok: boolean }> {
    return fetch('/api/discover', { method: 'POST' }).then((r) =>
      jsonOrThrow<{ ok: boolean }>(r),
    );
  },
};
