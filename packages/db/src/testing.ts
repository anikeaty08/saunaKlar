/**
 * Test databases. createTestDatabase() returns a fresh, uniquely named database built from all
 * migrations (including migrations/local), for one test file. The first call per migration
 * checksum builds a template database (`sauna_tpl_<hash>`); later calls clone it, which takes
 * milliseconds. An advisory lock on the admin database serialises template builds and clones
 * across parallel test processes.
 *
 * Admin connection: TEST_DATABASE_URL, else DATABASE_URL, else the local default (superuser).
 */
import { createHash, randomBytes } from 'node:crypto';
import pg from 'pg';
import { DEFAULT_DATABASE_URL, loadMigrations, migrate } from './migrate.ts';
import { seed } from './seed.ts';

export interface TestDatabase {
  name: string;
  /** Owner (superuser) URL: fixtures and assertions. Bypasses RLS. */
  url: string;
  /** URL of the API login sauna_api (password sauna_api), for code under test. */
  apiUrl: string;
  drop(): Promise<void>;
}

export interface TestDatabaseOptions {
  /** Run the dev seed (with local IdP users) into the new database. */
  seed?: boolean;
  adminUrl?: string;
}

const LOCK_KEY = 732_810_442;

function withDatabase(url: string, database: string, credentials?: { user: string; password: string }): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  if (credentials) {
    u.username = credentials.user;
    u.password = credentials.password;
  }
  return u.toString();
}

async function templateName(): Promise<string> {
  const files = await loadMigrations(true);
  const h = createHash('sha256');
  for (const f of files) h.update(f.version).update('\0').update(f.checksum).update('\0');
  return `sauna_tpl_${h.digest('hex').slice(0, 16)}`;
}

async function databaseExists(admin: pg.Client, name: string): Promise<boolean> {
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
  return (rowCount ?? 0) > 0;
}

export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
  const adminUrl = options.adminUrl ?? process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  const template = await templateName();
  const name = `sauna_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    try {
      if (!(await databaseExists(admin, template))) {
        // Build under a temporary name and rename, so a crashed build never leaves a half template.
        const building = `${template}_build`;
        await admin.query(`DROP DATABASE IF EXISTS ${building} WITH (FORCE)`);
        await admin.query(`CREATE DATABASE ${building}`);
        await migrate(withDatabase(adminUrl, building), { local: true });
        await admin.query(`ALTER DATABASE ${building} RENAME TO ${template}`);
        // Old templates (other migration checksums) are no longer useful.
        const { rows } = await admin.query<{ datname: string }>(
          `SELECT datname FROM pg_database WHERE datname LIKE 'sauna\\_tpl\\_%' AND datname <> $1`, [template]);
        for (const r of rows) await admin.query(`DROP DATABASE IF EXISTS ${r.datname} WITH (FORCE)`).catch(() => {});
      }
      await admin.query(`CREATE DATABASE ${name} TEMPLATE ${template}`);
    } finally {
      await admin.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
    }
  } finally {
    await admin.end();
  }

  const url = withDatabase(adminUrl, name);
  const apiUrl = withDatabase(adminUrl, name, { user: 'sauna_api', password: 'sauna_api' });
  if (options.seed) await seed(url, { local: true, log: () => {} });

  let dropped = false;
  return {
    name,
    url,
    apiUrl,
    async drop() {
      if (dropped) return;
      dropped = true;
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}
