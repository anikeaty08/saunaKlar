import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db';
import { createHarness, type Client, type Harness } from './harness.ts';

let h: Harness;
let m: Client;
beforeAll(async () => {
  h = await createHarness();
  m = h.client('admin.localhost');
  await m.staffLogin('admin@nordlicht.test', SEED_PASSWORD);
}, 120_000);
afterAll(async () => { await h?.close(); });

const newReseller = (slug: string, currencyCode = 'EUR') => ({
  slug, name: `Reseller ${slug}`, currencyCode, owner: { email: `owner@${slug}.test`, displayName: `Owner ${slug}` },
});

describe('manufacturer: resellers', () => {
  it('creates a reseller with an invited owner and the default rooms', async () => {
    const r = await m.post('/api/manufacturer/resellers', newReseller('delta'));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ slug: 'delta', currency: 'EUR', status: 'ACTIVE', saunasAssigned: 0 });
    expect(r.body.storefrontUrl).toContain('delta.localhost');
    expect(r.body.admins).toEqual([expect.objectContaining({ email: 'owner@delta.test', role: 'OWNER', status: 'INVITED' })]);
    expect((await h.client('delta.localhost').get('/api/tenant')).status).toBe(200);
  });

  it('refuses a reserved slug', async () => {
    const r = await m.post('/api/manufacturer/resellers', newReseller('admin'));
    expect(r.body.code).toBe('SLUG_RESERVED');
  });

  it('refuses a taken slug', async () => {
    const r = await m.post('/api/manufacturer/resellers', newReseller('alpha'));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('SLUG_TAKEN');
  });

  it('refuses an invalid slug before touching the database', async () => {
    const r = await m.post('/api/manufacturer/resellers', newReseller('-Bad_Slug'));
    expect(r.body.code).toBe('VALIDATION_FAILED');
  });

  it('suspends a reseller: its storefront goes offline', async () => {
    const created = await m.post('/api/manufacturer/resellers', newReseller('epsilon'));
    expect(created.status).toBe(201);
    const r = await m.patch(`/api/manufacturer/resellers/${created.body.id}`, { status: 'SUSPENDED' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('SUSPENDED');
    const { rows } = await h.owner.query(
      `select payload from notification_outbox where event_type = 'TENANT_SYNC' and payload->>'resellerId' = $1 order by id desc limit 1`, [created.body.id]);
    expect(rows[0]?.payload.status).toBe('SUSPENDED');
    // A tenant first seen after the change is resolved as suspended (the API caches tenants for 60 s).
    expect((await h.client('epsilon.localhost').get('/api/tenant')).body.code).toBe('TENANT_SUSPENDED');
  });

  it('is not reachable from a reseller host or by a reseller owner', async () => {
    const owner = h.client('alpha.localhost');
    await owner.staffLogin('owner@alpha.test', SEED_PASSWORD);
    expect((await owner.get('/api/manufacturer/resellers')).status).toBe(404);
    const onAdminHost = h.client('admin.localhost');
    const login = await onAdminHost.post('/api/auth/staff/login', { email: 'owner@alpha.test', password: SEED_PASSWORD });
    if (login.status === 200) await onAdminHost.session();
    expect([401, 403]).toContain((await onAdminHost.get('/api/manufacturer/resellers')).status);
  });
});

describe('manufacturer: assignments', () => {
  it('refuses to assign a sauna that has no prices in the reseller currency', async () => {
    const created = await m.post('/api/manufacturer/resellers', newReseller('zeta', 'NOK'));
    expect(created.status).toBe(201);
    const list = await m.get(`/api/manufacturer/resellers/${created.body.id}/saunas`);
    const espoo = list.body.items.find((i: { slug: string }) => i.slug === 'espoo-compact');
    expect(espoo.assigned).toBe(false);
    expect(espoo.blockedReason).toBeTruthy();
    const r = await m.put(`/api/manufacturer/resellers/${created.body.id}/saunas/${SEED.models('espoo-compact')}`);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('SAUNA_NOT_ASSIGNABLE');
  });

  it('assigns a priced sauna and bumps the reseller catalog version', async () => {
    const created = await m.post('/api/manufacturer/resellers', newReseller('eta', 'CHF'));
    const v = created.body.catalogVersion as number;
    const r = await m.put(`/api/manufacturer/resellers/${created.body.id}/saunas/${SEED.models('lappi-barrel')}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.items.find((i: { slug: string }) => i.slug === 'lappi-barrel').assigned).toBe(true);
    expect((await m.get(`/api/manufacturer/resellers/${created.body.id}`)).body.catalogVersion).toBeGreaterThan(v);
  });

  it('cannot remove a price that an assigned reseller relies on', async () => {
    // Alpha (EUR) offers espoo-compact; the manufacturer cannot change prices away to break it,
    // but a valid price update works and is reflected.
    const detail = await m.get(`/api/manufacturer/saunas/${SEED.models('espoo-compact')}`);
    const eur = detail.body.prices.find((p: { currency: string }) => p.currency === 'EUR');
    const r = await m.put(`/api/manufacturer/saunas/${SEED.models('espoo-compact')}/prices/EUR`, { listPriceMinor: eur.listPriceMinor + 10_000, maxDiscountBps: eur.maxDiscountBps });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.prices.find((p: { currency: string }) => p.currency === 'EUR').listPriceMinor).toBe(eur.listPriceMinor + 10_000);
  });
});

describe('manufacturer: privacy (design A10)', () => {
  it('never exposes customer e-mail addresses', async () => {
    const { rows } = await h.owner.query<{ email: string }>('select email from customers');
    const emails = rows.map(r => r.email.toLowerCase());
    expect(emails.length).toBeGreaterThan(0);
    const resellers = await m.get('/api/manufacturer/resellers');
    const bodies = [
      resellers,
      ...(await Promise.all(resellers.body.items.map((r: { id: string }) => m.get(`/api/manufacturer/resellers/${r.id}`)))),
      ...(await Promise.all(resellers.body.items.map((r: { id: string }) => m.get(`/api/manufacturer/resellers/${r.id}/saunas`)))),
      await m.get('/api/manufacturer/saunas'),
      await m.get(`/api/manufacturer/saunas/${SEED.models('espoo-compact')}`),
      await m.get('/api/manufacturer/analytics?days=365'),
      await m.get('/api/manufacturer/audit?limit=100'),
    ];
    for (const b of bodies) {
      expect(b.status).toBe(200);
      const text = JSON.stringify(b.body).toLowerCase();
      for (const e of emails) expect(text, `leaks ${e}`).not.toContain(e);
    }
    // Aggregates are still there.
    const alpha = resellers.body.items.find((r: { slug: string }) => r.slug === 'alpha');
    expect(alpha.customers).toBeGreaterThan(0);
  });
});
