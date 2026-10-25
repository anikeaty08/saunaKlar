import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD, SEED_SHARE_TOKEN, seedId } from '@saunaklar/db';
import { createHarness, type Harness } from './harness.ts';

/** Regression tests for the API review (authz, races, caching, audit isolation). */
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

describe('manufacturer staff', () => {
  it('a disabled manufacturer admin loses access even with a live access token', async () => {
    const admin = h.client('admin.localhost');
    await admin.staffLogin('admin@nordlicht.test', SEED_PASSWORD);
    expect((await admin.get('/api/manufacturer/resellers')).status).toBe(200);

    await h.owner.query(`update staff_users set status = 'DISABLED' where id = $1`, [SEED.staff.admin]);
    try {
      const r = await admin.get('/api/manufacturer/resellers');
      expect(r.status).toBe(401);
      expect((await admin.session()).body.kind).toBe('anonymous');
    } finally {
      await h.owner.query(`update staff_users set status = 'ACTIVE' where id = $1`, [SEED.staff.admin]);
    }
  });

  it("does not show another manufacturer's catalog price changes in the audit trail", async () => {
    const { rows: [m] } = await h.owner.query<{ id: string }>(`insert into manufacturers (name) values ('Other Maker') returning id`);
    const { rows: [model] } = await h.owner.query<{ id: string }>(
      `insert into sauna_models (manufacturer_id, sku, slug, status, name) values ($1, 'OTHER-1', 'other-one', 'ACTIVE', 'Other One') returning id`, [m!.id]);
    await h.owner.query(`insert into sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) values ($1, 'EUR', 100000, 1000)`, [model!.id]);

    const admin = h.client('admin.localhost');
    await admin.staffLogin('admin@nordlicht.test', SEED_PASSWORD);
    // Own price change: visible.
    const own = SEED.models('espoo-compact');
    expect((await admin.put(`/api/manufacturer/saunas/${own}/prices/EUR`, { listPriceMinor: 1_234_500, maxDiscountBps: 1500 })).status).toBe(200);

    const r = await admin.get('/api/manufacturer/audit?entityType=sauna_model_prices&limit=100');
    expect(r.status).toBe(200);
    const ids = (r.body.items as { entityId: string }[]).map(i => i.entityId);
    expect(ids.some(id => id.includes(own))).toBe(true);
    expect(ids.some(id => id.includes(model!.id))).toBe(false);
  });
});

describe('requests', () => {
  it('a double-submitted request yields one request, not a conflict', async () => {
    const anna = h.client('alpha.localhost');
    await anna.login('anna@example.test', SEED_PASSWORD);
    const created = await anna.post('/api/configurations', { saunaModelId: SEED.models('espoo-compact') });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    const [a, b] = await Promise.all([
      anna.post(`/api/configurations/${id}/requests`, { message: 'first' }),
      anna.post(`/api/configurations/${id}/requests`, { message: 'second' }),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    const { rows } = await h.owner.query('select 1 from configuration_requests where configuration_id = $1', [id]);
    expect(rows).toHaveLength(1);
  });
});

describe('caching', () => {
  it('never puts a cookie on a response a shared cache may store', async () => {
    const fresh = h.client('alpha.localhost');
    const r = await fresh.get('/api/tenant');
    expect(r.headers.get('cache-control')).toContain('public');
    expect(r.headers.getSetCookie()).toEqual([]);
    // Private responses still establish the browser id.
    expect((await fresh.session()).headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it('shares a catalog response only when its language is in the URL', async () => {
    const c = h.client('alpha.localhost');
    const v = (await c.get('/api/tenant')).body.catalogVersion as number;
    const byHeader = await c.get(`/api/catalog?v=${v}`, { 'accept-language': 'de' });
    expect(byHeader.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const byQuery = await c.get(`/api/catalog?v=${v}&lang=de`);
    expect(byQuery.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(byQuery.headers.getSetCookie()).toEqual([]);
  });
});

describe('follow-ups', () => {
  it('accepting a quote the customer did not see answers 409 (quote changed)', async () => {
    const c = h.client('alpha.localhost');
    await c.login('anna@example.test', SEED_PASSWORD);
    const id = seedId('request:alpha:anna-quoted');
    const detail = await c.get(`/api/me/requests/${id}`);
    const active = detail.body.activeQuote.id as string;

    const stale = await c.post(`/api/me/requests/${id}/accept`, { quoteId: '00000000-0000-4000-8000-000000000000' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('CONFLICT');
    expect(stale.body.detail).toMatch(/quote changed/i);
    expect(stale.body.meta.activeQuoteId).toBe(active);
    expect((await c.get(`/api/me/requests/${id}`)).body.status).toBe('QUOTED');

    const ok = await c.post(`/api/me/requests/${id}/accept`, { quoteId: active });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('ACCEPTED');
  });

  it('submitting a locked configuration with an expired price re-prices a clone and requests that', async () => {
    const c = h.client('alpha.localhost');
    await c.login('ben@example.test', SEED_PASSWORD);
    const claimed = await c.post(`/api/shared/${SEED_SHARE_TOKEN}/claim`);
    const original = claimed.body.configurationId as string;
    const before = (await c.get(`/api/configurations/${original}`)).body;
    expect(before.locked).toBe(true);

    const client = await h.owner.connect();
    try {
      await client.query('begin');
      await client.query('set local session_replication_role = replica');
      await client.query(
        `update configuration_price_snapshots set computed_at = now() - interval '40 days', price_valid_until = now() - interval '10 days'
          where configuration_id = $1`, [original]);
      await client.query('commit');
    } finally {
      client.release();
    }

    const r = await c.post(`/api/configurations/${original}/requests`, { message: 'Still interested' });
    expect(r.status).toBe(201);
    const fresh = r.body.configuration.id as string;
    expect(fresh).not.toBe(original);
    const cfg = (await c.get(`/api/configurations/${fresh}`)).body;
    expect(cfg.locked).toBe(true);
    expect(new Date(cfg.snapshot.priceValidUntil).getTime()).toBeGreaterThan(Date.now());
    expect(cfg.selections.sort()).toEqual(before.selections.sort());
    expect(cfg.sourceConfigurationId).toBe(original);

    // A second submit of the stale original returns the same request, not another clone.
    const again = await c.post(`/api/configurations/${original}/requests`, {});
    expect([200, 201]).toContain(again.status);
    expect(again.body.id).toBe(r.body.id);
  });
});
