import { buildDeps } from '../deps.ts';
import { resolveSecretEnv } from '../lib/runtimeEnv.ts';
import { handleWorkerEvent, type WorkerDeps } from '../worker/handler.ts';
import { workerDepsFrom } from '../worker/deps.ts';

/**
 * Lambda entry of the `worker` function (design 4.2, 14): SQS (outbox nudges, SES feedback),
 * EventBridge schedules (outbox sweep, retention) and `{task:'migrate'}`. Secrets and
 * dependencies are resolved once per execution environment and reused across invocations.
 */
let deps: Promise<WorkerDeps> | undefined;

export const handler = async (event: unknown) => {
  deps ??= resolveSecretEnv().then(env => workerDepsFrom(buildDeps(env)));
  return handleWorkerEvent(event, await deps);
};
