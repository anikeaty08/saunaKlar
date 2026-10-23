import { drainOutbox, type DrainOptions } from './outbox.ts';
import { runRetention } from './retention.ts';
import type { DeleteIdpUser } from './retention-customers.ts';
import { errorKind } from './sanitize.ts';
import { handleSesMessage, isSesNotification } from './ses-events.ts';
import type { WorkerCoreDeps } from './types.ts';

/**
 * Entry logic of the `worker` Lambda (design 4.2, 14): SQS batches (outbox nudges and
 * SES feedback), EventBridge schedules (outbox sweep, retention) and a direct
 * `{task:'migrate'}` invoke. Bundling and dependency construction live elsewhere.
 */

export interface WorkerDeps extends WorkerCoreDeps {
  outbox?: Pick<DrainOptions, 'batchSize' | 'maxAttempts' | 'maxBatches' | 'concurrency'>;
  deleteIdpUser?: DeleteIdpUser;
  /** Runs database migrations (deploy pipeline hook). */
  migrate?: () => Promise<unknown>;
}

export interface SqsRecord {
  messageId: string;
  body: string;
  eventSource?: string;
  eventSourceARN?: string;
}

export interface SqsEvent {
  Records: SqsRecord[];
}

export interface ScheduledEvent {
  source: 'aws.events';
  'detail-type': 'Scheduled Event';
  resources?: string[];
}

export interface TaskEvent {
  task: string;
}

export type WorkerEvent = SqsEvent | ScheduledEvent | TaskEvent;

export interface SqsBatchResponse {
  batchItemFailures: { itemIdentifier: string }[];
}

const isSqsEvent = (e: unknown): e is SqsEvent =>
  !!e && typeof e === 'object' && Array.isArray((e as SqsEvent).Records) &&
  (e as SqsEvent).Records.every(r => r && typeof r.messageId === 'string' && typeof r.body === 'string');

const isScheduled = (e: unknown): e is ScheduledEvent =>
  !!e && typeof e === 'object' && (e as ScheduledEvent).source === 'aws.events' && (e as ScheduledEvent)['detail-type'] === 'Scheduled Event';

const isTask = (e: unknown): e is TaskEvent => !!e && typeof e === 'object' && typeof (e as TaskEvent).task === 'string';

export function drain(deps: WorkerDeps) {
  return drainOutbox({ ...deps, ...deps.outbox });
}

export function retention(deps: WorkerDeps) {
  return runRetention({ pool: deps.pool, log: deps.log, now: deps.now, deleteIdpUser: deps.deleteIdpUser });
}

/** Schedule names end in the job, e.g. `arn:...:rule/saunaklar-prod-outbox-sweep`. */
export function scheduledJob(event: ScheduledEvent): 'outbox-sweep' | 'retention' | null {
  for (const arn of event.resources ?? []) {
    const name = arn.slice(arn.lastIndexOf('/') + 1);
    if (name.endsWith('outbox-sweep')) return 'outbox-sweep';
    if (name.endsWith('retention')) return 'retention';
  }
  return null;
}

export async function handleWorkerEvent(event: unknown, deps: WorkerDeps): Promise<unknown> {
  if (isSqsEvent(event)) return handleSqs(event, deps);

  if (isScheduled(event)) {
    const job = scheduledJob(event);
    if (job === 'outbox-sweep') return drain(deps);
    if (job === 'retention') {
      const result = await retention(deps);
      // Fail the invocation so Lambda error alarms fire; finished jobs are already committed.
      if (result.failedJobs.length) throw new Error(`retention jobs failed: ${result.failedJobs.join(', ')}`);
      return result;
    }
    deps.log.warn('worker.unknown_schedule', { resources: event.resources ?? [] });
    return { ignored: true };
  }

  if (isTask(event)) {
    if (event.task === 'migrate') {
      if (!deps.migrate) throw new Error('migrate is not configured for this worker');
      deps.log.info('worker.migrate_start');
      await deps.migrate();
      deps.log.info('worker.migrate_done');
      return { ok: true };
    }
    if (event.task === 'drain') return drain(deps);
    if (event.task === 'retention') return retention(deps);
    throw new Error('unknown task');
  }

  deps.log.warn('worker.unknown_event');
  throw new Error('unrecognised worker event');
}

/**
 * SES feedback records are handled one by one; outbox nudges (any other body) collapse
 * into one drain per batch. Failed records are reported for SQS partial-batch retry.
 */
async function handleSqs(event: SqsEvent, deps: WorkerDeps): Promise<SqsBatchResponse> {
  const failures: string[] = [];
  const nudges: string[] = [];
  for (const record of event.Records) {
    if (!isSesNotification(record.body)) {
      nudges.push(record.messageId);
      continue;
    }
    try {
      await handleSesMessage(record.body, deps);
    } catch (err) {
      deps.log.error('worker.ses_record_failed', { messageId: record.messageId, error: errorKind(err) });
      failures.push(record.messageId);
    }
  }
  if (nudges.length) {
    try {
      await drain(deps);
    } catch (err) {
      deps.log.error('worker.drain_failed', { error: errorKind(err) });
      failures.push(...nudges);
    }
  }
  return { batchItemFailures: failures.map(itemIdentifier => ({ itemIdentifier })) };
}
