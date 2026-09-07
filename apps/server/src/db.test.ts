import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, Repo } from './db.js';
import type { PrinterSnapshot } from './types.js';

describe('Repo', () => {
  let repo: Repo;

  beforeEach(() => {
    const db = openDb(':memory:');
    repo = new Repo(db);
  });

  it('inserts and retrieves a printer', () => {
    const p = repo.insertPrinter({
      id: 'p1',
      ip: '192.168.0.137',
      name: 'OfficeJet',
      model: 'HP OfficeJet Pro 9020',
      source: 'discovered',
      community: 'public',
      adapters: ['snmp', 'ledm'],
    });
    expect(p.id).toBe('p1');
    expect(p.ip).toBe('192.168.0.137');
    expect(p.adapters).toEqual(['snmp', 'ledm']);
    expect(p.createdAt).toBeGreaterThan(0);
    expect(repo.getPrinter('p1')).toEqual(p);
    expect(repo.getPrinterByIp('192.168.0.137')?.id).toBe('p1');
  });

  it('rejects duplicate IP', () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '192.168.0.137',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: [],
    });
    expect(() =>
      repo.insertPrinter({
        id: 'p2',
        ip: '192.168.0.137',
        name: null,
        model: null,
        source: 'manual',
        community: 'public',
        adapters: [],
      }),
    ).toThrow(/UNIQUE/);
  });

  it('writes and reads snapshots round-trip', () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '192.168.0.159',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['ledm'],
    });
    const snap: PrinterSnapshot = {
      takenAt: 1_700_000_000_000,
      status: 'online',
      pageCount: 1336,
      pageCountColor: 928,
      pageCountMono: 407,
      supplies: [
        { colorant: 'color', label: 'Tri-color', levelPercent: 10, state: 'veryLow' },
        { colorant: 'black', label: 'Black', levelPercent: 20, state: 'low' },
      ],
      sources: ['snmp', 'ledm'],
      statusMessage: undefined,
    };
    const saved = repo.insertSnapshot('p1', snap);
    expect(saved.id).toBeGreaterThan(0);

    const latest = repo.getLatestSnapshot('p1');
    expect(latest).not.toBeNull();
    expect(latest!.pageCount).toBe(1336);
    expect(latest!.supplies).toHaveLength(2);
    expect(latest!.supplies[0]!.levelPercent).toBe(10);
    expect(latest!.sources).toEqual(['snmp', 'ledm']);
  });

  it('archives a printer while preserving its snapshots and supply events', () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: [],
    });
    repo.insertSnapshot('p1', {
      takenAt: Date.now(),
      status: 'online',
      supplies: [],
      sources: ['snmp'],
    });
    expect(repo.getLatestSnapshot('p1')).not.toBeNull();
    repo.insertSupplyEvent('p1', 'Black', 100, 50);
    expect(repo.deletePrinter('p1')).toBe(true);
    expect(repo.getPrinter('p1')).toBeNull();
    expect(repo.listPrinters()).toEqual([]);
    expect(repo.listPrinters(true)).toHaveLength(1);
    expect(repo.getPrinter('p1', true)?.archivedAt).toBeTypeOf('number');
    expect(repo.getLatestSnapshot('p1')).not.toBeNull();
    expect(repo.getLatestSupplyEvent('p1', 'Black')?.pageCountAtChange).toBe(50);
    repo.restorePrinter('p1');
    expect(repo.getPrinter('p1')?.archivedAt).toBeNull();
    expect(repo.listSnapshots('p1')).toHaveLength(1);
  });

  it('tracks supply events per printer + label', () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: [],
    });
    repo.insertSupplyEvent('p1', 'Black', 100, 50);
    repo.insertSupplyEvent('p1', 'Black', 200, 120);
    repo.insertSupplyEvent('p1', 'Cyan', 150, 80);

    const latestBlack = repo.getLatestSupplyEvent('p1', 'Black');
    expect(latestBlack?.changedAt).toBe(200);
    expect(latestBlack?.pageCountAtChange).toBe(120);

    const latestCyan = repo.getLatestSupplyEvent('p1', 'Cyan');
    expect(latestCyan?.pageCountAtChange).toBe(80);
  });

  it('updates printer meta without clobbering unrelated fields', () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: 'old',
      model: 'OldModel',
      source: 'manual',
      community: 'public',
      adapters: [],
    });
    repo.updatePrinterMeta('p1', { model: 'NewModel', adapters: ['snmp'] });
    const p = repo.getPrinter('p1')!;
    expect(p.name).toBe('old');
    expect(p.model).toBe('NewModel');
    expect(p.adapters).toEqual(['snmp']);
  });
});
