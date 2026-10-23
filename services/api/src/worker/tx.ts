import type { Pool, PoolClient } from 'pg';

/**
 * Runs `fn` in one transaction as the `app_worker` role (review C3). The worker never
 * acts for a tenant through RLS; `resellerId` is only set so triggers that read
 * `app.reseller_id` see a value.
 */
export async function workerTx<T>(
  pool: Pool,
  fn: (db: PoolClient) => Promise<T>,
  opts: { resellerId?: string | null } = {},
): Promise<T> {
  const db = await pool.connect();
  let broken = false;
  try {
    await db.query('BEGIN');
    await db.query('SET LOCAL ROLE app_worker');
    if (opts.resellerId) await db.query("SELECT set_config('app.reseller_id', $1, true)", [opts.resellerId]);
    const result = await fn(db);
    await db.query('COMMIT');
    return result;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {
      broken = true; // a connection that cannot roll back is discarded, not reused
    });
    throw err;
  } finally {
    db.release(broken);
  }
}
