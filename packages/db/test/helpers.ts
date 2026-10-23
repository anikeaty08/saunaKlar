import { expect } from 'vitest';
import type pg from 'pg';
import { createPool, createTestDatabase, dbErrorCode, dbErrorInfo, SEED, withTx, type TestDatabase, type TxContext } from '../src/index.ts';

export { SEED };
export const ALPHA = SEED.resellers.alpha;
export const BETA = SEED.resellers.beta;
export const GAMMA = SEED.resellers.gamma;
export const M = SEED.models;
export const O = SEED.options;

export interface Env {
  db: TestDatabase;
  /** Superuser pool (bypasses RLS; triggers still fire). */
  owner: pg.Pool;
  /** sauna_api pool: the API login, NOINHERIT member of the app roles. */
  api: pg.Pool;
  close(): Promise<void>;
}

export async function setupEnv(): Promise<Env> {
  const db = await createTestDatabase({ seed: true });
  const owner = createPool(db.url, { max: 3 });
  const api = createPool(db.apiUrl, { max: 3 });
  return {
    db, owner, api,
    async close() {
      await Promise.all([owner.end(), api.end()]);
      await db.drop();
    },
  };
}

type Ctx = Omit<TxContext, 'role'>;
/** sauna_api is a member of app_tenant/app_platform/app_worker/idp_local; catalog_admin runs from the owner pool. */
export const as = <T>(env: Env, role: TxContext['role'], ctx: Ctx, fn: (c: pg.PoolClient) => Promise<T>) =>
  withTx(role === 'catalog_admin' ? env.owner : env.api, { role, ...ctx }, fn);
export const tenant = <T>(env: Env, resellerId: string | null, fn: (c: pg.PoolClient) => Promise<T>, actor: Ctx = {}) =>
  as(env, 'app_tenant', { resellerId, ...actor }, fn);
export const platform = <T>(env: Env, fn: (c: pg.PoolClient) => Promise<T>, actor: Ctx = { actorStaffId: SEED.staff.admin }) =>
  as(env, 'app_platform', actor, fn);

/** Superuser transaction with optional actor settings. */
export async function ownerTx<T>(env: Env, fn: (c: pg.PoolClient) => Promise<T>, actor: { staff?: string; customer?: string } = {}): Promise<T> {
  const c = await env.owner.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.actor_staff_id', $1, true), set_config('app.actor_customer_id', $2, true)`,
      [actor.staff ?? '', actor.customer ?? '']);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (err) {
    await c.query('ROLLBACK');
    throw err;
  } finally {
    c.release();
  }
}

/** Asserts that the promise rejects with the given stable code (and optional DETAIL sub-reason). */
export async function expectCode(p: Promise<unknown>, code: string, detail?: string): Promise<void> {
  let error: unknown;
  try {
    await p;
  } catch (err) {
    error = err;
  }
  expect(error, `expected ${code}`).toBeDefined();
  expect(dbErrorCode(error), (error as Error).message).toBe(code);
  if (detail !== undefined) expect(dbErrorInfo(error)?.detail).toBe(detail);
}

export async function count(c: pg.ClientBase, sql: string, values: unknown[] = []): Promise<number> {
  const { rows } = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM (${sql}) x`, values);
  return rows[0]!.n;
}

export async function one<T = Record<string, unknown>>(c: pg.ClientBase, sql: string, values: unknown[] = []): Promise<T> {
  const { rows } = await c.query(sql, values);
  if (!rows[0]) throw new Error(`no row: ${sql}`);
  return rows[0] as T;
}

/** Creates a draft configuration with selections (as the tenant, so RLS and triggers apply). */
export async function draft(c: pg.ClientBase, o: { reseller: string; model: string; customer?: string | null; staff?: string | null; options: string[] }): Promise<string> {
  const { id } = await one<{ id: string }>(c,
    `INSERT INTO configurations (reseller_id, sauna_model_id, customer_id, created_by_staff_id, name)
     VALUES ($1, $2, $3, $4, 'test') RETURNING id`, [o.reseller, M(o.model), o.customer ?? null, o.staff ?? null]);
  for (const code of o.options) {
    await c.query(`INSERT INTO configuration_selections (configuration_id, sauna_model_id, option_id) VALUES ($1, $2, $3)`, [id, M(o.model), O(code)]);
  }
  return id;
}

/** Writes a correct, undiscounted price snapshot from the current catalog prices. */
export async function writeSnapshot(c: pg.ClientBase, configurationId: string): Promise<void> {
  await c.query(
    `INSERT INTO configuration_price_snapshots
       (configuration_id, currency_code, list_price_minor, options_total_minor, discount_amount_minor, final_price_minor,
        discount_source, max_discount_bps)
     SELECT c.id, r.currency_code, p.list_price_minor, coalesce(o.total, 0), 0, p.list_price_minor + coalesce(o.total, 0),
            'NONE', p.max_discount_bps
     FROM configurations c
     JOIN resellers r ON r.id = c.reseller_id
     JOIN sauna_model_prices p ON p.sauna_model_id = c.sauna_model_id AND p.currency_code = r.currency_code
     LEFT JOIN LATERAL (
       SELECT sum(op.price_delta_minor) AS total FROM configuration_selections s
       JOIN sauna_model_option_prices op ON op.sauna_model_id = s.sauna_model_id AND op.option_id = s.option_id
                                         AND op.currency_code = r.currency_code
       WHERE s.configuration_id = c.id) o ON true
     WHERE c.id = $1`, [configurationId]);
  await c.query(
    `INSERT INTO configuration_price_snapshot_lines (configuration_id, option_id, price_delta_minor)
     SELECT s.configuration_id, s.option_id, op.price_delta_minor
     FROM configuration_selections s
     JOIN configurations c ON c.id = s.configuration_id
     JOIN resellers r ON r.id = c.reseller_id
     JOIN sauna_model_option_prices op ON op.sauna_model_id = s.sauna_model_id AND op.option_id = s.option_id
                                       AND op.currency_code = r.currency_code
     WHERE s.configuration_id = $1`, [configurationId]);
}

export async function lock(c: pg.ClientBase, configurationId: string): Promise<void> {
  await writeSnapshot(c, configurationId);
  await c.query(`UPDATE configurations SET locked_at = now() WHERE id = $1`, [configurationId]);
}

export const VALID_ESPOO = ['spruce', 'heater-6kw', 'door-clear'];
