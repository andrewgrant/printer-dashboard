import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb, Repo } from './db.js';

describe('persistent history', () => {
  it('migrates the old schema without data loss and retains archived data after reopening', () => {
    const directory = mkdtempSync(join(tmpdir(), 'printer-history-'));
    const path = join(directory, 'data.db');
    let db: ReturnType<typeof openDb> | undefined;
    try {
      db = openDb(path);
      let repo = new Repo(db);
      repo.insertPrinter({ id: 'p1', ip: '10.0.0.1', name: 'Office', model: null,
        source: 'manual', community: 'public', adapters: ['snmp'] });
      const snapshot = repo.insertSnapshot('p1', { takenAt: 1, status: 'online', pageCount: 100,
        supplies: [], sources: ['snmp'] });
      repo.insertSupplyEvent('p1', 'Black', 2, 100);
      // Recreate the previous schema while keeping real persisted history.
      db.exec('ALTER TABLE printers DROP COLUMN archived_at');
      db.close();
      db = openDb(path);
      repo = new Repo(db);
      expect(repo.getPrinter('p1')?.archivedAt).toBeNull();
      expect(repo.getLatestSnapshot('p1')).toEqual(snapshot);
      repo.deletePrinter('p1');
      db.close();
      db = openDb(path);
      repo = new Repo(db);
      expect(repo.listPrinters()).toEqual([]);
      const exported = repo.exportHistory({ printerIds: ['p1'] }, 1000);
      expect(exported.snapshots).toEqual([snapshot]);
      expect(exported.supplyEvents).toEqual([{ id: 1, printerId: 'p1', supplyLabel: 'Black', changedAt: 2, pageCountAtChange: 100 }]);
      expect(exported.printers?.[0]?.archivedAt).toBeTypeOf('number');
      expect(exported.nextPosition).toBeNull();
    } finally {
      if (db?.open) db.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
