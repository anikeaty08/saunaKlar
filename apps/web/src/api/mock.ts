/**
 * In-browser API used when `VITE_MOCK_API=1`. It plugs in as the client's
 * transport, so the real client code path (CSRF, problem+json, contract
 * validation) is exercised. State lives in sessionStorage per tab.
 *
 * Handy for demos: any e-mail logs in; password `wrong` fails; verification
 * code is any 6 digits; share token `demo` opens a shared configuration; run
 * `__mock.bumpCatalog()` in the console to exercise the 409 stale-version path.
 */
import { calculatePrice, type Discount as PricingDiscount } from '@saunaklar/pricing';
import { defaultSelection, validate, type ModelRules } from '@saunaklar/rules';
import { routes, type ErrorCode, type RouteName, ERROR_STATUS, CUSTOMER_TRANSITIONS } from '@saunaklar/shared';
import { setTransport } from './client.ts';
import { MOCK_TENANTS, ROOM_PRESETS, fid, saunaDetails, tenantDto } from './mock-data.ts';
import type { Configuration, RequestDto, SaunaDetail, Session } from './types.ts';
import { currentHost } from '../host.ts';

type Json = Record<string, unknown>;
interface Ctx { params: Record<string, string>; query: URLSearchParams; body: Json; req: Request }

class Problem extends Error {
  constructor(readonly code: ErrorCode, readonly detail: string, readonly extra: Json = {}) {
    super(detail);
  }
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'x-request-id': crypto.randomUUID(), ...headers },
  });

const problem = (p: Problem) =>
  new Response(JSON.stringify({ type: `https://errors.saunaklar.dev/${p.code.toLowerCase()}`, title: p.code.replace(/_/g, ' ').toLowerCase(), status: ERROR_STATUS[p.code], code: p.code, detail: p.detail, ...p.extra }), {
    status: ERROR_STATUS[p.code],
    headers: { 'Content-Type': 'application/problem+json', 'x-request-id': crypto.randomUUID(), 'Cache-Control': 'no-store' },
  });

// ---- state ------------------------------------------------------------------------

interface Customer { id: string; email: string; firstName: string; lastName: string; phone: string | null; locale: string; createdAt: string }
interface StoredConfig { id: string; name: string; saunaSlug: string; selections: string[]; placement: Configuration['placement']; lockedAt: string | null; snapshotAt: string | null; source: string | null; createdAt: string; updatedAt: string }
interface StoredRequest { id: string; configurationId: string; status: RequestDto['status']; message: string | null; history: RequestDto['history']; createdAt: string; updatedAt: string; quote: RequestDto['activeQuote'] }
interface State { csrf: string; customer: Customer | null; pending: Record<string, Omit<Customer, 'id' | 'createdAt'>>; configs: StoredConfig[]; requests: StoredRequest[] }

const KEY = 'saunaklar:mock-api';
let catalogVersion = 7;

function load(): State {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* ignore */
  }
  return { csrf: crypto.randomUUID(), customer: null, pending: {}, configs: [], requests: [] };
}
let state = load();
const save = () => {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
};

const now = () => new Date().toISOString();
const plusDays = (iso: string, d: number) => new Date(new Date(iso).getTime() + d * 86_400_000).toISOString();

// ---- tenant and catalogue ----------------------------------------------------------

function tenant() {
  const host = currentHost();
  const t = host.kind === 'storefront' ? MOCK_TENANTS[host.slug] : undefined;
  if (!t) throw new Problem('TENANT_NOT_FOUND', 'No storefront is registered for this address.');
  return t;
}

function effectiveDiscount(slug: string): PricingDiscount | null {
  const t = tenant();
  return t.perSauna[slug] ?? t.defaultDiscount ?? null;
}

function saunas(): SaunaDetail[] {
  const t = tenant();
  return saunaDetails()
    .filter(s => !t.hidden.includes(s.slug))
    .map(s => {
      const d = effectiveDiscount(s.slug);
      const p = calculatePrice({ listPriceMinor: s.listPriceMinor, maxDiscountBps: s.maxDiscountBps, options: [], perSaunaDiscount: t.perSauna[s.slug] ?? null, defaultDiscount: t.defaultDiscount });
      return { ...s, discount: d, priceFromMinor: p.finalPriceMinor };
    });
}

function sauna(slug: string): SaunaDetail {
  const s = saunas().find(x => x.slug === slug);
  if (!s) throw new Problem('SAUNA_NOT_OFFERED', 'This sauna is not offered here.');
  return s;
}

const rulesOf = (s: SaunaDetail): ModelRules => ({
  groups: s.groups.map(g => ({ id: g.id, code: g.code, selectionType: g.selectionType, required: g.required, options: g.options.map(o => ({ id: o.id, code: o.code, isDefault: o.isDefault })) })),
  requires: s.rules.requires,
  excludes: s.rules.excludes,
});

function priceOf(s: SaunaDetail, selections: string[]) {
  const t = tenant();
  const opts = s.groups.flatMap(g => g.options).filter(o => selections.includes(o.id));
  const b = calculatePrice({
    listPriceMinor: s.listPriceMinor,
    maxDiscountBps: s.maxDiscountBps,
    options: opts.map(o => ({ optionId: o.id, priceDeltaMinor: o.priceDeltaMinor })),
    perSaunaDiscount: t.perSauna[s.slug] ?? null,
    defaultDiscount: t.defaultDiscount,
  });
  return {
    currency: 'EUR',
    listPriceMinor: b.listPriceMinor,
    optionsTotalMinor: b.optionsTotalMinor,
    subtotalMinor: b.subtotalMinor,
    discountSource: b.discountSource,
    discountType: b.discountType,
    discountValue: b.discountValue,
    discountMinor: b.discountMinor,
    finalPriceMinor: b.finalPriceMinor,
    lines: b.lines,
  };
}

function checkVersion(q: URLSearchParams) {
  const v = q.get('v');
  if (v !== null && Number(v) !== catalogVersion) {
    throw new Problem('STALE_CATALOG_VERSION', 'The catalogue has changed.', { meta: { currentVersion: catalogVersion } });
  }
}

// ---- configurations -------------------------------------------------------------------

function requireCustomer(): Customer {
  if (!state.customer) throw new Problem('UNAUTHENTICATED', 'Please log in.');
  return state.customer;
}

function ownConfig(id: string): StoredConfig {
  requireCustomer();
  const c = state.configs.find(x => x.id === id);
  if (!c) throw new Problem('NOT_FOUND', 'Configuration not found.');
  return c;
}

function configDto(c: StoredConfig): Configuration {
  const s = sauna(c.saunaSlug);
  const price = priceOf(s, c.selections);
  const req = state.requests.find(r => r.configurationId === c.id);
  return {
    id: c.id,
    name: c.name,
    sauna: { id: s.id, slug: s.slug, name: s.name, thumbnailUrl: s.assets.thumbnailUrl },
    selections: c.selections,
    placement: c.placement,
    locked: c.lockedAt !== null,
    lockedAt: c.lockedAt,
    price,
    snapshot: c.lockedAt ? { ...price, computedAt: c.snapshotAt!, priceValidUntil: plusDays(c.snapshotAt!, 30) } : null,
    owner: 'CUSTOMER',
    customerId: state.customer?.id ?? null,
    sourceConfigurationId: c.source,
    request: req ? { id: req.id, status: req.status } : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function summaryDto(c: StoredConfig) {
  const d = configDto(c);
  return { id: d.id, name: d.name, sauna: d.sauna, locked: d.locked, lockedAt: d.lockedAt, owner: d.owner, request: d.request, createdAt: d.createdAt, updatedAt: d.updatedAt, finalPriceMinor: d.price.finalPriceMinor, currency: d.price.currency };
}

function requestDto(r: StoredRequest): RequestDto {
  const c = state.configs.find(x => x.id === r.configurationId)!;
  const d = configDto(c);
  const s = sauna(c.saunaSlug);
  return {
    id: r.id,
    status: r.status,
    message: r.message,
    configuration: {
      id: c.id,
      name: c.name,
      sauna: { id: s.id, slug: s.slug, name: s.name },
      selections: s.groups.flatMap(g => g.options.filter(o => c.selections.includes(o.id)).map(o => ({ optionId: o.id, groupName: g.name, optionName: o.name, priceDeltaMinor: o.priceDeltaMinor }))),
    },
    snapshot: d.snapshot!,
    activeQuote: r.quote,
    history: r.history,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function page<T>(items: T[], q: URLSearchParams) {
  const limit = Number(q.get('limit') ?? 25);
  const start = Number(q.get('cursor') ?? 0);
  const slice = items.slice(start, start + limit);
  return { items: slice, nextCursor: start + limit < items.length ? String(start + limit) : null };
}

function session(): Session {
  return state.customer
    ? { kind: 'customer', csrfToken: state.csrf, customer: { id: state.customer.id, email: state.customer.email, firstName: state.customer.firstName, lastName: state.customer.lastName, locale: state.customer.locale } }
    : { kind: 'anonymous', csrfToken: state.csrf };
}

function transition(r: StoredRequest, to: RequestDto['status']) {
  if (!CUSTOMER_TRANSITIONS[r.status].includes(to)) throw new Problem('INVALID_TRANSITION', `A ${r.status.toLowerCase()} request cannot be ${to.toLowerCase()}.`);
  if (to === 'ACCEPTED' && r.quote && new Date(r.quote.validUntil) < new Date()) throw new Problem('QUOTE_EXPIRED', 'The quote has expired.');
  r.history.push({ fromStatus: r.status, toStatus: to, actor: 'CUSTOMER', actorName: null, note: null, at: now() });
  r.status = to;
  r.updatedAt = now();
}

// ---- handlers ------------------------------------------------------------------------------

type Handler = (c: Ctx) => unknown;

const handlers: Partial<Record<RouteName, Handler>> = {
  tenant: () => tenantDto(tenant(), catalogVersion),
  catalog: ({ query }) => {
    checkVersion(query);
    return { catalogVersion, currency: 'EUR', items: saunas().map(({ groups: _g, rules: _r, maxDiscountBps: _m, ...item }) => item) };
  },
  sauna: ({ params, query }) => {
    checkVersion(query);
    return sauna(params.slug!);
  },
  rooms: ({ query }) => {
    checkVersion(query);
    return { items: ROOM_PRESETS.map(r => ({ id: fid(`room:${r.code}`), code: r.code, name: r.name, description: r.description, preset: r.preset, thumbnailUrl: null, lowGlbUrl: null, highGlbUrl: null })) };
  },
  session: () => session(),
  refresh: () => session(),
  logout: () => {
    state.customer = null;
    state.csrf = crypto.randomUUID();
    return { ok: true };
  },
  login: ({ body }) => {
    const email = String(body.email ?? '').toLowerCase();
    if (body.password === 'wrong') throw new Problem('INVALID_CREDENTIALS', 'E-mail or password is incorrect.');
    const pending = state.pending[email];
    if (pending) throw new Problem('EMAIL_NOT_VERIFIED', 'Please verify your e-mail address first.');
    const local = email.split('@')[0] ?? 'guest';
    state.customer = { id: fid(`customer:${email}`), email, firstName: local.charAt(0).toUpperCase() + local.slice(1), lastName: 'Virtanen', phone: null, locale: 'en', createdAt: now() };
    state.csrf = crypto.randomUUID();
    return session();
  },
  signup: ({ body }) => {
    const email = String(body.email).toLowerCase();
    state.pending[email] = { email, firstName: String(body.firstName), lastName: String(body.lastName), phone: (body.phone as string) || null, locale: 'en' };
    return { accepted: true };
  },
  resendCode: () => ({ accepted: true }),
  confirm: ({ body }) => {
    const email = String(body.email).toLowerCase();
    const p = state.pending[email];
    if (!p) throw new Problem('CODE_INVALID', 'That code is not valid.');
    if (body.code === '000000') throw new Problem('CODE_EXPIRED', 'That code has expired. Request a new one.');
    delete state.pending[email];
    state.customer = { ...p, id: fid(`customer:${email}`), createdAt: now() };
    state.csrf = crypto.randomUUID();
    return session();
  },
  forgotPassword: () => ({ accepted: true }),
  resetPassword: ({ body }) => {
    if (body.code === '000000') throw new Problem('CODE_EXPIRED', 'That code has expired. Request a new one.');
    return { ok: true };
  },
  me: () => {
    const c = requireCustomer();
    return { id: c.id, email: c.email, firstName: c.firstName, lastName: c.lastName, phone: c.phone, locale: c.locale, emailVerifiedAt: c.createdAt, createdAt: c.createdAt };
  },
  patchMe: ({ body }) => {
    const c = requireCustomer();
    Object.assign(c, Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)));
    return handlers.me!({} as Ctx);
  },
  configurations: ({ query }) => {
    requireCustomer();
    return page([...state.configs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summaryDto), query);
  },
  createConfiguration: ({ body }) => {
    requireCustomer();
    const s = saunas().find(x => x.id === body.saunaModelId);
    if (!s) throw new Problem('SAUNA_NOT_OFFERED', 'This sauna is not offered here.');
    const selections = (body.selections as string[] | undefined) ?? defaultSelection(rulesOf(s));
    const v = validate(rulesOf(s), selections);
    if (!v.valid) throw new Problem('OPTION_RULES_VIOLATED', v.issues[0]!.message);
    const n = state.configs.filter(c => c.saunaSlug === s.slug).length + 1;
    const c: StoredConfig = { id: crypto.randomUUID(), name: (body.name as string) || `${s.name} #${n}`, saunaSlug: s.slug, selections, placement: null, lockedAt: null, snapshotAt: null, source: null, createdAt: now(), updatedAt: now() };
    state.configs.push(c);
    return configDto(c);
  },
  configuration: ({ params }) => configDto(ownConfig(params.id!)),
  renameConfiguration: ({ params, body }) => {
    const c = ownConfig(params.id!);
    c.name = String(body.name);
    c.updatedAt = now();
    return configDto(c);
  },
  deleteConfiguration: ({ params }) => {
    const c = ownConfig(params.id!);
    if (c.lockedAt) throw new Problem('CONFIGURATION_LOCKED', 'A sent or shared configuration cannot be deleted.');
    state.configs = state.configs.filter(x => x.id !== c.id);
    return { ok: true };
  },
  putSelections: ({ params, body }) => {
    const c = ownConfig(params.id!);
    if (c.lockedAt) throw new Problem('CONFIGURATION_LOCKED', 'This configuration is locked. Clone it to make changes.');
    const ids = body.optionIds as string[];
    const v = validate(rulesOf(sauna(c.saunaSlug)), ids);
    // Drafts may be incomplete; structural problems are refused.
    const hard = v.issues.filter(i => i.code !== 'REQUIRED_GROUP_EMPTY');
    if (hard.length) throw new Problem('OPTION_RULES_VIOLATED', hard[0]!.message);
    c.selections = ids;
    c.updatedAt = now();
    return configDto(c);
  },
  putPlacement: ({ params, body }) => {
    const c = ownConfig(params.id!);
    if (c.lockedAt) throw new Problem('CONFIGURATION_LOCKED', 'This configuration is locked.');
    c.placement = (body && 'roomSceneId' in body ? body : null) as Configuration['placement'];
    c.updatedAt = now();
    return configDto(c);
  },
  price: ({ params }) => configDto(ownConfig(params.id!)).price,
  clone: ({ params }) => {
    const src = ownConfig(params.id!);
    const c: StoredConfig = { ...src, id: crypto.randomUUID(), name: `${src.name} (copy)`, lockedAt: null, snapshotAt: null, source: src.id, createdAt: now(), updatedAt: now() };
    state.configs.push(c);
    return configDto(c);
  },
  submitRequest: ({ params, body }) => {
    let c = ownConfig(params.id!);
    // An expired locked price is re-priced into a fresh locked copy, like the API does.
    if (c.snapshotAt && new Date(plusDays(c.snapshotAt, 30)) < new Date()) {
      c = { ...c, id: crypto.randomUUID(), lockedAt: now(), snapshotAt: now(), source: c.id, createdAt: now(), updatedAt: now() };
      state.configs.push(c);
    }
    if (state.requests.some(r => r.configurationId === c.id)) throw new Problem('REQUEST_EXISTS', 'A request for this configuration was already sent.');
    const v = validate(rulesOf(sauna(c.saunaSlug)), c.selections);
    if (!v.valid) throw new Problem('OPTION_RULES_VIOLATED', v.issues[0]!.message);
    c.lockedAt ??= now();
    c.snapshotAt ??= c.lockedAt;
    const r: StoredRequest = { id: crypto.randomUUID(), configurationId: c.id, status: 'SUBMITTED', message: (body.message as string) || null, history: [{ fromStatus: null, toStatus: 'SUBMITTED', actor: 'CUSTOMER', actorName: null, note: null, at: now() }], createdAt: now(), updatedAt: now(), quote: null };
    state.requests.push(r);
    return requestDto(r);
  },
  myRequests: ({ query }) => {
    requireCustomer();
    return page([...state.requests].reverse().map(r => {
      const d = requestDto(r);
      return { id: d.id, status: d.status, saunaName: d.configuration.sauna.name, configurationName: d.configuration.name, finalPriceMinor: d.snapshot.finalPriceMinor, currency: d.snapshot.currency, createdAt: d.createdAt, updatedAt: d.updatedAt };
    }), query);
  },
  myRequest: ({ params }) => {
    requireCustomer();
    const r = state.requests.find(x => x.id === params.id);
    if (!r) throw new Problem('NOT_FOUND', 'Request not found.');
    return requestDto(r);
  },
  cancelRequest: ({ params }) => {
    const r = state.requests.find(x => x.id === params.id);
    if (!r) throw new Problem('NOT_FOUND', 'Request not found.');
    transition(r, 'CANCELLED');
    return requestDto(r);
  },
  acceptRequest: ({ params, body }) => {
    const r = state.requests.find(x => x.id === params.id);
    if (!r) throw new Problem('NOT_FOUND', 'Request not found.');
    if (!r.quote) throw new Problem('QUOTE_MISSING', 'There is no quote to accept yet.');
    // quoteId is optional; when sent it must be the active quote, else 409 with the new id.
    const quoteId = (body as Json | undefined)?.quoteId;
    if (typeof quoteId === 'string' && quoteId !== r.quote.id) throw new Problem('CONFLICT', 'The quote changed. Review the new one.', { meta: { activeQuoteId: r.quote.id } });
    transition(r, 'ACCEPTED');
    return requestDto(r);
  },
  shared: ({ params }) => {
    if (params.token !== 'demo') throw new Problem('SHARE_LINK_EXPIRED', 'This link has expired.');
    const { maxDiscountBps: _m, ...s } = sauna('fjord-panorama');
    const selections = defaultSelection(rulesOf(sauna('fjord-panorama')));
    const lockedAt = plusDays(now(), -3);
    const price = priceOf(sauna('fjord-panorama'), selections);
    return {
      configuration: { id: fid('shared:demo'), name: 'Panorama for the lake house', selections, lockedAt },
      sauna: s,
      placement: { roomSceneId: fid('room:garden'), positionXMm: 600, positionZMm: -400, rotationDeg: 20 },
      snapshot: { ...price, computedAt: lockedAt, priceValidUntil: plusDays(lockedAt, 30) },
      expiresAt: plusDays(now(), 27),
    };
  },
  claimShared: () => {
    requireCustomer();
    const s = sauna('fjord-panorama');
    const c: StoredConfig = { id: crypto.randomUUID(), name: 'Panorama for the lake house', saunaSlug: s.slug, selections: defaultSelection(rulesOf(s)), placement: null, lockedAt: now(), snapshotAt: now(), source: fid('shared:demo'), createdAt: now(), updatedAt: now() };
    state.configs.push(c);
    return { configurationId: c.id };
  },
  assetSession: () => ({ tier: state.customer ? 'FULL' : 'LOW', expiresAt: new Date(Date.now() + 600_000).toISOString() }),
  assetAr: () => ({ glbUrl: null, usdzUrl: null, expiresAt: new Date(Date.now() + 300_000).toISOString() }),
};

// ---- router ---------------------------------------------------------------------------------

const table = (Object.entries(routes) as [RouteName, (typeof routes)[RouteName]][]).map(([name, def]) => {
  const keys: string[] = [];
  const re = new RegExp(`^${def.path.replace(/:([A-Za-z]+)/g, (_, k: string) => (keys.push(k), '([^/]+)'))}$`);
  return { name, def, keys, re };
});

const delay = () => new Promise(r => setTimeout(r, 140 + Math.random() * 260));

async function mockFetch(req: Request): Promise<Response> {
  const url = new URL(req.url, location.origin);
  await delay();
  const hit = table.find(t => t.def.method === req.method && t.re.test(url.pathname));
  if (!hit) return problem(new Problem('NOT_FOUND', `No route ${req.method} ${url.pathname}.`));
  const handler = handlers[hit.name];
  if (!handler) return problem(new Problem('INTERNAL', `${hit.name} is not available in the mock API.`));
  try {
    if (req.method !== 'GET' && req.headers.get('X-CSRF-Token') !== state.csrf) throw new Problem('CSRF_FAILED', 'Security token mismatch.');
    const m = hit.re.exec(url.pathname)!;
    const params = Object.fromEntries(hit.keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)]));
    const text = req.method === 'GET' ? '' : await req.text();
    const body = text ? (JSON.parse(text) as Json) : {};
    if ('body' in hit.def && hit.def.body) {
      const parsed = hit.def.body.safeParse(text ? JSON.parse(text) : undefined);
      if (!parsed.success) {
        const errors: Record<string, string[]> = {};
        for (const i of parsed.error.issues) (errors[i.path.join('.') || '_'] ??= []).push(i.message);
        throw new Problem('VALIDATION_FAILED', 'Please check the highlighted fields.', { errors });
      }
    }
    const data = handler({ params, query: url.searchParams, body, req });
    save();
    const status = 'status' in hit.def && hit.def.status ? hit.def.status : 200;
    const versioned = hit.name === 'catalog' || hit.name === 'sauna' || hit.name === 'rooms';
    return json(data, status, versioned && url.searchParams.get('v') ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : { 'Cache-Control': 'no-store' });
  } catch (e) {
    if (e instanceof Problem) return problem(e);
    console.error('[mock]', e);
    return problem(new Problem('INTERNAL', 'Unexpected error in the mock API.'));
  }
}

export function installMock(): void {
  setTransport(mockFetch);
  (window as unknown as { __mock: unknown }).__mock = {
    bumpCatalog: () => ++catalogVersion,
    /** Staff quotes (or re-quotes) the latest request: `__mock.quote()` then accept to exercise the 409 path. */
    quote: (amountMinor = 1_890_000, requestId?: string) => {
      const r = requestId ? state.requests.find(x => x.id === requestId) : state.requests.at(-1);
      if (!r) return 'no request';
      const at = now();
      r.quote = { id: crypto.randomUUID(), amountMinor, currency: 'CHF', validUntil: plusDays(at, 30), note: null, createdAt: at, supersededAt: null };
      if (r.status !== 'QUOTED') {
        r.history.push({ fromStatus: r.status, toStatus: 'QUOTED', actor: 'STAFF', actorName: 'Showroom', note: null, at });
        r.status = 'QUOTED';
      }
      r.updatedAt = at;
      save();
      return r.quote.id;
    },
    reset: () => {
      sessionStorage.removeItem(KEY);
      state = load();
    },
  };
  console.info('%cMock API active', 'font-weight:bold', '— any e-mail logs in; share token "demo"; __mock.bumpCatalog(); __mock.quote()');
}
