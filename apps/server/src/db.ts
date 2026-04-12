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

  listPrinters(): PrinterRow[] {
    const rows = this.db.prepare('SELECT * FROM printers ORDER BY ip').all() as Record<string, unknown>[];
    return rows.map(rowToPrinter);
  }

  getPrinter(id: string): PrinterRow | null {
    const row = this.db.prepare('SELECT * FROM printers WHERE id = ?').get(id) as
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

  insertPrinter(p: Omit<PrinterRow, 'createdAt' | 'lastSeenAt'> & { createdAt?: number }): PrinterRow {
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

  deletePrinter(id: string): boolean {
    const r = this.db.prepare('DELETE FROM printers WHERE id = ?').run(id);
    return r.changes > 0;
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
    return {
      id: Number(row.id),
      printerId: String(row.printer_id),
      supplyLabel: String(row.supply_label),
      changedAt: Number(row.changed_at),
      pageCountAtChange: row.page_count_at_change === null ? null : Number(row.page_count_at_change),
    };
  }
}
