import { describe, it, expect, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { openDb, Repo } from '../db.js';
import { Poller } from '../poller.js';
import { printersRoutes } from './printers.js';
import { discoverRoutes } from './discover.js';
import { healthRoutes } from './health.js';
import { DEFAULT_ADAPTER_OPTS, type PrinterSnapshot } from '../types.js';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function makeApp(
  repo: Repo,
  snapshot: PrinterSnapshot,
  detectedAdapters: Array<'snmp' | 'ledm' | 'ipp'> = ['snmp'],
): FastifyInstance {
  const app = Fastify({ logger: false });
  const poller = new Poller({
    repo,
    opts: DEFAULT_ADAPTER_OPTS,
    pollIntervalMs: 60_000,
    discoveryIntervalMs: 300_000,
    logger: silent,
    runAdapters: async () => ({ snapshot, partials: [] }),
    discover: async () => [],
  });
  // Also stub detectAdapters by monkey-patching via a closure: the real impl
  // reaches out to the network. Simplest: use a printer with adapters already set.
  void detectedAdapters;
  healthRoutes(app);
  printersRoutes(app, { repo, poller, opts: DEFAULT_ADAPTER_OPTS });
  discoverRoutes(app, { poller });
  return app;
}

describe('HTTP routes', () => {
  let repo: Repo;
  let app: FastifyInstance;
  const snap: PrinterSnapshot = {
    takenAt: 1_700_000_000_000,
    status: 'online',
    model: 'ENVY 6000',
    pageCount: 1336,
    supplies: [
      { colorant: 'color', label: 'Tri-color', levelPercent: 10, state: 'veryLow' },
      { colorant: 'black', label: 'Black', levelPercent: 20, state: 'low' },
    ],
    sources: ['ledm'],
  };

  beforeEach(() => {
    const db = openDb(':memory:');
    repo = new Repo(db);
    app = makeApp(repo, snap);
  });

  it('GET /api/health returns ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  it('GET /api/printers returns empty array initially', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/printers' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('GET /api/printers merges latest snapshot into each row', async () => {
    const p = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: 'test',
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['ledm'],
    });
    repo.insertSnapshot(p.id, snap);

    const res = await app.inject({ method: 'GET', url: '/api/printers' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ snapshot: { supplies: unknown[] } }>;
    expect(body).toHaveLength(1);
    expect(body[0]!.snapshot.supplies).toHaveLength(2);
  });

  it('POST /api/printers rejects an invalid IP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers',
      payload: { ip: 'not-an-ip' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/printers rejects a duplicate IP', async () => {
    repo.insertPrinter({
      id: 'existing',
      ip: '10.0.0.5',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['snmp'],
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/printers',
      payload: { ip: '10.0.0.5' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /api/printers/:id removes the printer', async () => {
    repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['snmp'],
    });
    const res = await app.inject({ method: 'DELETE', url: '/api/printers/p1' });
    expect(res.statusCode).toBe(204);
    expect(repo.getPrinter('p1')).toBeNull();
  });

  it('POST /api/printers/:id/poll returns the current snapshot', async () => {
    const p = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['ledm'],
    });
    const res = await app.inject({ method: 'POST', url: `/api/printers/${p.id}/poll` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { snapshot: { supplies: unknown[] } };
    expect(body.snapshot.supplies).toHaveLength(2);
  });

  it('GET /api/printers/:id/snapshots returns history', async () => {
    const p = repo.insertPrinter({
      id: 'p1',
      ip: '1.2.3.4',
      name: null,
      model: null,
      source: 'manual',
      community: 'public',
      adapters: ['ledm'],
    });
    repo.insertSnapshot(p.id, { ...snap, takenAt: 1000 });
    repo.insertSnapshot(p.id, { ...snap, takenAt: 2000 });
    const res = await app.inject({ method: 'GET', url: `/api/printers/${p.id}/snapshots` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ takenAt: number }>;
    expect(body).toHaveLength(2);
    expect(body[0]!.takenAt).toBe(2000); // newest first
  });
});
