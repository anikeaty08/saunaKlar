/**
 * Migration runner. Applies `migrations/NNNN_name.sql` in order, then (when `local` is set,
 * i.e. LOCAL_IDP=1) `migrations/local/NNNN_name.sql`. Each file runs in its own transaction and
 * is recorded in `schema_migrations` with a checksum; an applied file that changed on disk is an
 * error. A session advisory lock serialises concurrent runners against one database.
 *
 * CLI: `node src/migrate.ts` (DATABASE_URL, LOCAL_IDP=1 for the local IdP schema).
 */
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
export const DEFAULT_DATABASE_URL = 'postgres://sauna:sauna@127.0.0.1:5432/sauna';

/** Advisory lock key shared by every migration runner. */
const LOCK_KEY = 732_810_441;

export interface MigrationFile {
  /** `0001_foundation` or `local/0001_local_idp`. */
  version: string;
  sql: string;
  checksum: string;
}

export interface MigrateOptions {
  /** Also apply migrations/local (local identity provider, dev mailbox). */
  local?: boolean;
  log?: (message: string) => void;
}

async function readDir(dir: string, prefix: string): Promise<MigrationFile[]> {
  const names = (await readdir(dir)).filter(n => /^\d{4}_[a-z0-9_]+\.sql$/.test(n)).sort();
  return Promise.all(names.map(async name => {
    const sql = await readFile(new URL(name, pathToFileURL(dir.endsWith('/') ? dir : `${dir}/`)), 'utf8');
    return { version: prefix + name.replace(/\.sql$/, ''), sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

/** All migration files in application order. */
export async function loadMigrations(local: boolean, dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const main = await readDir(dir, '');
  return local ? [...main, ...(await readDir(`${dir.replace(/\/$/, '')}/local/`, 'local/'))] : main;
}

/** Applies pending migrations; returns the versions applied by this call. */
export async function migrate(url: string, options: MigrateOptions = {}): Promise<string[]> {
  const log = options.log ?? (() => {});
  const files = await loadMigrations(options.local ?? false);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version    text        PRIMARY KEY,
      checksum   char(64)    NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query('REVOKE ALL ON schema_migrations FROM PUBLIC');
    const { rows } = await client.query<{ version: string; checksum: string }>('SELECT version, checksum FROM schema_migrations');
    const done = new Map(rows.map(r => [r.version, r.checksum]));
    for (const file of files) {
      const prev = done.get(file.version);
      if (prev !== undefined) {
        if (prev !== file.checksum) throw new Error(`migration ${file.version} changed after it was applied (checksum mismatch)`);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file.version, file.checksum]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        const e = err as Error & { position?: string };
        throw new Error(`migration ${file.version} failed: ${e.message}${e.position ? ` (at character ${e.position})` : ''}`, { cause: err });
      }
      applied.push(file.version);
      log(`applied ${file.version}`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return applied;
}

export function isLocalIdp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.LOCAL_IDP === '1' || env.LOCAL_IDP === 'true';
}

/** True when this module is the process entry point. */
export function isMain(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && importMetaUrl === pathToFileURL(entry).href;
}

if (isMain(import.meta.url)) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  migrate(url, { local: isLocalIdp(), log: m => console.log(m) })
    .then(v => console.log(v.length ? `${v.length} migration(s) applied` : 'database is up to date'))
    .catch(err => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
