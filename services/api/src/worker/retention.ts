import type { Pool } from 'pg';
import type { Logger } from '../lib/log.ts';
import { cleanupPendingCustomers, type DeleteIdpUser } from './retention-customers.ts';
import { errorKind } from './sanitize.ts';
import { workerTx } from './tx.ts';

/**
 * Retention jobs (design 15.3, review G3). Every job deletes in short batches, each in its own
 * transaction, so locks stay brief and a backlog never blocks writers. app_worker may delete
 * outbox rows directly; append-only and customer tables go through SECURITY DEFINER functions
 * (`retention_delete_batch`, `delete_expired_pending_customers`). On a database that predates
 * those functions the unbatched `run_retention()` is used instead.
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

export interface RetentionResult extends RetentionCounts {
  /** Jobs that threw; the others still ran. The next run retries. */
  failedJobs: string[];
}

type JobKey = keyof RetentionCounts;

/** Retention periods (proposed defaults, to confirm with counsel), in milliseconds-free calendar terms. */
export const RETENTION = {
  shareLinkViews: { months: 13 },
  auditEvents: { months: 24 },
  sentOutbox: { days: 30 },
  failedOutbox: { days: 90 },
  pendingCustomers: { days: 7 },
} as const satisfies Record<JobKey, { days: number } | { months: number }>;

/** `now` minus a calendar period (UTC). */
export function cutoffFor(now: Date, period: { days: number } | { months: number }): Date {
  const d = new Date(now);
  if ('months' in period) d.setUTCMonth(d.getUTCMonth() - period.months);
  else d.setUTCDate(d.getUTCDate() - period.days);
  return d;
}

const OUTBOX_PREDICATE = { sentOutbox: 'sent_at', failedOutbox: 'failed_at' } as const;

export async function runRetention(opts: RetentionOptions): Promise<RetentionResult> {
  const now = (opts.now ?? (() => new Date()))();
  const batchSize = opts.batchSize ?? 5000;
  const counts: RetentionCounts = { shareLinkViews: 0, sentOutbox: 0, failedOutbox: 0, pendingCustomers: 0, auditEvents: 0 };
  const failedJobs: string[] = [];
  const run = async (key: JobKey | 'legacy', job: () => Promise<void>) => {
    try {
      await job();
    } catch (err) {
      // One failing job must not stop the others; the next run retries.
      failedJobs.push(key);
      opts.log.error('retention.job_failed', { job: key, error: errorKind(err) });
    }
  };

  for (const key of ['sentOutbox', 'failedOutbox'] as const) {
    await run(key, async () => {
      counts[key] = await deleteOutboxInBatches(opts.pool, OUTBOX_PREDICATE[key], cutoffFor(now, RETENTION[key]), batchSize);
    });
  }

  const batched = await hasBatchedFunctions(opts.pool);
  if (batched) {
    await run('shareLinkViews', async () => {
      counts.shareLinkViews = await deleteViaFunction(opts.pool, 'share_link_views', cutoffFor(now, RETENTION.shareLinkViews), batchSize);
    });
    await run('auditEvents', async () => {
      counts.auditEvents = await deleteViaFunction(opts.pool, 'audit_events', cutoffFor(now, RETENTION.auditEvents), batchSize);
    });
    await run('pendingCustomers', async () => {
      counts.pendingCustomers = await cleanupPendingCustomers({
        pool: opts.pool,
        log: opts.log,
        cutoff: cutoffFor(now, RETENTION.pendingCustomers),
        batchSize: Math.min(batchSize, 100),
        deleteIdpUser: opts.deleteIdpUser,
      });
    });
  } else {
    opts.log.warn('retention.unbatched_fallback');
    await run('legacy', async () => {
      const legacy = await workerTx(opts.pool, async db => (await db.query<{ r: Record<string, number> }>('SELECT run_retention() AS r')).rows[0]!.r);
      counts.shareLinkViews = Number(legacy.shareLinkViews ?? 0);
      counts.auditEvents = Number(legacy.auditEvents ?? 0);
      counts.sentOutbox += Number(legacy.sentOutbox ?? 0);
      counts.pendingCustomers = Number(legacy.pendingCustomers ?? 0);
    });
  }

  opts.log.info('retention.done', { ...counts, batched, failedJobs });
  return { ...counts, failedJobs };
}

async function hasBatchedFunctions(pool: Pool): Promise<boolean> {
  return workerTx(pool, async db => {
    const { rows } = await db.query<{ ok: boolean }>(
      `SELECT to_regprocedure('retention_delete_batch(text,timestamptz,integer)') IS NOT NULL
          AND to_regprocedure('delete_expired_pending_customers(timestamptz,integer)') IS NOT NULL AS ok`,
    );
    return rows[0]?.ok === true;
  });
}

async function deleteOutboxInBatches(pool: Pool, column: 'sent_at' | 'failed_at', cutoff: Date, batchSize: number): Promise<number> {
  return loopBatches(batchSize, () =>
    workerTx(pool, async db => {
      const { rowCount } = await db.query(
        `DELETE FROM notification_outbox
          WHERE id IN (SELECT id FROM notification_outbox WHERE ${column} < $1 LIMIT $2 FOR UPDATE SKIP LOCKED)`,
        [cutoff, batchSize],
      );
      return rowCount ?? 0;
    }),
  );
}

async function deleteViaFunction(pool: Pool, table: 'share_link_views' | 'audit_events', cutoff: Date, batchSize: number): Promise<number> {
  return loopBatches(batchSize, () =>
    workerTx(pool, async db => {
      const { rows } = await db.query<{ n: number }>('SELECT retention_delete_batch($1, $2, $3) AS n', [table, cutoff, batchSize]);
      return Number(rows[0]?.n ?? 0);
    }),
  );
}

async function loopBatches(batchSize: number, batch: () => Promise<number>): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await batch();
    total += n;
    if (n < batchSize) return total;
  }
}
