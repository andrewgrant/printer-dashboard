import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repo } from '../db.js';

const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const querySchema = z.object({
  printerIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
  from: timestamp.optional(),
  to: timestamp.optional(),
}).strict().refine((query) => query.from === undefined || query.to === undefined || query.from < query.to, {
  message: 'from must be less than to',
});
const positionSchema = z.object({
  snapshotAfter: timestamp,
  snapshotMax: timestamp,
  supplyEventAfter: timestamp,
  supplyEventMax: timestamp,
}).strict().refine((p) => p.snapshotAfter <= p.snapshotMax && p.supplyEventAfter <= p.supplyEventMax);
const cursorSchema = z.object({
  version: z.literal(1),
  query: querySchema,
  position: positionSchema,
}).strict();
const limitSchema = z.number().int().min(1).max(1000).default(500);
const requestSchema = z.union([
  z.object({
    printerIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
    from: timestamp.optional(),
    to: timestamp.optional(),
    limit: limitSchema,
  }).strict(),
  z.object({ cursor: z.string().min(1).max(32768), limit: limitSchema }).strict(),
]);

export function historyRoutes(app: FastifyInstance, repo: Repo): void {
  app.post('/api/printers/export', async (req, reply) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Provide printerIds (1–100 IDs), optional from/to timestamps and limit (1–1000), or cursor and optional limit.' });
    const body = parsed.data;
    let query;
    let position;
    if ('cursor' in body) {
      try {
        if (!/^[A-Za-z0-9_-]+$/.test(body.cursor)) throw new Error('encoding');
        const cursor = cursorSchema.parse(JSON.parse(Buffer.from(body.cursor, 'base64url').toString('utf8')));
        query = cursor.query;
        position = cursor.position;
      } catch {
        return reply.code(400).send({ error: 'Invalid export cursor' });
      }
    } else {
      const checked = querySchema.safeParse({ printerIds: [...new Set(body.printerIds)], from: body.from, to: body.to });
      if (!checked.success) return reply.code(400).send({ error: 'from must be less than to' });
      query = checked.data;
    }
    const result = repo.exportHistory(query, body.limit, position);
    if (result.missingPrinterIds) {
      return reply.code(404).send({ error: 'printer not found', missingPrinterIds: result.missingPrinterIds });
    }
    const { nextPosition, ...data } = result;
    return {
      ...data,
      nextCursor: nextPosition ? Buffer.from(JSON.stringify({ version: 1, query, position: nextPosition })).toString('base64url') : null,
    };
  });
}
