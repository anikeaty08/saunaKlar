import type { Pool, PoolClient } from 'pg';
import type { Logger } from '../lib/log.ts';
import { errorKind } from './sanitize.ts';
import { workerTx } from './tx.ts';

/** Expired PENDING sign-up whose IdP user must go too (review G3). IdP username = sub = customer id. */
export interface PendingCustomer {
  customerId: string;
  resellerId: string;
}

/**
 * Deletes the IdP (Cognito) user of an expired sign-up. Must treat "user not found" as
 * success; any other error keeps the customer row for the next run.
 */
export type DeleteIdpUser = (customer: PendingCustomer) => Promise<void>;

export interface PendingCleanupOptions {
  pool: Pool;
  log: Logger;
  cutoff: Date;
  batchSize: number;
  deleteIdpUser?: DeleteIdpUser;
}

/**
 * Removes PENDING customers created before `cutoff` (review G3) through the SECURITY DEFINER
 * function `delete_expired_pending_customers` (app_worker has no DELETE on customers). Each
 * batch is one transaction: rows are deleted, then their IdP users; if an IdP deletion fails
 * the batch rolls back, so no customer row disappears while its IdP account survives.
 */
export async function cleanupPendingCustomers(opts: PendingCleanupOptions): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await workerTx(opts.pool, async db => {
      const { rows } = await db.query<{ id: string; reseller_id: string }>(
        'SELECT id, reseller_id FROM delete_expired_pending_customers($1, $2)',
        [opts.cutoff, opts.batchSize],
      );
      if (rows.length === 0) return 0;
      const customers = rows.map(r => ({ customerId: r.id, resellerId: r.reseller_id }));
      if (opts.deleteIdpUser) {
        for (const c of customers) await opts.deleteIdpUser(c);
      } else {
        await deleteLocalIdpUsers(db, customers.map(c => c.customerId), opts.log);
      }
      return rows.length;
    }).catch(err => {
      opts.log.warn('retention.pending_batch_failed', { error: errorKind(err) });
      throw err;
    });
    total += deleted;
    if (deleted < opts.batchSize) return total;
  }
}

/**
 * Local development: the IdP lives in schema `idp` (packages/db/migrations/local), writable by
 * `idp_local`, a role the API login is a member of. Absent in AWS, where `deleteIdpUser`
 * (Cognito AdminDeleteUser) is injected instead. Runs in a savepoint so a missing role or
 * schema never aborts the customer deletion.
 */
async function deleteLocalIdpUsers(db: PoolClient, customerIds: string[], log: Logger): Promise<void> {
  await db.query('SAVEPOINT local_idp');
  try {
    await db.query('SET LOCAL ROLE idp_local');
    const { rows } = await db.query<{ t: string | null }>("SELECT to_regclass('idp.users')::text AS t");
    if (rows[0]?.t) {
      await db.query(`DELETE FROM idp.users WHERE pool = 'CUSTOMER' AND sub = ANY($1::uuid[])`, [customerIds]);
    }
    await db.query('RELEASE SAVEPOINT local_idp');
  } catch (err) {
    await db.query('ROLLBACK TO SAVEPOINT local_idp');
    log.debug('retention.local_idp_skipped', { error: errorKind(err) });
  }
  await db.query('SET LOCAL ROLE app_worker');
}
