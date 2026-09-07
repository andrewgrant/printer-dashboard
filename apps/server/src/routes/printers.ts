import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { v4 as uuid } from 'uuid';
import type { Repo } from '../db.js';
import { Poller } from '../poller.js';
import { detectAdapters } from '../adapters/index.js';
import type { AdapterOpts } from '../types.js';
import { historyRoutes } from './history.js';

const AddPrinterSchema = z.object({
  ip: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/, 'not a valid IPv4 address'),
  name: z.string().trim().min(1).max(100).optional(),
  community: z.string().trim().min(1).max(32).optional(),
});

export interface RoutesDeps {
  repo: Repo;
  poller: Poller;
  opts: AdapterOpts;
}

export function printersRoutes(app: FastifyInstance, deps: RoutesDeps): void {
  const { repo, poller, opts } = deps;
  historyRoutes(app, repo);

  app.get<{ Querystring: { includeArchived?: string } }>('/api/printers', async (req, reply) => {
    if (req.query.includeArchived !== undefined && !['true', 'false'].includes(req.query.includeArchived)) {
      return reply.code(400).send({ error: 'includeArchived must be true or false' });
    }
    const printers = repo.listPrinters(req.query.includeArchived === 'true');
    return printers.map((p) => {
      const latest = repo.getLatestSnapshot(p.id);
      return {
        id: p.id,
        ip: p.ip,
        name: p.name,
        model: p.model,
        source: p.source,
        adapters: p.adapters,
        lastSeenAt: p.lastSeenAt,
        createdAt: p.createdAt,
        archivedAt: p.archivedAt,
        snapshot: latest
          ? {
              takenAt: latest.takenAt,
              status: latest.status,
              pageCount: latest.pageCount,
              pageCountColor: latest.pageCountColor,
              pageCountMono: latest.pageCountMono,
              supplies: latest.supplies,
              statusMessage: latest.statusMessage,
              sources: latest.sources,
            }
          : null,
      };
    });
  });

  app.get<{ Params: { id: string } }>('/api/printers/:id', async (req, reply) => {
    const p = repo.getPrinter(req.params.id, true);
    if (!p) return reply.code(404).send({ error: 'printer not found' });
    const latest = repo.getLatestSnapshot(p.id);
    return { ...p, snapshot: latest };
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/api/printers/:id/snapshots',
    async (req, reply) => {
      const p = repo.getPrinter(req.params.id, true);
      if (!p) return reply.code(404).send({ error: 'printer not found' });
      const requestedLimit = Number(req.query.limit ?? 50);
      if (!Number.isSafeInteger(requestedLimit)) return reply.code(400).send({ error: 'limit must be an integer' });
      const limit = Math.min(Math.max(requestedLimit, 1), 500);
      return repo.listSnapshots(p.id, limit);
    },
  );

  app.post('/api/printers', async (req, reply) => {
    const parsed = AddPrinterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join('; ') });
    }
    const { ip, name, community } = parsed.data;
    const existing = repo.getPrinterByIp(ip);
    if (existing && existing.archivedAt === null) {
      return reply.code(409).send({ error: 'a printer with that IP already exists' });
    }
    const effectiveOpts: AdapterOpts = { ...opts, community: community ?? existing?.community ?? opts.community };
    const adapters = await detectAdapters(ip, effectiveOpts);
    if (adapters.length === 0) {
      return reply
        .code(422)
        .send({ error: 'no adapter could reach this IP (SNMP, HP LEDM, and IPP all failed)' });
    }
    if (existing) {
      repo.restorePrinter(existing.id);
      repo.updatePrinterMeta(existing.id, { name: name ?? existing.name, community: effectiveOpts.community, adapters });
      await poller.pollOne(existing.id);
      return reply.code(200).send(repo.getPrinter(existing.id));
    }
    const printer = repo.insertPrinter({
      id: uuid(),
      ip,
      name: name ?? null,
      model: null,
      source: 'manual',
      community: community ?? opts.community,
      adapters,
    });
    // Fire an immediate poll so the caller sees data right away.
    await poller.pollOne(printer.id);
    return reply.code(201).send(repo.getPrinter(printer.id));
  });

  app.delete<{ Params: { id: string } }>('/api/printers/:id', async (req, reply) => {
    const p = repo.getPrinter(req.params.id);
    if (!p) return reply.code(404).send({ error: 'printer not found' });
    repo.deletePrinter(p.id);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/printers/:id/poll', async (req, reply) => {
    const p = repo.getPrinter(req.params.id);
    if (!p) return reply.code(404).send({ error: 'printer not found' });
    const snap = await poller.pollOne(p.id);
    return { snapshot: snap };
  });
}
