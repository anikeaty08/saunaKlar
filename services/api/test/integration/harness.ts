import pg from 'pg';
import { createTestDatabase, type TestDatabase } from '@saunaklar/db';
import { createApp } from '../../src/app.ts';
import { createAdapters } from '../../src/adapters/index.ts';
import { loadConfig } from '../../src/config.ts';
import type { Deps } from '../../src/context.ts';
import { silentLogger } from '../../src/lib/log.ts';

/**
 * API integration harness: a seeded throwaway database, the real app with
 * local adapters, and per-host browser clients with a cookie jar and the
 * CSRF header, so every request goes through the full middleware chain.
 */
export interface Harness {
  db: TestDatabase;
  owner: pg.Pool;
  deps: Deps;
  app: ReturnType<typeof createApp>;
  client(host: string): Client;
  close(): Promise<void>;
}

export interface Res<T = any> { status: number; body: T; headers: Headers }

export class Client {
  private readonly jar = new Map<string, string>();
  private csrf = '';
  constructor(private readonly app: ReturnType<typeof createApp>, readonly host: string) {}

  private store(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(';');
      const i = pair!.indexOf('=');
      const name = pair!.slice(0, i).trim();
      const value = pair!.slice(i + 1).trim();
      const expired = attrs.some(a => /max-age=0\b/i.test(a.trim()) || /expires=thu, 01 jan 1970/i.test(a.trim()));
      if (expired || value === '') this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }

  cookie(name: string) {
    return this.jar.get(name);
  }

  async req<T = any>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res<T>> {
    if (method !== 'GET' && !this.csrf) await this.session();
    const h: Record<string, string> = { host: this.host };
    if (this.jar.size) h.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    if (method !== 'GET') h['x-csrf-token'] = this.csrf;
    if (body !== undefined) h['content-type'] = 'application/json';
    Object.assign(h, headers);
    const res = await this.app.request(`http://${this.host}${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(res);
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (parsed && typeof parsed === 'object' && 'csrfToken' in parsed && typeof (parsed as { csrfToken: unknown }).csrfToken === 'string') {
      this.csrf = (parsed as { csrfToken: string }).csrfToken;
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string, headers?: Record<string, string>) { return this.req<T>('GET', path, undefined, headers); }
  post<T = any>(path: string, body?: unknown) { return this.req<T>('POST', path, body ?? {}); }
  put<T = any>(path: string, body?: unknown) { return this.req<T>('PUT', path, body); }
  patch<T = any>(path: string, body?: unknown) { return this.req<T>('PATCH', path, body); }
  del<T = any>(path: string, body?: unknown) { return this.req<T>('DELETE', path, body); }

  async session() {
    return this.req('GET', '/api/auth/session');
  }

  async login(email: string, password: string) {
    const r = await this.post('/api/auth/login', { email, password });
    if (r.status !== 200) throw new Error(`login failed: ${r.status} ${JSON.stringify(r.body)}`);
    return r;
  }

  async staffLogin(email: string, password: string) {
    const r = await this.post('/api/auth/staff/login', { email, password });
    if (r.status !== 200 || r.body.status !== 'OK') throw new Error(`staff login failed: ${r.status} ${JSON.stringify(r.body)}`);
    await this.session();
    return r;
  }
}

export async function createHarness(): Promise<Harness> {
  const db = await createTestDatabase({ seed: true });
  const env = {
    NODE_ENV: 'test',
    API_DATABASE_URL: db.apiUrl,
    PLATFORM_DOMAIN: 'localhost',
    ADMIN_HOST: 'admin.localhost',
    COOKIE_SECURE: '0',
    RATE_LIMIT: '0',
    STAFF_MFA: 'OPTIONAL',
    ADAPTERS: 'local',
    LOCAL_OBJECTS_DIR: `var/test-objects/${db.name}`,
    LOG_LEVEL: 'error',
  };
  const config = loadConfig(env);
  const pool = new pg.Pool({ connectionString: db.apiUrl, max: 5 });
  const adapters = createAdapters(env, { pool, log: silentLogger });
  const deps: Deps = { config, pool, adapters, log: silentLogger, now: () => new Date() };
  const app = createApp(deps);
  const owner = new pg.Pool({ connectionString: db.url, max: 2 });
  return {
    db, owner, deps, app,
    client: host => new Client(app, host),
    async close() {
      await pool.end();
      await owner.end();
      await db.drop();
    },
  };
}
