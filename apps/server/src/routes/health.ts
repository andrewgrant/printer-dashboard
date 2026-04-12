import type { FastifyInstance } from 'fastify';

export function healthRoutes(app: FastifyInstance): void {
  app.get('/api/health', async () => ({ ok: true, uptime: process.uptime() }));
}
