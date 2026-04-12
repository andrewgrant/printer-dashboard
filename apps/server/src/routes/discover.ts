import type { FastifyInstance } from 'fastify';
import type { Poller } from '../poller.js';

export function discoverRoutes(app: FastifyInstance, deps: { poller: Poller }): void {
  app.post('/api/discover', async () => {
    await deps.poller.runDiscoveryCycle();
    return { ok: true };
  });
}
