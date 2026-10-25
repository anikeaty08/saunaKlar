import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db';
import { createHarness, type Client, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

const DAY = 86_400_000;

async function alphaStaff(): Promise<Client> {
  const c = h.client('alpha.localhost');
  await c.staffLogin('owner@alpha.test', SEED_PASSWORD);
  return c;
}

/** Runs `fn` with the app clock moved by `ms`, then restores it. */
async function withClockShift<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  const real = h.deps.now;
  h.deps.now = () => new Date(Date.now() + ms);
  try { return await fn(); } finally { h.deps.now = real; }
}

/** Ben (alpha) configures a sauna and submits a request; returns the request id. */
async function benSubmits(slug: string, message: string): Promise<{ ben: Client; requestId: string }> {
  const ben = h.client('alpha.localhost');
  await ben.login('ben@example.test', SEED_PASSWORD);
  const sauna = (await ben.get(`/api/catalog/saunas/${slug}`)).body;
  const cfg = await ben.post('/api/configurations', { saunaModelId: sauna.id });
  expect(cfg.status).toBe(201);
  const sub = await ben.post(`/api/configurations/${cfg.body.id}/requests`, { message });
  expect(sub.status).toBe(201);
  return { ben, requestId: sub.body.id };
}

describe('reseller admin: branding', () => {
  it('patches branding and the storefront tenant reflects it', async () => {
    const c = await alphaStaff();
    const r = await c.patch('/api/admin/branding', { tagline: 'Saunas for every garden', primaryColor: '#2a3b4c', vatDisplay: 'EXCLUDED' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.tagline).toBe('Saunas for every garden');
    expect(r.body.primaryColor).toBe('#2a3b4c');
    expect(r.body.vatDisplay).toBe('EXCLUDED');
    expect((await c.get('/api/admin/branding')).body.tagline).toBe('Saunas for every garden');
  });

  it('sets the storefront layout and the storefront tenant reflects it', async () => {
    const c = await alphaStaff();
    expect((await c.get('/api/admin/branding')).body.storefrontLayout).toBe('atelier');
    const r = await c.patch('/api/admin/branding', { storefrontLayout: 'journal' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.storefrontLayout).toBe('journal');
    expect((await h.client('alpha.localhost').get('/api/tenant')).body.branding.storefrontLayout).toBe('journal');
    const bad = await c.patch('/api/admin/branding', { storefrontLayout: 'brutalist' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('VALIDATION_FAILED');
    expect((await c.get('/api/admin/branding')).body.storefrontLayout).toBe('journal');
    expect((await c.patch('/api/admin/branding', { storefrontLayout: 'atelier' })).status).toBe(200);
  });

  it('rejects an invalid colour', async () => {
    const c = await alphaStaff();
    const r = await c.patch('/api/admin/branding', { primaryColor: 'red' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('is not reachable for a customer session', async () => {
    const ben = h.client('alpha.localhost');
    await ben.login('ben@example.test', SEED_PASSWORD);
    expect([401, 403]).toContain((await ben.patch('/api/admin/branding', { tagline: 'x' })).status);
  });
});

describe('reseller admin: saunas and discounts', () => {
  // effectiveDiscount is what the customer actually gets after the cap (review G5), as an amount.
  it('lists assigned saunas with the effective discount (own, else the default)', async () => {
    const c = await alphaStaff();
    const r = await c.get('/api/admin/saunas');
    expect(r.status).toBe(200);
    const bySlug = new Map(r.body.items.map((s: { slug: string }) => [s.slug, s]));
    expect(r.body.defaultDiscount).toEqual({ type: 'PERCENT', value: 1000 });
    const espoo: any = bySlug.get('espoo-compact');
    expect(espoo.discount).toEqual({ type: 'FIXED', value: 50000 });
    expect(espoo.effectiveDiscount).toEqual({ type: 'FIXED', value: Math.min(50000, Math.floor(espoo.listPriceMinor * espoo.maxDiscountBps / 10000)) });
    expect(espoo.priceFromMinor).toBe(espoo.listPriceMinor - 50000);
    const turku: any = bySlug.get('turku-panorama');
    expect(turku.discount).toBeNull();
    const turkuOff = Math.floor(turku.listPriceMinor * Math.min(1000, turku.maxDiscountBps) / 10000);
    expect(turku.effectiveDiscount).toEqual({ type: 'FIXED', value: turkuOff });
    expect(turku.priceFromMinor).toBe(turku.listPriceMinor - turkuOff);
    expect((bySlug.get('oulu-corner') as any).isVisible).toBe(false);
  });

  it('refuses a discount above the cap with the database rule code', async () => {
    const c = await alphaStaff();
    const espoo = (await c.get('/api/admin/saunas')).body.items.find((s: { slug: string }) => s.slug === 'espoo-compact');
    const r = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'PERCENT', value: espoo.maxDiscountBps + 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('DISCOUNT_EXCEEDS_CAP');
    const fixed = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'FIXED', value: espoo.listPriceMinor });
    expect(fixed.body.code).toBe('DISCOUNT_EXCEEDS_CAP');
    const ok = await c.put(`/api/admin/saunas/${espoo.id}/discount`, { type: 'PERCENT', value: espoo.maxDiscountBps });
    expect(ok.status).toBe(200);
    expect(ok.body.discount).toEqual({ type: 'PERCENT', value: espoo.maxDiscountBps });
    expect(ok.body.effectiveDiscount).toEqual({ type: 'FIXED', value: Math.floor(espoo.listPriceMinor * espoo.maxDiscountBps / 10000) });
  });

  it('toggling visibility bumps the catalog version and hides the sauna from the storefront', async () => {
    const c = await alphaStaff();
    const visitor = h.client('alpha.localhost');
    const v1 = (await visitor.get('/api/tenant')).body.catalogVersion as number;
    const kuopio = (await c.get('/api/admin/saunas')).body.items.find((s: { slug: string }) => s.slug === 'kuopio-cube');
    const r = await c.patch(`/api/admin/saunas/${kuopio.id}`, { isVisible: false });
    expect(r.status).toBe(200);
    expect(r.body.isVisible).toBe(false);
    // The API caches tenants for 60 s; read the counter directly as well as through a fresh request.
    const { rows } = await h.owner.query('select catalog_version from resellers where id = $1', [SEED.resellers.alpha]);
    expect(Number(rows[0].catalog_version)).toBeGreaterThan(v1);
    const catalog = await visitor.get(`/api/catalog?v=${rows[0].catalog_version}`);
    if (catalog.status === 200) expect(catalog.body.items.some((i: { slug: string }) => i.slug === 'kuopio-cube')).toBe(false);
    await c.patch(`/api/admin/saunas/${kuopio.id}`, { isVisible: true });
  });

  it('cannot patch a sauna that is not assigned to the reseller', async () => {
    const c = await alphaStaff();
    const r = await c.patch(`/api/admin/saunas/${SEED.models('helsinki-studio')}`, { isVisible: false });
    expect(r.status).toBe(404);
  });
});

describe('reseller admin: share links', () => {
  it('creates a link (locks the configuration, returns the URL once) and revokes it', async () => {
    const c = await alphaStaff();
    const cfg = await c.post('/api/admin/configurations', { saunaModelId: SEED.models('turku-panorama'), name: 'Showroom Turku' });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(201);
    expect(cfg.body.locked).toBe(false);

    const link = await c.post(`/api/admin/configurations/${cfg.body.id}/share-links`, { expiresInDays: 7 });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    expect(link.headers.get('cache-control')).toBe('no-store');
    const m = /^http:\/\/alpha\.localhost(?::\d+)?\/s\/([A-Za-z0-9_-]{20,})$/.exec(link.body.url);
    expect(m, link.body.url).not.toBeNull();
    const token = m![1]!;
    expect(new Date(link.body.expiresAt).getTime() - Date.now()).toBeGreaterThan(6 * DAY);

    expect((await c.get(`/api/admin/configurations/${cfg.body.id}`)).body.locked).toBe(true);
    const sel = await c.put(`/api/admin/configurations/${cfg.body.id}/selections`, { optionIds: [] });
    expect(sel.body.code).toBe('CONFIGURATION_LOCKED');

    // The token is never listed again; only its state.
    const list = await c.get(`/api/admin/configurations/${cfg.body.id}/share-links`);
    expect(list.body.items).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(list.body.items[0].state).toBe('ACTIVE');

    const visitor = h.client('alpha.localhost');
    expect((await visitor.get(`/api/shared/${token}`)).status).toBe(200);

    const revoked = await c.del(`/api/admin/configurations/${cfg.body.id}/share-links/${link.body.id}`);
    expect(revoked.status).toBe(200);
    expect(revoked.body.state).toBe('REVOKED');
    expect(revoked.body.revokedAt).not.toBeNull();
    expect([404, 410]).toContain((await visitor.get(`/api/shared/${token}`)).status);
  });
});

describe('reseller admin: customers', () => {
  it('searches customers of this tenant only and pages the matches without gaps', async () => {
    const c = await alphaStaff();
    const all = await c.get('/api/admin/customers?limit=100');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const anna = await c.get('/api/admin/customers?q=VIRTANEN');
    expect(anna.body.items.map((x: { email: string }) => x.email)).toEqual(['anna@example.test']);
    expect((await c.get('/api/admin/customers?q=%25')).body.items).toEqual([]);

    // Every seeded alpha customer matches "example"; page through them one by one.
    const matches = all.body.items.filter((x: { email: string }) => x.email.includes('example')).map((x: { id: string }) => x.id);
    expect(matches.length).toBeGreaterThan(1);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pg: { body: { items: { id: string }[]; nextCursor: string | null } } =
        await c.get(`/api/admin/customers?q=example&limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...pg.body.items.map(x => x.id));
      cursor = pg.body.nextCursor;
    } while (cursor && seen.length < 200);
    expect(seen).toEqual(matches);

    const beta = h.client('beta.localhost');
    await beta.staffLogin('owner@beta.test', SEED_PASSWORD);
    const betaAnna = await beta.get('/api/admin/customers?q=anna');
    expect(betaAnna.body.items.map((x: { id: string }) => x.id)).not.toContain(anna.body.items[0].id);
  });
});

describe('reseller admin: requests and quotes', () => {
  it('lists, searches and pages requests newest first', async () => {
    const { requestId } = await benSubmits('lappi-barrel', 'List and search');
    const c = await alphaStaff();
    const all = await c.get('/api/admin/requests?limit=100');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    const first = all.body.items[0];
    expect(first.id).toBe(requestId);
    expect(first.customerEmail).toBe('ben@example.test');
    expect(first.saunaName).toBeTruthy();
    expect(first.finalPriceMinor).toBeGreaterThan(0);
    const created = all.body.items.map((r: { createdAt: string }) => r.createdAt);
    expect([...created].sort().reverse()).toEqual(created);

    // Search matches the customer's e-mail, the customer's name, or nothing.
    const byEmail = await c.get('/api/admin/requests?q=BEN%40example');
    expect(byEmail.body.items.some((r: { id: string }) => r.id === requestId)).toBe(true);
    const byName = await c.get(`/api/admin/requests?q=${encodeURIComponent(first.customerName.split(' ')[0])}`);
    expect(byName.body.items.some((r: { id: string }) => r.id === requestId)).toBe(true);
    expect((await c.get('/api/admin/requests?q=zzqx-no-such')).body.items).toEqual([]);

    // Keyset pages of one walk the same list without gaps or repeats.
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const pg: { body: { items: { id: string }[]; nextCursor: string | null } } =
        await c.get(`/api/admin/requests?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      seen.push(...pg.body.items.map(r => r.id));
      cursor = pg.body.nextCursor;
    } while (cursor && seen.length < 200);
    expect(seen).toEqual(all.body.items.map((r: { id: string }) => r.id));
  });

  it('analytics counts the new request against its sauna', async () => {
    const before = (await (await alphaStaff()).get('/api/admin/analytics?days=30')).body;
    await benSubmits('kuopio-cube', 'Analytics');
    const c = await alphaStaff();
    const r = await c.get('/api/admin/analytics?days=30');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.totals.requests).toBe(before.totals.requests + 1);
    expect(r.body.totals.configurations).toBe(before.totals.configurations + 1);
    expect(r.body.daily).toHaveLength(30);
    expect(r.body.daily.at(-1).requests).toBeGreaterThanOrEqual(1);
    const sum = r.body.daily.reduce((n: number, d: { requests: number }) => n + d.requests, 0);
    expect(sum).toBe(r.body.totals.requests);
    const top = r.body.topSaunas as { name: string; configurations: number; requests: number }[];
    expect(top.length).toBeGreaterThan(0);
    for (const t of top) expect(t.requests).toBeLessThanOrEqual(t.configurations);
    const ranks = top.map(t => [t.requests, t.configurations] as const);
    for (let i = 1; i < ranks.length; i++) {
      const [a, b] = [ranks[i - 1]!, ranks[i]!];
      expect(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1])).toBe(true);
    }
    const prevTop = new Map((before.topSaunas as { saunaModelId: string; requests: number }[]).map(t => [t.saunaModelId, t.requests]));
    const grew = (r.body.topSaunas as { saunaModelId: string; requests: number }[]).filter(t => t.requests > (prevTop.get(t.saunaModelId) ?? 0));
    expect(grew).toHaveLength(1);
  });

  it('quotes a request and the customer accepts it', async () => {
    const { ben, requestId } = await benSubmits('lappi-barrel', 'Please quote with installation');
    const c = await alphaStaff();
    const list = await c.get('/api/admin/requests?status=SUBMITTED');
    expect(list.body.items.some((r: { id: string }) => r.id === requestId)).toBe(true);

    const validUntil = new Date(Date.now() + 14 * DAY).toISOString();
    const q = await c.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 1_234_500, validUntil, note: 'Incl. installation' });
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.status).toBe('QUOTED');
    expect(q.body.quotes.filter((x: { supersededAt: string | null }) => !x.supersededAt)).toHaveLength(1);

    const acc = await ben.post(`/api/me/requests/${requestId}/accept`);
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    expect(acc.body.status).toBe('ACCEPTED');
    const staffView = await c.get(`/api/admin/requests/${requestId}`);
    expect(staffView.body.status).toBe('ACCEPTED');
    expect(staffView.body.allowedTransitions).toEqual(expect.arrayContaining(['CLOSED']));
  });

  it('a revised quote supersedes the previous one', async () => {
    const { requestId } = await benSubmits('espoo-compact', 'Revise please');
    const c = await alphaStaff();
    const validUntil = new Date(Date.now() + 7 * DAY).toISOString();
    expect((await c.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 900_000, validUntil })).status).toBe(200);
    const r = await c.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 850_000, validUntil, note: 'Better price' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe('QUOTED');
    expect(r.body.quotes).toHaveLength(2);
    const active = r.body.quotes.filter((q: { supersededAt: string | null }) => !q.supersededAt);
    expect(active).toEqual([expect.objectContaining({ amountMinor: 850_000 })]);
  });

  it('an expired quote cannot be accepted', async () => {
    const { ben, requestId } = await benSubmits('espoo-compact', 'Quick one');
    const c = await alphaStaff();
    const validUntil = new Date(Date.now() + DAY).toISOString();
    expect((await c.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 700_000, validUntil })).status).toBe(200);
    const late = await withClockShift(2 * DAY, () => ben.post(`/api/me/requests/${requestId}/accept`));
    expect(late.body.code).toBe('QUOTE_EXPIRED');
    expect((await ben.get(`/api/me/requests/${requestId}`)).body.status).toBe('QUOTED');
  });

  it('a quote must be valid in the future', async () => {
    const { requestId } = await benSubmits('kuopio-cube', 'Past quote');
    const c = await alphaStaff();
    const r = await c.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 1, validUntil: new Date(Date.now() - DAY).toISOString() });
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('staff of beta cannot see or act on alpha requests', async () => {
    const { requestId } = await benSubmits('turku-panorama', 'Isolation check');
    const beta = h.client('beta.localhost');
    await beta.staffLogin('owner@beta.test', SEED_PASSWORD);
    const list = await beta.get('/api/admin/requests?limit=100');
    expect(list.status).toBe(200);
    expect(list.body.items.some((r: { id: string }) => r.id === requestId)).toBe(false);
    expect(JSON.stringify(list.body)).not.toContain('ben@example.test');
    expect((await beta.get(`/api/admin/requests/${requestId}`)).status).toBe(404);
    const q = await beta.put(`/api/admin/requests/${requestId}/quote`, { amountMinor: 1, validUntil: new Date(Date.now() + DAY).toISOString() });
    expect(q.status).toBe(404);
  });

  it('a beta staff session does not authenticate on the alpha host', async () => {
    const beta = h.client('beta.localhost');
    await beta.staffLogin('owner@beta.test', SEED_PASSWORD);
    const cookies = ['sk_at', 'sk_st', 'sk_staff'].map(n => beta.cookie(n)).filter(Boolean);
    const alpha = h.client('alpha.localhost');
    const header = ['sk_at', 'sk_st', 'sk_staff'].flatMap(n => (beta.cookie(n) ? [`${n}=${beta.cookie(n)}`] : [])).join('; ');
    expect(cookies.length).toBeGreaterThan(0);
    const r = await alpha.req('GET', '/api/admin/requests', undefined, { cookie: header });
    expect([401, 403]).toContain(r.status);
  });
});
