/**
 * Local server (`npm run dev`): the whole platform on one port. The API, a CloudFront/S3
 * emulation (signed asset cookies, presigned uploads, public media, tenant favicon), the
 * built SPA, the dev mailbox, and the background worker with an in-process queue.
 */
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createAdapters, createLocalEdge } from './adapters/index.ts';
import { createApp } from './app.ts';
import { loadConfig } from './config.ts';
import type { Deps } from './context.ts';
import { createDbPool } from './deps.ts';
import { createLogger } from './lib/log.ts';
import { createLocalEdgeApp } from './local/edge.ts';
import { workerDepsFrom } from './worker/deps.ts';
import { startLocalWorker, type LocalWorker } from './worker/local.ts';

type Env = Record<string, string | undefined>;

export const DEFAULT_WEB_DIST = fileURLToPath(new URL('../../../apps/web/dist/', import.meta.url));

export interface LocalServer {
  app: ReturnType<typeof createLocalEdgeApp>;
  deps: Deps;
  worker: LocalWorker | null;
  close(): Promise<void>;
}

/** Builds the local server without listening; `startWorker: false` for tests. */
export function createLocalServer(env: Env = process.env, opts: { startWorker?: boolean; webDist?: string } = {}): LocalServer {
  const config = loadConfig(env);
  const pool = createDbPool(config, env);
  const log = createLogger(config.LOG_LEVEL, { service: 'local' });
  let worker: LocalWorker | null = null;
  // Outbox nudges from the API go straight to the in-process worker, like SQS → worker Lambda.
  const adapters = createAdapters(env, { pool, log, onQueueMessage: () => worker?.nudge() });
  const deps: Deps = { config, pool, adapters, log, now: () => new Date() };

  if (opts.startWorker ?? true) worker = startLocalWorker(workerDepsFrom(deps, env), { intervalMs: 2000 });
  const app = createLocalEdgeApp(deps, {
    api: createApp(deps),
    edge: createLocalEdge(env),
    webDist: opts.webDist ?? env.WEB_DIST_DIR ?? DEFAULT_WEB_DIST,
    devTools: config.NODE_ENV !== 'production',
  });
  return {
    app,
    deps,
    worker,
    async close() {
      await worker?.stop();
      await pool.end();
    },
  };
}

function main(): void {
  const server = createLocalServer();
  const { config, log } = server.deps;
  const http = serve({ fetch: server.app.fetch, port: config.PORT, hostname: '0.0.0.0' }, info => {
    log.info('local.listening', { port: info.port, storefront: `http://<slug>.${config.PLATFORM_DOMAIN}:${config.PORT}`, mailbox: `http://localhost:${info.port}/dev/mail` });
  });
  const shutdown = () => {
    http.close();
    void server.close().finally(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
