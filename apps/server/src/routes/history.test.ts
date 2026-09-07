import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, Repo } from '../db.js';
import { printersRoutes } from './printers.js';
import { Poller } from '../poller.js';
import { DEFAULT_ADAPTER_OPTS } from '../types.js';

vi.mock('../adapters/index.js', () => ({ detectAdapters: vi.fn(async () => ['snmp']), runAdapters: vi.fn() }));

describe('complete history export', () => {
  let db: ReturnType<typeof openDb>;
  let repo: Repo;
  let app: FastifyInstance;
  const snapshot = { takenAt: 100, status: 'online' as const, pageCount: 42, pageCountColor: 12, pageCountMono: 30,
    supplies: [{ label: 'Black', colorant: 'black', levelPercent: 50, state: 'ok' as const }],
    statusMessage: 'Ready', sources: ['snmp' as const] };

  beforeEach(() => {
    db = openDb(':memory:');
    repo = new Repo(db);
    app = Fastify();
    const poller = new Poller({ repo, opts: DEFAULT_ADAPTER_OPTS, pollIntervalMs: 60000, discoveryIntervalMs: 300000,
      runAdapters: async () => ({ snapshot, partials: [] }), discover: async () => [],
      logger: { info() {}, warn() {}, error() {} } });
    printersRoutes(app, { repo, poller, opts: DEFAULT_ADAPTER_OPTS });
    for (const [index, id] of ['p1', 'p2', 'other', 'empty'].entries()) {
      repo.insertPrinter({ id, ip: `10.0.0.${index + 1}`, name: id, model: 'Model', community: 'public', source: 'manual', adapters: ['snmp'] });
    }
  });
  afterEach(async () => { await app.close(); db.close(); });
  const request = (payload: unknown) => app.inject({ method: 'POST', url: '/api/printers/export', payload: payload as object });

  it('retrieves all selected data beyond 500 rows, without gaps, duplicates or concurrent inserts', async () => {
    const expectedSnapshots: unknown[] = [];
    db.transaction(() => {
      for (let i = 0; i < 1203; i++) {
        const id = i % 2 ? 'p1' : 'p2';
        // Deliberately tied and non-monotonic timestamps: pagination uses row IDs.
        expectedSnapshots.push(repo.insertSnapshot(id, { ...snapshot, takenAt: i % 3 }));
        if (i < 701) repo.insertSupplyEvent(id, 'Black', i % 3, i);
      }
    })();
    repo.insertSnapshot('other', snapshot);
    repo.insertSupplyEvent('other', 'Black', 100, 10);
    let response = await request({ printerIds: ['p1', 'p2', 'p1'], limit: 200 });
    const snapshots: unknown[] = [];
    const events: Array<{ id: number; printerId: string }> = [];
    let pages = 0;
    for (;;) {
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.printers.map((p: { id: string }) => p.id)).toEqual(['p1', 'p2']);
      snapshots.push(...body.snapshots);
      events.push(...body.supplyEvents);
      expect(++pages).toBeLessThan(20);
      if (!body.nextCursor) break;
      if (pages === 1) {
        repo.insertSnapshot('p1', { ...snapshot, takenAt: 0 });
        repo.insertSupplyEvent('p2', 'Black', 0, 9999);
      }
      response = await request({ cursor: body.nextCursor, limit: 200 });
    }
    expect(snapshots).toEqual(expectedSnapshots);
    expect(events).toHaveLength(701);
    expect(new Set(events.map((event) => event.id)).size).toBe(701);
    expect(events.every((event) => ['p1', 'p2'].includes(event.printerId))).toBe(true);
    expect(events[0]).toMatchObject({ supplyLabel: 'Black', changedAt: 0, pageCountAtChange: 0 });
  });

  it('continues when only supply events remain, and allows changing page size', async () => {
    for (let i = 0; i < 5; i++) repo.insertSupplyEvent('p1', 'Black', i, null);
    const first = (await request({ printerIds: ['p1'], limit: 1 })).json();
    expect(first.snapshots).toEqual([]);
    expect(first.supplyEvents).toHaveLength(1);
    const last = (await request({ cursor: first.nextCursor, limit: 1000 })).json();
    expect(last.supplyEvents).toHaveLength(4);
    expect(last.nextCursor).toBeNull();
  });

  it('applies inclusive from and exclusive to to both histories throughout pagination', async () => {
    for (const time of [0, 100, 100, 199, 200]) {
      repo.insertSnapshot('p1', { ...snapshot, takenAt: time });
      repo.insertSupplyEvent('p1', 'Black', time, null);
    }
    const first = (await request({ printerIds: ['p1'], from: 100, to: 200, limit: 2 })).json();
    expect(first.snapshots.map((s: { takenAt: number }) => s.takenAt)).toEqual([100, 100]);
    const last = (await request({ cursor: first.nextCursor })).json();
    expect(last.snapshots.map((s: { takenAt: number }) => s.takenAt)).toEqual([199]);
    expect([...first.supplyEvents, ...last.supplyEvents].map((s) => s.changedAt)).toEqual([100, 100, 199]);
    expect(last.nextCursor).toBeNull();
  });

  it('returns metadata and empty arrays for a printer without readings', async () => {
    const res = await request({ printerIds: ['empty'] });
    expect(res.json()).toEqual({ printers: [repo.getPrinter('empty')], snapshots: [], supplyEvents: [], nextCursor: null });
  });

  it('reports all unknown IDs instead of silently returning a partial export', async () => {
    const res = await request({ printerIds: ['p1', 'missing', 'missing2'] });
    expect(res.statusCode).toBe(404);
    expect(res.json().missingPrinterIds).toEqual(['missing', 'missing2']);
  });

  it.each([
    {}, { printerIds: [] }, { printerIds: [''] }, { printerIds: ['p1'], limit: 0 },
    { printerIds: ['p1'], limit: 1001 }, { printerIds: ['p1'], limit: 1.5 },
    { printerIds: ['p1'], from: -1 }, { printerIds: ['p1'], to: 'yesterday' },
    { printerIds: ['p1'], from: 200, to: 100 }, { printerIds: ['p1'], from: 100, to: 100 },
    { printerIds: Array(101).fill('p1') }, { cursor: 'not-a-cursor' },
    { cursor: Buffer.from('{"version":9}').toString('base64url') },
    { cursor: 'abc', printerIds: ['p1'] }, { printerIds: ['p1'], extra: true },
  ])('rejects invalid requests: %j', async (body) => {
    expect((await request(body)).statusCode).toBe(400);
  });

  it('preserves archived history and restores the same identity when re-added', async () => {
    const saved = repo.insertSnapshot('p1', snapshot);
    repo.insertSupplyEvent('p1', 'Black', 100, 42);
    expect((await app.inject({ method: 'DELETE', url: '/api/printers/p1' })).statusCode).toBe(204);
    const active = (await app.inject('/api/printers')).json();
    expect(active.some((p: { id: string }) => p.id === 'p1')).toBe(false);
    const all = (await app.inject('/api/printers?includeArchived=true')).json();
    expect(all.find((p: { id: string }) => p.id === 'p1').archivedAt).toBeTypeOf('number');
    expect((await app.inject('/api/printers/p1')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/printers/p1/poll' })).statusCode).toBe(404);
    const archived = (await request({ printerIds: ['p1'] })).json();
    expect(archived.snapshots).toEqual([saved]);
    expect(archived.supplyEvents).toHaveLength(1);
    const restored = await app.inject({ method: 'POST', url: '/api/printers', payload: { ip: '10.0.0.1' } });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: 'p1', archivedAt: null });
    expect(repo.listSnapshots('p1')).toHaveLength(2);
  });
});
