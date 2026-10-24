/**
 * Creates a fresh seeded database, builds the SPA, starts the local server against it and
 * waits until it answers. Returns the teardown (stop server, drop database).
 *
 * Env: E2E_PORT (default 8799), E2E_SKIP_BUILD=1 (use an existing apps/web/dist),
 * E2E_SERVER_LOG=1 (pipe server output), TEST_DATABASE_URL / DATABASE_URL (admin connection).
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { request } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createTestDatabase } from '@saunaklar/db';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.E2E_PORT ?? 8799);

/** GET http://127.0.0.1:<port><path> with a virtual Host (Node cannot resolve *.localhost). */
function probe(host: string, path: string): Promise<number> {
  return new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: PORT, path, headers: { host: `${host}:${PORT}` }, timeout: 2000 }, res => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', () => resolve(0));
    req.on('timeout', () => { req.destroy(); resolve(0); });
    req.end();
  });
}

async function waitForServer(server: ChildProcess, timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`local server exited with code ${server.exitCode}`);
    if ((await probe('alpha.localhost', '/api/tenant')) === 200) return;
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`local server did not answer on port ${PORT} within ${timeoutMs / 1000}s`);
}

function stop(server: ChildProcess): Promise<void> {
  return new Promise(resolve => {
    if (server.exitCode !== null || server.pid === undefined) return resolve();
    server.once('exit', () => resolve());
    try {
      process.kill(-server.pid, 'SIGTERM'); // the whole group: npm → tsx → node
    } catch {
      resolve();
    }
    setTimeout(() => {
      try { process.kill(-server.pid!, 'SIGKILL'); } catch { /* already gone */ }
      resolve();
    }, 5000).unref();
  });
}

export default async function globalSetup(): Promise<() => Promise<void>> {
  if (process.env.E2E_SKIP_BUILD !== '1') {
    execSync('npm run build -w @saunaklar/web', { cwd: ROOT, stdio: 'inherit' });
  }

  const db = await createTestDatabase({ seed: true });
  process.env.E2E_DATABASE_URL = db.url; // owner URL, for tests that assert on the database

  const server = spawn('npm', ['run', 'start', '-w', '@saunaklar/api'], {
    cwd: ROOT,
    detached: true,
    stdio: process.env.E2E_SERVER_LOG === '1' ? 'inherit' : 'ignore',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(PORT),
      PUBLIC_PORT: String(PORT),
      API_DATABASE_URL: db.apiUrl,
      DATABASE_URL: db.url,
      LOCAL_IDP: '1',
      ADAPTERS: 'local',
      PLATFORM_DOMAIN: 'localhost',
      ADMIN_HOST: 'admin.localhost',
      STAFF_MFA: 'OPTIONAL',
      RATE_LIMIT: '0',
      LOG_LEVEL: 'warn',
    },
  });

  try {
    await waitForServer(server);
  } catch (err) {
    await stop(server);
    await db.drop();
    throw err;
  }

  return async () => {
    await stop(server);
    await db.drop();
  };
}
