import { handle } from 'hono/aws-lambda';
import type { LambdaFunction } from '@saunaklar/shared';
import { createApp } from '../app.ts';
import { buildDeps } from '../deps.ts';
import { resolveSecretEnv } from '../lib/runtimeEnv.ts';

/**
 * Lambda entry factory for the HTTP functions. Secrets, dependencies and the
 * app are resolved once per execution environment and reused across invocations.
 */
export function httpHandler(fn: LambdaFunction) {
  let handler: Promise<ReturnType<typeof handle>> | undefined;
  return async (event: Parameters<ReturnType<typeof handle>>[0], context: Parameters<ReturnType<typeof handle>>[1]) => {
    handler ??= resolveSecretEnv().then(env => handle(createApp(buildDeps(env), [fn])));
    return (await handler)(event, context);
  };
}
