import { drain, retention, type WorkerDeps } from './handler.ts';
import { errorKind } from './sanitize.ts';

export interface LocalWorkerOptions {
  /** Outbox sweep interval. */
  intervalMs?: number;
  /** Retention interval; 0 disables it. */
  retentionIntervalMs?: number;
  /** Run retention once at start-up. */
  retentionOnStart?: boolean;
}

export interface LocalWorker {
  /** Drain now (e.g. from the in-process queue after a request was submitted). */
  nudge(): void;
  /** Stops the timers and waits for a running drain/retention to finish. */
  stop(): Promise<void>;
}

/**
 * Local development stand-in for the worker Lambda and its schedules: drains the
 * outbox every `intervalMs` and immediately on `nudge()`, runs retention hourly.
 * Drains never overlap; a nudge during a drain triggers one more pass afterwards.
 */
export function startLocalWorker(deps: WorkerDeps, opts: LocalWorkerOptions = {}): LocalWorker {
  const intervalMs = opts.intervalMs ?? 2000;
  const retentionMs = opts.retentionIntervalMs ?? 3_600_000;
  let stopped = false;
  let running: Promise<void> | null = null;
  let again = false;
  let retentionRun: Promise<void> | null = null;

  const runDrain = (): void => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await drain(deps);
        } catch (err) {
          deps.log.error('worker.local_drain_failed', { error: errorKind(err) });
        }
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  };

  const runRetention = (): void => {
    if (stopped || retentionRun) return;
    retentionRun = retention(deps)
      .then(() => undefined)
      .catch(err => deps.log.error('worker.local_retention_failed', { error: errorKind(err) }))
      .finally(() => {
        retentionRun = null;
      });
  };

  const drainTimer = setInterval(runDrain, intervalMs);
  drainTimer.unref?.();
  const retentionTimer = retentionMs > 0 ? setInterval(runRetention, retentionMs) : null;
  retentionTimer?.unref?.();
  runDrain();
  if (opts.retentionOnStart) runRetention();
  deps.log.info('worker.local_started', { intervalMs, retentionIntervalMs: retentionMs });

  return {
    nudge: runDrain,
    async stop() {
      stopped = true;
      clearInterval(drainTimer);
      if (retentionTimer) clearInterval(retentionTimer);
      await Promise.all([running, retentionRun]);
    },
  };
}
