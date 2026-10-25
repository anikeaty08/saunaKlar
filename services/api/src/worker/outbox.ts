import type { PoolClient } from 'pg';
import { outboxHandlers } from './handlers.ts';
import { errorKind, safeErrorMessage } from './sanitize.ts';
import { workerTx } from './tx.ts';
import { PermanentError, type OutboxHandler, type OutboxRow, type WorkerCoreDeps } from './types.ts';

export interface DrainOptions extends WorkerCoreDeps {
  /** Rows claimed per batch. */
  batchSize?: number;
  /** After this many failed attempts a row is dead-lettered (`failed_at`). */
  maxAttempts?: number;
  /** Upper bound on batches per call, so one invocation stays within its time budget. */
  maxBatches?: number;
  /** Rows processed in parallel within a batch. */
  concurrency?: number;
  /** Override the handler table (tests). */
  handlers?: Readonly<Record<string, OutboxHandler>>;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  retried: number;
  deadLettered: number;
  skipped: number;
}

/** Lease on claimed rows; a crashed worker's rows become claimable again after it. */
const LEASE = '2 minutes';
const BACKOFF_BASE_SECONDS = 30;
const BACKOFF_MAX_SECONDS = 3600;

type RowResult = 'sent' | 'retried' | 'dead' | 'skipped';

/**
 * Drains due `notification_outbox` rows (design 14). Claiming uses
 * `FOR UPDATE SKIP LOCKED` plus a short lease, so parallel workers never take the
 * same row; each row is then processed in its own transaction that re-locks it and
 * re-checks `sent_at`, which makes processing idempotent per row (at-least-once
 * delivery only if the commit itself fails after the provider accepted a mail).
 */
export async function drainOutbox(opts: DrainOptions): Promise<DrainResult> {
  // Without an injected clock the database clock is used (`$n IS NULL → now()`), which avoids
  // skipping just-inserted rows when the app clock lags (ms vs µs precision).
  const now = (): Date | null => opts.now?.() ?? null;
  const batchSize = opts.batchSize ?? 50;
  const maxBatches = opts.maxBatches ?? 10;
  const total: DrainResult = { claimed: 0, sent: 0, retried: 0, deadLettered: 0, skipped: 0 };

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await claimBatch(opts, now(), batchSize);
    total.claimed += rows.length;
    const results = await mapLimit(rows, opts.concurrency ?? 4, row => processRow(opts, row, now));
    for (const r of results) {
      if (r === 'sent') total.sent++;
      else if (r === 'retried') total.retried++;
      else if (r === 'dead') total.deadLettered++;
      else total.skipped++;
    }
    if (rows.length < batchSize) break;
  }
  if (total.claimed > 0) opts.log.info('outbox.drained', { ...total });
  return total;
}

async function claimBatch(opts: DrainOptions, at: Date | null, limit: number): Promise<OutboxRow[]> {
  return workerTx(opts.pool, async db => {
    const { rows } = await db.query<{
      id: string;
      reseller_id: string | null;
      event_type: string;
      payload: Record<string, unknown> | null;
      attempts: number;
    }>(
      `UPDATE notification_outbox o
          SET locked_until = coalesce($1::timestamptz, now()) + interval '${LEASE}'
        WHERE o.id IN (
          SELECT id FROM notification_outbox
           WHERE sent_at IS NULL AND failed_at IS NULL
             AND available_at <= coalesce($1::timestamptz, now())
             AND (locked_until IS NULL OR locked_until < coalesce($1::timestamptz, now()))
           ORDER BY available_at, id
           LIMIT $2
           FOR UPDATE SKIP LOCKED)
        RETURNING o.id::text AS id, o.reseller_id, o.event_type, o.payload, o.attempts`,
      [at, limit],
    );
    return rows
      .map(r => ({
        id: r.id,
        resellerId: r.reseller_id,
        eventType: r.event_type,
        payload: r.payload ?? {},
        attempts: r.attempts,
      }))
      .sort((a, b) => Number(BigInt(a.id) - BigInt(b.id)));
  });
}

async function processRow(opts: DrainOptions, row: OutboxRow, now: () => Date | null): Promise<RowResult> {
  const log = opts.log.child({ outboxId: row.id, eventType: row.eventType });
  const handlers = opts.handlers ?? outboxHandlers;
  try {
    const outcome = await workerTx(
      opts.pool,
      async db => {
        if (!(await relock(db, row.id))) return null; // taken or finished by another worker
        const handler = handlers[row.eventType];
        if (!handler) throw new PermanentError(`unknown event type ${row.eventType}`);
        const result = await handler({ db, row, mailer: opts.mailer, edge: opts.edge, links: opts.links, log });
        await db.query(
          'UPDATE notification_outbox SET sent_at = coalesce($2::timestamptz, now()), locked_until = NULL, last_error = NULL WHERE id = $1',
          [row.id, now()],
        );
        return result;
      },
      { resellerId: row.resellerId },
    );
    if (!outcome) return 'skipped';
    log.info('outbox.sent', { sent: outcome.sent, skipped: outcome.skipped, attempts: row.attempts + 1 });
    return 'sent';
  } catch (err) {
    return recordFailure(opts, row, err, now(), log);
  }
}

/**
 * Waits (briefly) for the row instead of skipping it: a concurrent claim scan can hold the
 * lock for an instant, and skipping would strand the row until its lease expires. Another
 * worker still processing it (expired lease) makes us wait, then see `sent_at` and skip.
 */
async function relock(db: PoolClient, id: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `SELECT 1 FROM notification_outbox
      WHERE id = $1 AND sent_at IS NULL AND failed_at IS NULL
      FOR UPDATE`,
    [id],
  );
  return rowCount === 1;
}

async function recordFailure(
  opts: DrainOptions,
  row: OutboxRow,
  err: unknown,
  at: Date | null,
  log: DrainOptions['log'],
): Promise<RowResult> {
  const permanent = err instanceof PermanentError;
  const maxAttempts = opts.maxAttempts ?? 8;
  const message = safeErrorMessage(err);
  const updated = await workerTx(opts.pool, async db => {
    const { rows } = await db.query<{ attempts: number; dead: boolean }>(
      `UPDATE notification_outbox
          SET attempts = attempts + 1,
              last_error = $2,
              locked_until = NULL,
              available_at = coalesce($3::timestamptz, now())
                + make_interval(secs => least($5::float8 * power(2, attempts), $6::float8)),
              failed_at = CASE WHEN $4::boolean OR attempts + 1 >= $7 THEN coalesce($3::timestamptz, now()) END
        WHERE id = $1 AND sent_at IS NULL AND failed_at IS NULL
        RETURNING attempts, failed_at IS NOT NULL AS dead`,
      [row.id, message, at, permanent, BACKOFF_BASE_SECONDS, BACKOFF_MAX_SECONDS, maxAttempts],
    );
    return rows[0];
  });
  if (!updated) return 'skipped';
  if (updated.dead) {
    // Alarm-friendly: a CloudWatch metric filter matches msg = "outbox.dead_letter".
    log.error('outbox.dead_letter', { attempts: updated.attempts, permanent, error: errorKind(err), detail: message });
    return 'dead';
  }
  log.warn('outbox.retry', { attempts: updated.attempts, error: errorKind(err), detail: message });
  return 'retried';
}

/** Maps with at most `limit` promises in flight, preserving order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(lanes);
  return out;
}
