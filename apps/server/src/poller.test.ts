import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, Repo } from './db.js';
import { Poller, detectSupplyChanges } from './poller.js';
import type { PrinterSnapshot, Supply, AdapterOpts } from './types.js';
import { DEFAULT_ADAPTER_OPTS } from './types.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('detectSupplyChanges', () => {
  const s = (label: string, levelPercent: number): Supply => ({
    colorant: 'other',
    label,
    levelPercent,
    state: 'ok',
  });

  it('detects a cartridge swap when a supply jumps up by ≥ 20 points', () => {
    const prev = [s('Black', 5), s('Cyan', 50)];
    const next = [s('Black', 95), s('Cyan', 45)];
    const changes = detectSupplyChanges(prev, next);
    expect(changes).toHaveLength(1);
    expect(changes[0]!.label).toBe('Black');
  });

  it('does not fire on small fluctuations', () => {
    const prev = [s('Black', 50)];
    const next = [s('Black', 55)];
    expect(detectSupplyChanges(prev, next)).toEqual([]);
  });

  it('ignores null levels on either side', () => {
    expect(detectSupplyChanges([s('Ribbon', 50)], [{ ...s('Ribbon', 0), levelPercent: null }])).toEqual([]);
    expect(detectSupplyChanges([{ ...s('Ribbon', 0), levelPercent: null }], [s('Ribbon', 80)])).toEqual([]);
  });

  it('ignores labels that did not exist previously', () => {
    expect(detectSupplyChanges([], [s('Magenta', 100)])).toEqual([]);
  });

  it('fires on exactly the threshold', () => {
    const prev = [s('Yellow', 10)];
    const next = [s('Yellow', 30)];
    expect(detectSupplyChanges(prev, next)).toHaveLength(1);
  });
});

describe('Poller.pollOne', () => {
  let repo: Repo;
  let fakeNow = 1_000_000;
  const opts: AdapterOpts = DEFAULT_ADAPTER_OPTS;

  beforeEach(() => {
    const db = openDb(':memory:');
    repo = new Repo(db);
    fakeNow = 1_000_000;
  });

  const makeSnapshot = (supplies: Supply[], pageCount: number): PrinterSnapshot => ({
    takenAt: fakeNow,
    status: 'online',
    pageCount,
    supplies,
    sources: ['snmp', 'ledm'],
    model: 'TestModel',
  });

  it('records a snapshot, updates model, and sets lastSeenAt', async () => {
    const printer = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['snmp'],
    });

    const poller = new Poller({
      repo,
      opts,
      pollIntervalMs: 60_000,
      discoveryIntervalMs: 300_000,
      logger: silent,
      now: () => fakeNow,
      runAdapters: async () => ({
        snapshot: makeSnapshot(
          [{ colorant: 'cyan', label: 'Cyan', levelPercent: 80, state: 'ok' }],
          100,
        ),
        partials: [],
      }),
    });

    const snap = await poller.pollOne(printer.id);
    expect(snap).not.toBeNull();

    const updated = repo.getPrinter(printer.id)!;
    expect(updated.model).toBe('TestModel');
    expect(updated.lastSeenAt).toBe(fakeNow);

    const latest = repo.getLatestSnapshot(printer.id)!;
    expect(latest.supplies).toHaveLength(1);
    expect(latest.supplies[0]!.levelPercent).toBe(80);
  });

  it('writes a supply_event when a cartridge is replaced', async () => {
    const printer = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['snmp'],
    });

    // First poll: low ink.
    let nextSnapshot: PrinterSnapshot = makeSnapshot(
      [{ colorant: 'black', label: 'Black', levelPercent: 5, state: 'veryLow' }],
      100,
    );
    const poller = new Poller({
      repo,
      opts,
      pollIntervalMs: 60_000,
      discoveryIntervalMs: 300_000,
      logger: silent,
      now: () => fakeNow,
      runAdapters: async () => ({ snapshot: nextSnapshot, partials: [] }),
    });
    await poller.pollOne(printer.id);

    // Second poll: cartridge replaced, page count advanced.
    fakeNow = 2_000_000;
    nextSnapshot = makeSnapshot(
      [{ colorant: 'black', label: 'Black', levelPercent: 100, state: 'ok' }],
      120,
    );
    await poller.pollOne(printer.id);

    const ev = repo.getLatestSupplyEvent(printer.id, 'Black');
    expect(ev).not.toBeNull();
    expect(ev!.changedAt).toBe(2_000_000);
    expect(ev!.pageCountAtChange).toBe(120);
  });

  it('does NOT advance lastSeenAt when the snapshot is offline', async () => {
    const printer = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['snmp'],
    });
    // Prime with an online snapshot so lastSeenAt is set.
    repo.updatePrinterMeta(printer.id, { lastSeenAt: 500_000 });

    const poller = new Poller({
      repo,
      opts,
      pollIntervalMs: 60_000,
      discoveryIntervalMs: 300_000,
      logger: silent,
      now: () => fakeNow,
      runAdapters: async () => ({
        snapshot: {
          takenAt: fakeNow,
          status: 'offline',
          supplies: [],
          sources: [],
          statusMessage: 'unreachable',
        },
        partials: [],
      }),
    });
    await poller.pollOne(printer.id);

    const updated = repo.getPrinter(printer.id)!;
    expect(updated.lastSeenAt).toBe(500_000); // unchanged
  });
});
