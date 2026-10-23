import type { Pool } from 'pg';
import type { Logger } from '../lib/log.ts';
import { cleanupPendingCustomers, type DeleteIdpUser } from './retention-customers.ts';
import { errorKind } from './sanitize.ts';
import { workerTx } from './tx.ts';

/**
 * Retention jobs (design 15.3, review G3). Every job deletes in short batches, each in
 * its own transaction, so locks stay brief and a large backlog never blocks writers.
 */

export interface RetentionOptions {
  pool: Pool;
  log: Logger;
  now?: () => Date;
  /** Rows per DELETE statement. */
  batchSize?: number;
  /** Deletes the IdP (Cognito) user of an expired PENDING customer. Locally the `idp` schema is cleaned directly. */
  deleteIdpUser?: DeleteIdpUser;
}

export interface RetentionCounts {
  shareLinkViews: number;
  sentOutbox: number;
  failedOutbox: number;
  pendingCustomers: number;
  auditEvents: number;
}

interface Job {
  key: keyof RetentionCounts;
  table: string;
  /** Predicate on the table; `$1` is the cutoff. */
  where: string;
  /** Postgres interval subtracted from `now`. */
  age: string;
}

/** Retention periods (proposed defaults, to confirm with counsel). */
export const RETENTION_JOBS: readonly Job[] = [
  { key: 'shareLinkViews', table: 'share_link_views', where: 'viewed_at < $1', age: '13 months' },
  { key: 'sentOutbox', table: 'notification_outbox', where: 'sent_at < $1', age: '30 days' },
  { key: 'failedOutbox', table: 'notification_outbox', where: 'failed_at < $1', age: '90 days' },
  { key: 'auditEvents', table: 'audit_events', where: 'occurred_at < $1', age: '24 months' },
];

export const PENDING_CUSTOMER_AGE = '7 days';

export interface RetentionResult extends RetentionCounts {
  /** Jobs that threw; the others still ran. The next run retries. */
  failedJobs: string[];
}

export async function runRetention(opts: RetentionOptions): Promise<RetentionResult> {
  const now = (opts.now ?? (() => new Date()))();
  const batchSize = opts.batchSize ?? 5000;
  const counts: RetentionCounts = { shareLinkViews: 0, sentOutbox: 0, failedOutbox: 0, pendingCustomers: 0, auditEvents: 0 };
  const errors: string[] = [];

  for (const job of RETENTION_JOBS) {
    try {
      counts[job.key] = await deleteInBatches(opts.pool, job, now, batchSize);
    } catch (err) {
      // One failing job must not stop the others; the next run retries.
      errors.push(job.key);
      opts.log.error('retention.job_failed', { job: job.key, error: errorKind(err) });
    }
  }
  try {
    counts.pendingCustomers = await cleanupPendingCustomers({
      pool: opts.pool,
      log: opts.log,
      now,
      age: PENDING_CUSTOMER_AGE,
      batchSize: Math.min(batchSize, 100),
      deleteIdpUser: opts.deleteIdpUser,
    });
  } catch (err) {
    errors.push('pendingCustomers');
    opts.log.error('retention.job_failed', { job: 'pendingCustomers', error: errorKind(err) });
  }

  opts.log.info('retention.done', { ...counts, failedJobs: errors });
  return { ...counts, failedJobs: errors };
}

async function deleteInBatches(pool: Pool, job: Job, now: Date, batchSize: number): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await workerTx(pool, async db => {
      const { rows } = await db.query<{ n: string }>(
        `WITH doomed AS (
           SELECT id FROM ${job.table}
            WHERE ${job.where.replace('$1', `($1::timestamptz - interval '${job.age}')`)}
            LIMIT $2
            FOR UPDATE SKIP LOCKED),
         gone AS (DELETE FROM ${job.table} t USING doomed WHERE t.id = doomed.id RETURNING 1)
         SELECT count(*)::text AS n FROM gone`,
        [now, batchSize],
      );
      return Number(rows[0]?.n ?? 0);
    });
    total += deleted;
    if (deleted < batchSize) return total;
  }
}
