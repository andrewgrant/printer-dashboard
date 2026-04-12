import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { loadConfig } from './config.js';
import { openDb, Repo, resolveDbPath } from './db.js';
import { Poller } from './poller.js';
import { printersRoutes } from './routes/printers.js';
import { discoverRoutes } from './routes/discover.js';
import { healthRoutes } from './routes/health.js';
import type { AdapterOpts } from './types.js';

export async function buildApp(): Promise<{ app: Awaited<ReturnType<typeof Fastify>>; poller: Poller; cfg: ReturnType<typeof loadConfig> }> {
  const cfg = loadConfig();

  const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });
  await app.register(fastifyCors, { origin: true });

  const db = openDb(resolveDbPath(cfg.DATA_DIR));
  const repo = new Repo(db);

  const adapterOpts: AdapterOpts = {
    community: cfg.SNMP_COMMUNITY,
    snmpTimeoutMs: cfg.SNMP_TIMEOUT_MS,
    httpTimeoutMs: cfg.HTTP_TIMEOUT_MS,
  };

  const poller = new Poller({
    repo,
    opts: adapterOpts,
    pollIntervalMs: cfg.POLL_INTERVAL_SEC * 1000,
    discoveryIntervalMs: cfg.DISCOVERY_INTERVAL_SEC * 1000,
    logger: {
      info: (msg) => app.log.info(msg),
      warn: (msg) => app.log.warn(msg),
      error: (msg) => app.log.error(msg),
    },
  });

  healthRoutes(app);
  printersRoutes(app, { repo, poller, opts: adapterOpts });
  discoverRoutes(app, { poller });

  // Serve the built React SPA from dist/public if it exists.
  const here = dirname(fileURLToPath(import.meta.url));
  const staticDir = join(here, 'public');
  if (existsSync(staticDir)) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: false,
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'not found' });
      return reply.sendFile('index.html');
    });
  }

  return { app, poller, cfg };
}

async function main(): Promise<void> {
  const { app, poller, cfg } = await buildApp();
  try {
    await app.listen({ host: '0.0.0.0', port: cfg.PORT });
    poller.start();
    app.log.info(`printer-dashboard listening on http://0.0.0.0:${cfg.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  const shutdown = async (): Promise<void> => {
    app.log.info('shutting down…');
    poller.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  void main();
}
