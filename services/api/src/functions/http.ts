import { handle } from 'hono/aws-lambda';
import type { LambdaFunction } from '@saunaklar/shared';
import { createApp } from '../app.ts';
import { buildDeps } from '../deps.ts';

/**
 * Lambda entry factory for the HTTP functions. Dependencies and the app are
 * built once per execution environment and reused across invocations.
 */
export function httpHandler(fn: LambdaFunction) {
  let handler: ReturnType<typeof handle> | undefined;
  return (event: Parameters<ReturnType<typeof handle>>[0], context: Parameters<ReturnType<typeof handle>>[1]) => {
    handler ??= handle(createApp(buildDeps(), [fn]));
    return handler(event, context);
  };
}
