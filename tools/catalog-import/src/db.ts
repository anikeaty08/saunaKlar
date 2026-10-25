/**
 * Database access for the importer: every transaction runs through `withTx(pool,
 * { role: 'catalog_admin' })` from @saunaklar/db; read-only pre-checks against reseller data
 * (which catalog_admin cannot see) use the login connection directly and are skipped when it
 * lacks access.
 */
import { createPool as dbCreatePool, withTx } from '@saunaklar/db';
import type pg from 'pg';
import type { DbAccess } from './pipeline.ts';
import type { Queryable } from './state.ts';

export const DEFAULT_DATABASE_URL = 'postgres://sauna:sauna@127.0.0.1:5432/sauna';

export function withCatalogTx<T>(pool: pg.Pool, fn: (db: Queryable) => Promise<T>): Promise<T> {
  return withTx(pool, { role: 'catalog_admin' }, (client) => fn(client as unknown as Queryable));
}

export function dbAccess(pool: pg.Pool): DbAccess {
  return {
    catalogTx: (fn) => withCatalogTx(pool, fn),
    owner: pool as unknown as Queryable,
  };
}

export function createPool(url: string): pg.Pool {
  return dbCreatePool(url, { max: 4, application_name: 'catalog-import' });
}
