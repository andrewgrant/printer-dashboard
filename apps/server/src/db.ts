import Database, { type Database as BetterDb } from 'better-sqlite3';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { AdapterName, PrinterSnapshot, PrinterStatus, Supply } from './types.js';

export interface PrinterRow {
  id: string;
  ip: string;
  name: string | null;
  model: string | null;
  source: 'discovered' | 'manual';
  community: string;
  adapters: AdapterName[];
  createdAt: number;
  lastSeenAt: number | null;
  archivedAt: number | null;
}

export interface SnapshotRow {
  id: number;
  printerId: string;
  takenAt: number;
  status: PrinterStatus;
  pageCount: number | null;
  pageCountColor: number | null;
  pageCountMono: number | null;
  supplies: Supply[];
  statusMessage: string | null;
  sources: AdapterName[];
}

export interface SupplyEventRow {
  id: number;
  printerId: string;
  supplyLabel: string;
  changedAt: number;
  pageCountAtChange: number | null;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS printers (
  id            TEXT PRIMARY KEY,
  ip            TEXT NOT NULL UNIQUE,
  name          TEXT,
  model         TEXT,
  source        TEXT NOT NULL CHECK (source IN ('discovered','manual')),
  community     TEXT NOT NULL DEFAULT 'public',
  adapters_json TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER
);

CREATE TABLE IF NOT EXISTS snapshots (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id       TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  taken_at         INTEGER NOT NULL,
  status           TEXT NOT NULL,
  page_count       INTEGER,
  page_count_color INTEGER,
  page_count_mono  INTEGER,
  supplies_json    TEXT NOT NULL DEFAULT '[]',
  status_message   TEXT,
  sources_json     TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_snapshots_printer_taken ON snapshots(printer_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS supply_events (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  printer_id            TEXT NOT NULL REFERENCES printers(id) ON DELETE CASCADE,
  supply_label          TEXT NOT NULL,
  changed_at            INTEGER NOT NULL,
  page_count_at_change  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_supply_events_printer ON supply_events(printer_id, changed_at DESC);
`;

export function openDb(path: string): BetterDb {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  // Additive migration: preserve existing printer identities and history.
  const columns = db.prepare('PRAGMA table_info(printers)').all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'archived_at')) {
    db.exec('ALTER TABLE printers ADD COLUMN archived_at INTEGER');
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_snapshots_printer_id ON snapshots(printer_id, id);
    CREATE INDEX IF NOT EXISTS idx_supply_events_printer_id ON supply_events(printer_id, id)`);
  return db;
}

export function resolveDbPath(dataDir: string): string {
  return join(dataDir, 'printer-dashboard.db');
}

function rowToPrinter(row: Record<string, unknown>): PrinterRow {
  return {
    id: String(row.id),
    ip: String(row.ip),
    name: (row.name as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    source: row.source as 'discovered' | 'manual',
    community: String(row.community),
    adapters: JSON.parse(String(row.adapters_json)) as AdapterName[],
    createdAt: Number(row.created_at),
    lastSeenAt: row.last_seen_at === null ? null : Number(row.last_seen_at),
    archivedAt: row.archived_at == null ? null : Number(row.archived_at),
  };
}

function rowToSnapshot(row: Record<string, unknown>): SnapshotRow {
  return {
    id: Number(row.id),
    printerId: String(row.printer_id),
    takenAt: Number(row.taken_at),
    status: row.status as PrinterStatus,
    pageCount: row.page_count === null ? null : Number(row.page_count),
    pageCountColor: row.page_count_color === null ? null : Number(row.page_count_color),
    pageCountMono: row.page_count_mono === null ? null : Number(row.page_count_mono),
    supplies: JSON.parse(String(row.supplies_json)) as Supply[],
    statusMessage: (row.status_message as string | null) ?? null,
    sources: JSON.parse(String(row.sources_json)) as AdapterName[],
  };
}

export class Repo {
  constructor(private readonly db: BetterDb) {}

  listPrinters(includeArchived = false): PrinterRow[] {
    const rows = this.db.prepare(`SELECT * FROM printers ${includeArchived ? '' : 'WHERE archived_at IS NULL'} ORDER BY ip`).all() as Record<string, unknown>[];
    return rows.map(rowToPrinter);
  }

  getPrinter(id: string, includeArchived = false): PrinterRow | null {
    const row = this.db.prepare(`SELECT * FROM printers WHERE id = ? ${includeArchived ? '' : 'AND archived_at IS NULL'}`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToPrinter(row) : null;
  }

  getPrinterByIp(ip: string): PrinterRow | null {
    const row = this.db.prepare('SELECT * FROM printers WHERE ip = ?').get(ip) as
      | Record<string, unknown>
      | undefined;
    return row ? rowToPrinter(row) : null;
  }

  insertPrinter(p: Omit<PrinterRow, 'createdAt' | 'lastSeenAt' | 'archivedAt'> & { createdAt?: number }): PrinterRow {
    const createdAt = p.createdAt ?? Date.now();
    this.db
      .prepare(
        `INSERT INTO printers (id, ip, name, model, source, community, adapters_json, created_at, last_seen_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(p.id, p.ip, p.name, p.model, p.source, p.community, JSON.stringify(p.adapters), createdAt);
    return this.getPrinter(p.id)!;
  }

  updatePrinterMeta(
    id: string,
    patch: Partial<Pick<PrinterRow, 'name' | 'model' | 'adapters' | 'lastSeenAt' | 'community'>>,
  ): void {
    const cur = this.getPrinter(id);
    if (!cur) return;
    const name = patch.name !== undefined ? patch.name : cur.name;
    const model = patch.model !== undefined ? patch.model : cur.model;
    const community = patch.community !== undefined ? patch.community : cur.community;
    const adapters = patch.adapters !== undefined ? patch.adapters : cur.adapters;
    const lastSeenAt = patch.lastSeenAt !== undefined ? patch.lastSeenAt : cur.lastSeenAt;
    this.db
      .prepare(
        `UPDATE printers
         SET name = ?, model = ?, community = ?, adapters_json = ?, last_seen_at = ?
         WHERE id = ?`,
      )
      .run(name, model, community, JSON.stringify(adapters), lastSeenAt, id);
  }

  /** HTTP DELETE archives the printer; stored history is never deleted here. */
  deletePrinter(id: string): boolean {
    const r = this.db.prepare('UPDATE printers SET archived_at = ? WHERE id = ? AND archived_at IS NULL').run(Date.now(), id);
    return r.changes > 0;
  }

  restorePrinter(id: string): void {
    this.db.prepare('UPDATE printers SET archived_at = NULL WHERE id = ?').run(id);
  }

  /** Insert-only history is bounded by IDs so new polls cannot shift export pages. */
  exportHistory(query: HistoryQuery, limit: number, position?: HistoryPosition) {
    return this.db.transaction(() => {
      const printers = query.printerIds.map((id) => this.getPrinter(id, true));
      const missingPrinterIds = query.printerIds.filter((_, i) => !printers[i]);
      if (missingPrinterIds.length) return { missingPrinterIds };
      const bounds = position ?? {
        snapshotAfter: 0,
        snapshotMax: (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM snapshots').get() as { id: number }).id,
        supplyEventAfter: 0,
        supplyEventMax: (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM supply_events').get() as { id: number }).id,
      };
      const read = (table: 'snapshots' | 'supply_events', time: 'taken_at' | 'changed_at', after: number, max: number) => {
        const conditions = [`printer_id IN (${query.printerIds.map(() => '?').join(',')})`, 'id > ?', 'id <= ?'];
        const args: (string | number)[] = [...query.printerIds, after, max];
        if (query.from !== undefined) { conditions.push(`${time} >= ?`); args.push(query.from); }
        if (query.to !== undefined) { conditions.push(`${time} < ?`); args.push(query.to); }
        return this.db.prepare(`SELECT * FROM ${table} WHERE ${conditions.join(' AND ')} ORDER BY id LIMIT ?`)
          .all(...args, limit + 1) as Record<string, unknown>[];
      };
      const snapshotRows = read('snapshots', 'taken_at', bounds.snapshotAfter, bounds.snapshotMax);
      const eventRows = read('supply_events', 'changed_at', bounds.supplyEventAfter, bounds.supplyEventMax);
      const snapshots = snapshotRows.slice(0, limit).map(rowToSnapshot);
      const supplyEvents = eventRows.slice(0, limit).map(rowToSupplyEvent);
      const nextPosition = snapshotRows.length > limit || eventRows.length > limit ? {
        ...bounds,
        snapshotAfter: snapshots.at(-1)?.id ?? bounds.snapshotAfter,
        supplyEventAfter: supplyEvents.at(-1)?.id ?? bounds.supplyEventAfter,
      } : null;
      return { printers: printers as PrinterRow[], snapshots, supplyEvents, nextPosition };
    })();
  }

  insertSnapshot(printerId: string, snap: PrinterSnapshot): SnapshotRow {
    const info = this.db
      .prepare(
        `INSERT INTO snapshots
           (printer_id, taken_at, status, page_count, page_count_color, page_count_mono,
            supplies_json, status_message, sources_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        printerId,
        snap.takenAt,
        snap.status,
        snap.pageCount ?? null,
        snap.pageCountColor ?? null,
        snap.pageCountMono ?? null,
        JSON.stringify(snap.supplies),
        snap.statusMessage ?? null,
        JSON.stringify(snap.sources),
      );
    const row = this.db.prepare('SELECT * FROM snapshots WHERE id = ?').get(info.lastInsertRowid) as
      | Record<string, unknown>
      | undefined;
    return rowToSnapshot(row!);
  }

  getLatestSnapshot(printerId: string): SnapshotRow | null {
    const row = this.db
      .prepare('SELECT * FROM snapshots WHERE printer_id = ? ORDER BY taken_at DESC LIMIT 1')
      .get(printerId) as Record<string, unknown> | undefined;
    return row ? rowToSnapshot(row) : null;
  }

  listSnapshots(printerId: string, limit = 50): SnapshotRow[] {
    const rows = this.db
      .prepare('SELECT * FROM snapshots WHERE printer_id = ? ORDER BY taken_at DESC LIMIT ?')
      .all(printerId, limit) as Record<string, unknown>[];
    return rows.map(rowToSnapshot);
  }

  insertSupplyEvent(printerId: string, supplyLabel: string, changedAt: number, pageCount: number | null): void {
    this.db
      .prepare(
        `INSERT INTO supply_events (printer_id, supply_label, changed_at, page_count_at_change)
         VALUES (?, ?, ?, ?)`,
      )
      .run(printerId, supplyLabel, changedAt, pageCount);
  }

  getLatestSupplyEvent(printerId: string, supplyLabel: string): SupplyEventRow | null {
    const row = this.db
      .prepare(
        `SELECT * FROM supply_events
         WHERE printer_id = ? AND supply_label = ?
         ORDER BY changed_at DESC LIMIT 1`,
      )
      .get(printerId, supplyLabel) as Record<string, unknown> | undefined;
    if (!row) return null;
    return rowToSupplyEvent(row);
  }
}

export interface HistoryQuery {
  printerIds: string[];
  from?: number;
  to?: number;
}

export interface HistoryPosition {
  snapshotAfter: number;
  snapshotMax: number;
  supplyEventAfter: number;
  supplyEventMax: number;
}

function rowToSupplyEvent(row: Record<string, unknown>): SupplyEventRow {
  return {
    id: Number(row.id),
    printerId: String(row.printer_id),
    supplyLabel: String(row.supply_label),
    changedAt: Number(row.changed_at),
    pageCountAtChange: row.page_count_at_change === null ? null : Number(row.page_count_at_change),
  };
}
