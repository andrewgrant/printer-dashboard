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
import { DEFAULT_ADAPTER_OPTS, type AdapterOpts } from './types.js';

const PORT = 3101;
const DATA_DIR = './data';
const POLL_INTERVAL_MS = 60 * 1000;
const DISCOVERY_INTERVAL_MS = 5 * 60 * 1000;

export async function buildApp(): Promise<{ app: Awaited<ReturnType<typeof Fastify>>; poller: Poller; cfg: ReturnType<typeof loadConfig> }> {
  const cfg = loadConfig();

  const app = Fastify({ logger: { level: cfg.LOG_LEVEL } });
  await app.register(fastifyCors, { origin: true });

  const db = openDb(resolveDbPath(DATA_DIR));
  const repo = new Repo(db);

  const adapterOpts: AdapterOpts = {
    ...DEFAULT_ADAPTER_OPTS,
    community: cfg.SNMP_COMMUNITY,
  };

  const poller = new Poller({
    repo,
    opts: adapterOpts,
    pollIntervalMs: POLL_INTERVAL_MS,
    discoveryIntervalMs: DISCOVERY_INTERVAL_MS,
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
    await app.listen({ host: '0.0.0.0', port: PORT });
    poller.start();
    app.log.info(`printer-dashboard listening on http://0.0.0.0:${PORT}`);
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
