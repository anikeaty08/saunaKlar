/**
 * Typed API client over the shared route table: `api('sauna', { params: { slug } })`.
 *
 * - Same-origin, `credentials: 'include'` (session cookies are `__Host-` and HttpOnly).
 * - Every non-GET carries `X-CSRF-Token`, taken from `GET /api/auth/session`
 *   and refreshed from any response that returns a session.
 * - Errors are RFC 9457 problem documents and surface as `ApiError` with the
 *   stable `code` from `ERROR_CODES`.
 * - In development responses are validated against the route's Zod schema, so
 *   contract drift between the API and the SPA fails loudly.
 */
import {
  buildPath,
  problemSchema,
  routes,
  type BodyOf,
  type ErrorCode,
  type Problem,
  type QueryOf,
  type ResponseOf,
  type RouteName,
} from '@saunaklar/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK' | 'CONTRACT';
  readonly problem: Problem | null;
  readonly requestId: string | null;

  constructor(status: number, code: ApiError['code'], message: string, problem: Problem | null = null, requestId: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.problem = problem;
    this.requestId = requestId;
  }

  /** Field errors for VALIDATION_FAILED, keyed by dotted path. */
  get fieldErrors(): Record<string, string[]> {
    return this.problem?.errors ?? {};
  }

  get meta(): Record<string, unknown> {
    return this.problem?.meta ?? {};
  }
}

export const isApiError = (e: unknown, code?: ApiError['code']): e is ApiError =>
  e instanceof ApiError && (code === undefined || e.code === code);

// ---- transport (swappable for the mock API and tests) -------------------------

type Fetch = (input: Request) => Promise<Response>;
let transport: Fetch = req => fetch(req);
export function setTransport(f: Fetch): void {
  transport = f;
}

// ---- language -------------------------------------------------------------------

let language: () => string | null = () => null;
/** Catalogue names and descriptions come back in this language (Accept-Language). */
export function setLanguageProvider(p: () => string | null): void {
  language = p;
}

// ---- CSRF -----------------------------------------------------------------------

let csrfToken: string | null = null;
let csrfInFlight: Promise<string> | null = null;
type CsrfProvider = () => Promise<string>;

let csrfProvider: CsrfProvider = async () => {
  const s = await api('session');
  return s.csrfToken;
};

/** Lets the app (or tests) supply the token another way. */
export function setCsrfProvider(p: CsrfProvider): void {
  csrfProvider = p;
  csrfToken = null;
}
export function setCsrfToken(token: string | null): void {
  csrfToken = token;
}

async function getCsrfToken(): Promise<string> {
  if (csrfToken) return csrfToken;
  csrfInFlight ??= csrfProvider().finally(() => {
    csrfInFlight = null;
  });
  csrfToken = await csrfInFlight;
  return csrfToken;
}

// ---- calls ----------------------------------------------------------------------

type RouteDefOf<N extends RouteName> = (typeof routes)[N];
type HasParams<P extends string> = P extends `${string}:${string}` ? true : false;
type ParamNames<P extends string> = P extends `${string}:${infer K}/${infer Rest}` ? K | ParamNames<`/${Rest}`> : P extends `${string}:${infer K}` ? K : never;

export type CallOptions<N extends RouteName> =
  & (HasParams<RouteDefOf<N>['path']> extends true ? { params: Record<ParamNames<RouteDefOf<N>['path']>, string> } : { params?: undefined })
  & ([QueryOf<N>] extends [never] ? { query?: undefined } : { query?: QueryOf<N> })
  & ([BodyOf<N>] extends [never] ? { body?: undefined } : { body: BodyOf<N> })
  & { signal?: AbortSignal };

type MaybeOptions<N extends RouteName> = HasParams<RouteDefOf<N>['path']> extends true
  ? [opts: CallOptions<N>]
  : [BodyOf<N>] extends [never]
    ? [opts?: CallOptions<N>]
    : [opts: CallOptions<N>];

const VALIDATE = import.meta.env.DEV;

function queryString(q: Record<string, unknown> | undefined): string {
  if (!q) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function readProblem(res: Response): Promise<ApiError> {
  const requestId = res.headers.get('x-request-id');
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* not JSON */
  }
  const parsed = problemSchema.safeParse(body);
  if (parsed.success) {
    const p = parsed.data;
    return new ApiError(res.status, p.code, p.detail ?? p.title, p, requestId ?? p.requestId ?? null);
  }
  const fallback: ErrorCode = res.status === 401 ? 'UNAUTHENTICATED' : res.status === 403 ? 'FORBIDDEN' : res.status === 404 ? 'NOT_FOUND' : res.status === 429 ? 'RATE_LIMITED' : 'INTERNAL';
  return new ApiError(res.status, fallback, res.statusText || 'Request failed', null, requestId);
}

/**
 * Translated public catalogue responses are cached at the CDN per URL, so the
 * language travels in the query string (`?v=…&lang=…`) as well as in
 * Accept-Language.
 */
const LANGUAGE_IN_QUERY: ReadonlySet<RouteName> = new Set<RouteName>(['catalog', 'sauna', 'rooms']);

export async function api<N extends RouteName>(name: N, ...args: MaybeOptions<N>): Promise<ResponseOf<N>> {
  const opts = (args[0] ?? {}) as { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown; signal?: AbortSignal };
  const def = routes[name];
  const lang = LANGUAGE_IN_QUERY.has(name) ? language() : null;
  const query = lang ? { ...opts.query, lang } : opts.query;
  const url = buildPath(def.path, opts.params) + queryString(query);
  const method = def.method;

  const send = async (): Promise<Response> => {
    const headers = new Headers({ Accept: 'application/json, application/problem+json' });
    const lang = language();
    if (lang) headers.set('Accept-Language', lang);
    if (method !== 'GET') headers.set('X-CSRF-Token', await getCsrfToken());
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      body = JSON.stringify(opts.body);
    }
    const init: RequestInit = { method, headers, credentials: 'include' };
    if (body !== undefined) init.body = body;
    if (opts.signal) init.signal = opts.signal;
    try {
      return await transport(new Request(url, init));
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      throw new ApiError(0, 'NETWORK', 'The connection failed. Check your network and try again.');
    }
  };

  let res = await send();
  if (res.status === 403 && method !== 'GET') {
    const err = await readProblem(res.clone());
    if (err.code === 'CSRF_FAILED') {
      // Token rotated (new session after login, expiry): fetch a new one once.
      csrfToken = null;
      res = await send();
    }
  }
  if (!res.ok) throw await readProblem(res);

  const data: unknown = res.status === 204 ? { ok: true } : await res.json();
  // Responses that carry a session also carry the fresh CSRF token.
  if (data && typeof data === 'object' && 'csrfToken' in data && typeof (data as { csrfToken: unknown }).csrfToken === 'string') {
    csrfToken = (data as { csrfToken: string }).csrfToken;
  }
  if (VALIDATE) {
    const parsed = def.response.safeParse(data);
    if (!parsed.success) {
      console.error(`[api] ${method} ${url} response does not match the contract`, parsed.error.issues, data);
      throw new ApiError(res.status, 'CONTRACT', `Response of ${name} does not match the contract.`, null, res.headers.get('x-request-id'));
    }
    return parsed.data as ResponseOf<N>;
  }
  return data as ResponseOf<N>;
}
