import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SEED, SEED_PASSWORD } from '@saunaklar/db/seed';
import { createHarness, type Client, type Harness } from './harness.ts';

/** Per-reseller option settings (migration 0015): admin endpoints, storefront offer, server-side checks. */
let h: Harness;
beforeAll(async () => { h = await createHarness(); }, 120_000);
afterAll(async () => { await h?.close(); });

const M = SEED.models;
const O = SEED.options;

async function staff(host: string, email: string): Promise<Client> {
  const c = h.client(host);
  await c.staffLogin(email, SEED_PASSWORD);
  return c;
}
async function ben(): Promise<Client> {
  const c = h.client('alpha.localhost');
  await c.login('ben@example.test', SEED_PASSWORD);
  return c;
}
type Opt = { id: string; enabled: boolean; basePriceMinor: number; priceOverrideMinor: number | null; effectivePriceMinor: number; descriptionOverride: string | null };
const optionOf = (body: { groups: { options: Opt[] }[] }, id: string) => body.groups.flatMap(g => g.options).find(o => o.id === id)!;
const offered = (sauna: { groups: { options: { id: string; priceDeltaMinor: number; description: string | null }[] }[] }, id: string) =>
  sauna.groups.flatMap(g => g.options).find(o => o.id === id);
const set = (optionId: string, enabled: boolean, priceOverrideMinor: number | null = null, descriptionOverride: string | null = null) =>
  ({ optionId, enabled, priceOverrideMinor, descriptionOverride });

describe('reseller admin: option settings', () => {
  it('lists every option of an assigned sauna with the reseller\'s settings', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const r = await alpha.get(`/api/admin/saunas/${M('aurora-hex')}/options`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.currency).toBe('EUR');
    expect(optionOf(r.body, O('salt-wall'))).toMatchObject({ enabled: false, priceOverrideMinor: null });
    expect(optionOf(r.body, O('aroma'))).toMatchObject({ enabled: true, basePriceMinor: 18000, priceOverrideMinor: 15000, effectivePriceMinor: 15000 });
    expect(r.body.groups.find((g: { code: string }) => g.code === 'door')).toMatchObject({ required: true });
  });

  it('keeps resellers apart: own settings only, own saunas only, staff only', async () => {
    const beta = await staff('beta.localhost', 'owner@beta.test');
    const r = await beta.get(`/api/admin/saunas/${M('aurora-hex')}/options`);
    expect(r.status).toBe(200);
    expect(r.body.currency).toBe('CHF');
    expect(optionOf(r.body, O('salt-wall')).enabled).toBe(true);
    expect(optionOf(r.body, O('aroma')).priceOverrideMinor).toBeNull();
    // kelo-barrel is not assigned to beta.
    expect((await beta.get(`/api/admin/saunas/${M('kelo-barrel')}/options`)).status).toBe(404);
    expect((await beta.put(`/api/admin/saunas/${M('kelo-barrel')}/options`, { options: [set(O('aroma'), false)] })).status).toBe(404);
    // A customer is not staff.
    const b = await ben();
    expect([401, 403]).toContain((await b.get(`/api/admin/saunas/${M('aurora-hex')}/options`)).status);
  });

  it('validates a change: options of the sauna only, required groups and requires rules kept', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const path = `/api/admin/saunas/${M('espoo-compact')}/options`;
    const foreign = await alpha.put(path, { options: [set(O('salt-wall'), false)] });
    expect([foreign.status, foreign.body.code]).toEqual([422, 'VALIDATION_FAILED']);
    const doors = await alpha.put(path, { options: ['door-clear', 'door-bronze', 'door-satin', 'door-wood'].map(d => set(O(d), false)) });
    expect([doors.status, doors.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const requires = await alpha.put(path, { options: [set(O('led-backrest'), false)] });
    expect([requires.status, requires.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const negative = await alpha.put(path, { options: [set(O('aroma'), true, -5)] });
    expect(negative.status).toBe(422);
  });
});

describe('storefront: effective options, prices and server-side checks', () => {
  it('shows each reseller its own offer of the same sauna', async () => {
    const alpha = (await h.client('alpha.localhost').get('/api/catalog/saunas/aurora-hex')).body;
    expect(offered(alpha, O('salt-wall'))).toBeUndefined();
    expect(offered(alpha, O('aroma'))!.priceDeltaMinor).toBe(15000);
    const beta = (await h.client('beta.localhost').get('/api/catalog/saunas/aurora-hex')).body;
    expect(offered(beta, O('salt-wall'))).toBeDefined();
    expect(offered(beta, O('aroma'))!.priceDeltaMinor).toBe(17000);
  });

  it('applies a saved change to the catalog, the price and the lock; rejects disabled options', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const b = await ben();
    // A draft with the wood door, made before the reseller drops that door.
    const before = await b.post('/api/configurations', { saunaModelId: M('espoo-compact'), selections: [O('spruce'), O('heater-6kw'), O('door-wood')] });
    expect(before.status, JSON.stringify(before.body)).toBe(201);

    const version = async () => Number((await h.owner.query<{ v: string }>('select catalog_version as v from resellers where id = $1', [SEED.resellers.alpha])).rows[0]!.v);
    const v0 = await version();
    const put = await alpha.put(`/api/admin/saunas/${M('espoo-compact')}/options`, {
      options: [set(O('door-wood'), false), set(O('led-backrest'), true, 10000, 'Dimmable warm light behind your back.')],
    });
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(optionOf(put.body, O('led-backrest'))).toMatchObject({ effectivePriceMinor: 10000, descriptionOverride: 'Dimmable warm light behind your back.' });
    // Storefront caches are keyed by catalog_version (rule 9).
    expect(await version()).toBeGreaterThan(v0);

    // Catalog: the door is gone, the LED costs the override and carries the reseller's text in every locale.
    const de = (await h.client('alpha.localhost').get('/api/catalog/saunas/espoo-compact', { 'accept-language': 'de' })).body;
    expect(offered(de, O('door-wood'))).toBeUndefined();
    expect(offered(de, O('led-backrest'))).toMatchObject({ priceDeltaMinor: 10000, description: 'Dimmable warm light behind your back.' });
    // Other options carry the German text; groups too.
    expect(offered(de, O('spruce'))!.description).toMatch(/Fichte|finnische/);
    expect(de.groups.find((g: { code: string }) => g.code === 'door').description).toBe('Die Glas- oder Holztür der Kabine.');

    // Saving or sending with the disabled option is refused by the server.
    const sel = await b.put(`/api/configurations/${before.body.id}/selections`, { optionIds: [O('spruce'), O('heater-6kw'), O('door-wood')] });
    expect([sel.status, sel.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const sent = await b.post(`/api/configurations/${before.body.id}/requests`, { message: 'Old draft' });
    expect([sent.status, sent.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);
    const created = await b.post('/api/configurations', { saunaModelId: M('espoo-compact'), selections: [O('spruce'), O('heater-6kw'), O('door-wood')] });
    expect([created.status, created.body.code]).toEqual([422, 'OPTION_RULES_VIOLATED']);

    // A valid configuration is priced with the override, and the lock (DB re-check) accepts it.
    const ok = await b.post('/api/configurations', { saunaModelId: M('espoo-compact'), selections: [O('spruce'), O('heater-6kw'), O('door-clear'), O('led-backrest')] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.price.lines).toContainEqual({ optionId: O('led-backrest'), priceDeltaMinor: 10000 });
    expect(ok.body.price.optionsTotalMinor).toBe(10000);
    const req = await b.post(`/api/configurations/${ok.body.id}/requests`, { message: 'With the reseller price' });
    expect(req.status, JSON.stringify(req.body)).toBe(201);
    const locked = (await b.get(`/api/configurations/${ok.body.id}`)).body;
    expect(locked.snapshot.lines).toContainEqual({ optionId: O('led-backrest'), priceDeltaMinor: 10000 });
    expect(locked.snapshot.finalPriceMinor).toBe(locked.price.finalPriceMinor);
  });

  it('resets an option to the manufacturer\'s values', async () => {
    const alpha = await staff('alpha.localhost', 'owner@alpha.test');
    const put = await alpha.put(`/api/admin/saunas/${M('espoo-compact')}/options`, { options: [set(O('door-wood'), true), set(O('led-backrest'), true)] });
    expect(put.status).toBe(200);
    expect(optionOf(put.body, O('door-wood')).enabled).toBe(true);
    expect(optionOf(put.body, O('led-backrest'))).toMatchObject({ priceOverrideMinor: null, descriptionOverride: null, effectivePriceMinor: 24000 });
    const n = await h.owner.query('select 1 from reseller_sauna_options where reseller_id = $1 and sauna_model_id = $2', [SEED.resellers.alpha, M('espoo-compact')]);
    expect(n.rowCount).toBe(0);
  });
});
