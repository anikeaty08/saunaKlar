import type { Pool, PoolClient } from 'pg';
import type { Logger } from '../lib/log.ts';
import { errorKind } from './sanitize.ts';
import { workerTx } from './tx.ts';

/** Expired PENDING sign-up whose IdP user must go too (review G3). */
export interface PendingCustomer {
  customerId: string;
  resellerId: string;
  email: string;
}

/** Deletes the IdP (Cognito) user of an expired sign-up; must succeed if the user is already gone. */
export type DeleteIdpUser = (customer: PendingCustomer) => Promise<void>;

export interface PendingCleanupOptions {
  pool: Pool;
  log: Logger;
  now: Date;
  /** Postgres interval, e.g. '7 days'. */
  age: string;
  batchSize: number;
  deleteIdpUser?: DeleteIdpUser;
}

/**
 * Removes PENDING customers older than `age` (review G3). Each batch locks its rows
 * (SKIP LOCKED, so a concurrent confirm is never blocked for long), deletes the IdP
 * users first, then the rows; a customer whose IdP deletion fails stays for the
 * next run, so no orphaned IdP account can squat the address.
 */
export async function cleanupPendingCustomers(opts: PendingCleanupOptions): Promise<number> {
  let total = 0;
  for (;;) {
    const { selected, deleted } = await workerTx(opts.pool, async db => {
      const { rows } = await db.query<{ id: string; reseller_id: string; email: string }>(
        `SELECT id, reseller_id, email FROM customers
          WHERE status = 'PENDING' AND created_at < $1::timestamptz - $2::interval
          ORDER BY created_at
          LIMIT $3
          FOR UPDATE SKIP LOCKED`,
        [opts.now, opts.age, opts.batchSize],
      );
      const doomed: string[] = [];
      for (const r of rows) {
        const customer = { customerId: r.id, resellerId: r.reseller_id, email: r.email };
        try {
          if (opts.deleteIdpUser) await opts.deleteIdpUser(customer);
          doomed.push(r.id);
        } catch (err) {
          opts.log.warn('retention.idp_delete_failed', { customerId: r.id, error: errorKind(err) });
        }
      }
      if (doomed.length === 0) return { selected: rows.length, deleted: 0 };
      if (!opts.deleteIdpUser) await deleteLocalIdpUsers(db, doomed);
      const res = await db.query(
        `DELETE FROM customers WHERE id = ANY($1::uuid[]) AND status = 'PENDING'`,
        [doomed],
      );
      return { selected: rows.length, deleted: res.rowCount ?? 0 };
    });
    total += deleted;
    // Stop on a short batch, or when nothing could be deleted (avoid spinning on IdP failures).
    if (selected < opts.batchSize || deleted === 0) return total;
  }
}

/**
 * Local development: the IdP lives in schema `idp` (packages/db/migrations/local). It is
 * absent in AWS, where `deleteIdpUser` (Cognito AdminDeleteUser) is injected instead.
 */
async function deleteLocalIdpUsers(db: PoolClient, customerIds: string[]): Promise<void> {
  const { rows } = await db.query<{ t: string | null }>("SELECT to_regclass('idp.users')::text AS t");
  if (!rows[0]?.t) return;
  await db.query(`DELETE FROM idp.users WHERE pool = 'CUSTOMER' AND sub = ANY($1::text[])`, [customerIds]);
}
