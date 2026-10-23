import type { Hono } from 'hono';
import type { z } from 'zod';
import type { RouteDef } from '@saunaklar/shared';
import type { AppEnv, Ctx, Principal, TenantInfo } from '../context.ts';
import { ApiError } from './problem.ts';

type Infer<T> = T extends z.ZodType ? z.output<T> : undefined;

export interface HandlerArgs<R extends RouteDef> {
  c: Ctx;
  params: Record<string, string>;
  query: Infer<R['query']>;
  body: Infer<R['body']>;
  principal: Principal;
  tenant: TenantInfo | null;
}

export type Handler<R extends RouteDef> = (args: HandlerArgs<R>) => Promise<z.input<R['response']> | Response>;

function zodErrors(err: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

const MAX_JSON_BYTES = 1024 * 1024;

/**
 * Mounts a handler for one entry of the shared route table: checks the host
 * kind and access level, validates query and body with the contract's Zod
 * schemas, and (outside production) validates the response too so the API
 * can never silently drift from the contract the web app relies on.
 */
export function mount<R extends RouteDef>(app: Hono<AppEnv>, def: R, handler: Handler<R>): void {
  app.on(def.method, def.path, async c => {
    const host = c.get('host');
    if (def.host !== 'any' && host.kind !== def.host) throw new ApiError('NOT_FOUND', 'No such endpoint on this host.');

    const principal = c.get('principal');
    authorize(c, def, principal);

    let query: unknown = undefined;
    if (def.query) {
      const parsed = def.query.safeParse(c.req.query());
      if (!parsed.success) throw new ApiError('VALIDATION_FAILED', undefined, { errors: zodErrors(parsed.error) });
      query = parsed.data;
    }

    let body: unknown = undefined;
    if (def.body) {
      const len = Number(c.req.header('content-length') ?? 0);
      if (len > MAX_JSON_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE');
      const type = c.req.header('content-type') ?? '';
      if (!type.startsWith('application/json')) throw new ApiError('UNSUPPORTED_MEDIA_TYPE', 'Send JSON.');
      let raw: unknown;
      try {
        raw = await c.req.json();
      } catch {
        throw new ApiError('BAD_REQUEST', 'Malformed JSON.');
      }
      const parsed = def.body.safeParse(raw);
      if (!parsed.success) throw new ApiError('VALIDATION_FAILED', undefined, { errors: zodErrors(parsed.error) });
      body = parsed.data;
    }

    const result = await handler({ c, params: c.req.param() as Record<string, string>, query: query as never, body: body as never, principal, tenant: c.get('tenant') });
    if (result instanceof Response) return result;
    const { config, log } = c.get('deps');
    if (config.NODE_ENV !== 'production') {
      const check = def.response.safeParse(result);
      if (!check.success) {
        log.error('response does not match contract', { route: `${def.method} ${def.path}`, errors: zodErrors(check.error) });
        throw new ApiError('INTERNAL', 'Response does not match the API contract.');
      }
    }
    if (def.status === 204) return c.body(null, 204);
    return c.json(result as object, (def.status ?? 200) as 200);
  });
}

function authorize(c: Ctx, def: RouteDef, principal: Principal): void {
  const expired = () => (c.get('sessionExpired') ? new ApiError('SESSION_EXPIRED') : new ApiError('UNAUTHENTICATED'));
  switch (def.access) {
    case 'public':
      return;
    case 'any-session':
      if (principal.kind === 'anonymous') throw expired();
      return;
    case 'customer':
      if (principal.kind !== 'customer') throw principal.kind === 'anonymous' ? expired() : new ApiError('FORBIDDEN');
      return;
    case 'reseller-staff':
      if (principal.kind !== 'staff') throw principal.kind === 'anonymous' ? expired() : new ApiError('FORBIDDEN');
      if (principal.scope !== 'RESELLER') throw new ApiError('FORBIDDEN');
      return;
    case 'manufacturer-staff':
      if (principal.kind !== 'staff') throw principal.kind === 'anonymous' ? expired() : new ApiError('FORBIDDEN');
      if (principal.scope !== 'MANUFACTURER') throw new ApiError('FORBIDDEN');
      return;
  }
}

/** Narrowing helpers for handlers whose route already enforced the access level. */
export function asCustomer(p: Principal) {
  if (p.kind !== 'customer') throw new ApiError('UNAUTHENTICATED');
  return p;
}
export function asStaff(p: Principal) {
  if (p.kind !== 'staff') throw new ApiError('UNAUTHENTICATED');
  return p;
}
