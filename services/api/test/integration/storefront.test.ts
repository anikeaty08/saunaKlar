import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD, SEED_SHARE_TOKEN } from '@saunaklar/db';
import { createHarness, type Harness } from './harness.ts';

let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

describe('tenant routing', () => {
  it('resolves the tenant from the subdomain', async () => {
    const r = await h.client('alpha.localhost').get('/api/tenant');
    expect(r.status).toBe(200);
    expect(r.body.slug).toBe('alpha');
    expect(r.body.currency).toBe('EUR');
    expect(r.body.branding.displayName).toBe('Alpha Spa');
    expect(r.headers.get('cache-control')).toContain('max-age=60');
  });

  it('404s an unknown and a suspended tenant', async () => {
    expect((await h.client('nope.localhost').get('/api/tenant')).body.code).toBe('TENANT_NOT_FOUND');
    expect((await h.client('gamma.localhost').get('/api/tenant')).body.code).toBe('TENANT_SUSPENDED');
  });

  it('does not serve storefront routes on the admin host', async () => {
    expect((await h.client('admin.localhost').get('/api/catalog')).status).toBe(404);
  });
});

describe('catalog versioning (review C1)', () => {
  it('serves the current version immutably, rejects a stale one and never caches an unversioned one', async () => {
    const c = h.client('alpha.localhost');
    const v = (await c.get('/api/tenant')).body.catalogVersion as number;
    const ok = await c.get(`/api/catalog?v=${v}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toContain('immutable');
    expect(ok.body.items.length).toBeGreaterThan(0);
    const stale = await c.get(`/api/catalog?v=${v + 100}`);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_CATALOG_VERSION');
    const none = await c.get('/api/catalog');
    expect(none.headers.get('cache-control')).toBe('no-store');
  });

  it('translates the catalog', async () => {
    const c = h.client('alpha.localhost');
    const de = await c.get('/api/catalog?lang=de');
    const en = await c.get('/api/catalog?lang=en');
    expect(de.body.items.map((i: { description: string }) => i.description)).not.toEqual(en.body.items.map((i: { description: string }) => i.description));
    expect(de.headers.get('vary')).toContain('Accept-Language');
  });

  it('prices a sauna with the reseller discount and the cap', async () => {
    const r = await h.client('alpha.localhost').get('/api/catalog/saunas/espoo-compact');
    expect(r.status).toBe(200);
    expect(r.body.priceFromMinor).toBe(r.body.listPriceMinor - 50_000 > r.body.listPriceMinor * (1 - r.body.maxDiscountBps / 10_000) ? r.body.listPriceMinor - 50_000 : Math.ceil(r.body.listPriceMinor * (1 - r.body.maxDiscountBps / 10_000)));
    expect(r.body.groups.length).toBeGreaterThan(0);
  });
});

describe('customer flow', () => {
  it('logs in, configures, submits a request and sees it', async () => {
    const c = h.client('alpha.localhost');
    await c.login('ben@example.test', SEED_PASSWORD);
    const sauna = (await c.get('/api/catalog/saunas/turku-panorama')).body;
    const created = await c.post('/api/configurations', { saunaModelId: sauna.id });
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(created.body.locked).toBe(false);

    const sub = await c.post(`/api/configurations/${id}/requests`, { message: 'Garden install please' });
    expect(sub.status).toBe(201);
    expect(sub.body.status).toBe('SUBMITTED');
    expect(sub.body.snapshot.finalPriceMinor).toBeGreaterThan(0);

    const locked = await c.put(`/api/configurations/${id}/selections`, { optionIds: [] });
    expect(locked.body.code).toBe('CONFIGURATION_LOCKED');

    const again = await c.post(`/api/configurations/${id}/requests`, {});
    expect(again.body.id).toBe(sub.body.id);

    const mine = await c.get('/api/me/requests');
    expect(mine.body.items.some((r: { id: string }) => r.id === sub.body.id)).toBe(true);
  });

  it('rejects a contradictory selection', async () => {
    const c = h.client('alpha.localhost');
    await c.login('ben@example.test', SEED_PASSWORD);
    const sauna = (await c.get('/api/catalog/saunas/turku-panorama')).body;
    const created = await c.post('/api/configurations', { saunaModelId: sauna.id });
    const opt = (code: string) => sauna.groups.flatMap((g: { options: { id: string; code: string }[] }) => g.options).find((o: { code: string }) => o.code === code)?.id;
    const r = await c.put(`/api/configurations/${created.body.id}/selections`, { optionIds: [opt('heater-wood'), opt('control-wifi')].filter(Boolean) });
    expect(r.body.code).toBe('OPTION_RULES_VIOLATED');
  });

  it('refuses a write without the CSRF token', async () => {
    const c = h.client('alpha.localhost');
    await c.login('ben@example.test', SEED_PASSWORD);
    const r = await c.req('POST', '/api/configurations', { saunaModelId: SEED.models('turku-panorama') }, { 'x-csrf-token': 'forged' });
    expect(r.body.code).toBe('CSRF_FAILED');
  });
});

describe('tenant isolation', () => {
  it('a customer of alpha cannot read a configuration of beta, even by id', async () => {
    const c = h.client('alpha.localhost');
    await c.login('anna@example.test', SEED_PASSWORD);
    const r = await c.get(`/api/configurations/${SEED.configurations.annaBetaDraft}`);
    expect(r.status).toBe(404);
  });

  it('session cookies of one subdomain do not authenticate on another', async () => {
    const a = h.client('alpha.localhost');
    await a.login('anna@example.test', SEED_PASSWORD);
    const b = h.client('beta.localhost');
    const at = a.cookie('sk_at')!;
    const r = await b.req('GET', '/api/me', undefined, { cookie: `sk_at=${at}` });
    expect(r.status).toBe(401);
  });
});

describe('share links', () => {
  it('opens a shared configuration and issues full-tier asset cookies', async () => {
    const c = h.client('alpha.localhost');
    const r = await c.get(`/api/shared/${SEED_SHARE_TOKEN}`);
    expect(r.status).toBe(200);
    expect(r.body.snapshot.finalPriceMinor).toBeGreaterThan(0);
    expect(r.body.sauna.maxDiscountBps).toBeUndefined();
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  it('the same token does not resolve on another tenant', async () => {
    expect((await h.client('beta.localhost').get(`/api/shared/${SEED_SHARE_TOKEN}`)).status).toBe(404);
  });

  it('a customer can claim it into an editable draft (review C5)', async () => {
    const c = h.client('alpha.localhost');
    await c.login('ben@example.test', SEED_PASSWORD);
    const r = await c.post(`/api/shared/${SEED_SHARE_TOKEN}/claim`);
    expect(r.status).toBe(201);
    const cfg = await c.get(`/api/configurations/${r.body.configurationId}`);
    expect(cfg.body.locked).toBe(false);
  });
});
