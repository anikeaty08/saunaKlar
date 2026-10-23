import { buildDeps } from '../deps.ts';
import { handleWorkerEvent, type WorkerDeps } from '../worker/handler.ts';
import { workerDepsFrom } from '../worker/deps.ts';

/**
 * Lambda entry of the `worker` function (design 4.2, 14): SQS (outbox nudges, SES feedback),
 * EventBridge schedules (outbox sweep, retention) and `{task:'migrate'}`. Dependencies are
 * built once per execution environment and reused across invocations.
 */
let deps: WorkerDeps | undefined;

export const handler = (event: unknown) => {
  deps ??= workerDepsFrom(buildDeps());
  return handleWorkerEvent(event, deps);
};
