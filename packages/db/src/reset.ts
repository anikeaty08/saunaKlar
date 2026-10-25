/**
 * Drops and recreates the database named in DATABASE_URL, migrates it and seeds it.
 * Development only. CLI: `node src/reset.ts` (DATABASE_URL, LOCAL_IDP=1 for the local IdP).
 */
import pg from 'pg';
import { DEFAULT_DATABASE_URL, isLocalIdp, isMain, migrate } from './migrate.ts';
import { seed } from './seed.ts';

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

export async function resetDatabase(url: string, options: { local?: boolean; log?: (m: string) => void } = {}): Promise<void> {
  const log = options.log ?? (() => {});
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.replace(/^\//, ''));
  if (!IDENT.test(name)) throw new Error(`refusing to reset database "${name}" (unexpected name)`);
  if (process.env.NODE_ENV === 'production') throw new Error('refusing to reset a database with NODE_ENV=production');
  const maintenance = new URL(url);
  maintenance.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: maintenance.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  log(`recreated database ${name}`);
  await migrate(url, { local: options.local ?? false, log });
  await seed(url, { local: options.local ?? false, log });
}

if (isMain(import.meta.url)) {
  resetDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL, { local: isLocalIdp(), log: m => console.log(m) }).catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
