/**
 * Catalog import against a real database (vitest project `db`).
 */
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createPool, createTestDatabase } from '@saunaklar/db';
import { dbAccess } from '../src/db.ts';
import { LocalObjectStore } from '../src/object-store.ts';
import { memoryOutput } from '../src/output.ts';
import { planIsEmpty } from '../src/plan.ts';
import { runImport, type RunOptions } from '../src/pipeline.ts';
import { baseRoom, baseSauna, glb, writeCatalog, type CatalogSpec, type Json } from './fixtures.ts';

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
let tdb: TestDb;
let pool: pg.Pool;
let objects: string;
let manufacturerId: string;

beforeAll(async () => {
  tdb = await createTestDatabase();
  pool = createPool(tdb.url);
  objects = await mkdtemp(join(tmpdir(), 'catalog-objects-'));
  const { rows } = await pool.query<{ id: string }>(`INSERT INTO manufacturers (name) VALUES ('Saunaklar Oy') RETURNING id`);
  manufacturerId = rows[0]!.id;
});

afterAll(async () => {
  await pool?.end();
  await tdb?.drop();
  if (objects) await rm(objects, { recursive: true, force: true });
});

async function run(spec: CatalogSpec, opts: Partial<RunOptions> & { ownerChecks?: boolean } = {}) {
  const dir = await writeCatalog(spec);
  const out = memoryOutput();
  const access = dbAccess(pool);
  const result = await runImport({
    dir, out, optimiser: null, store: new LocalObjectStore(objects),
    db: opts.ownerChecks === false ? { ...access, owner: null } : access,
    ...opts,
  });
  await rm(dir, { recursive: true, force: true });
  return { result, text: out.text() };
}

const one = async <T = Json>(sql: string, values: unknown[] = []): Promise<T> => (await pool.query(sql, values)).rows[0] as T;
const all = async <T = Json>(sql: string, values: unknown[] = []): Promise<T[]> => (await pool.query(sql, values)).rows as T[];
const catalogVersion = async (slug: string) => Number((await one<{ v: string }>('SELECT catalog_version AS v FROM resellers WHERE slug = $1', [slug])).v);

async function resetCatalog() {
  await pool.query(`TRUNCATE reseller_saunas, sauna_models, option_groups, options, attribute_definitions, room_scenes, assets, resellers CASCADE`);
  await pool.query(`INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, 'nordic', 'Nordic Saunas', 'EUR')`, [manufacturerId]);
}

describe('catalog import', () => {
  beforeEach(resetCatalog);

  it('imports a sauna and a room, uploads assets with content-hashed keys', async () => {
    const { result, text } = await run({ saunas: [baseSauna()], rooms: [baseRoom()] });
    expect(result.exitCode, text).toBe(0);
    expect(result.applied).toEqual(['attributes.yaml', 'S-100', 'bathroom']);

    const m = await one('SELECT id, slug, status, name, manufacturer_id FROM sauna_models WHERE sku = $1', ['S-100']);
    expect(m).toMatchObject({ slug: 'cedar-100', status: 'ACTIVE', name: 'Cedar 100', manufacturer_id: manufacturerId });
    expect(await all('SELECT currency_code, list_price_minor::int AS p, max_discount_bps AS b FROM sauna_model_prices WHERE sauna_model_id = $1 ORDER BY 1', [m.id]))
      .toEqual([{ currency_code: 'EUR', p: 1290000, b: 1500 }, { currency_code: 'SEK', p: 13900000, b: 1250 }]);
    expect(Number((await one('SELECT count(*) AS n FROM sauna_model_option_prices WHERE sauna_model_id = $1', [m.id])).n)).toBe(10);
    expect(Number((await one('SELECT count(*) AS n FROM option_requires WHERE sauna_model_id = $1', [m.id])).n)).toBe(1);
    expect(Number((await one('SELECT count(*) AS n FROM option_excludes WHERE sauna_model_id = $1', [m.id])).n)).toBe(1);
    expect(await one(`SELECT value_number::float AS n FROM sauna_model_attributes WHERE sauna_model_id = $1 AND attribute_code = 'heater_kw'`, [m.id])).toEqual({ n: 6.5 });

    const asset = await one(`SELECT a.storage_key, a.content_type, a.owner_reseller_id FROM sauna_model_assets ma JOIN assets a ON a.id = ma.asset_id
      WHERE ma.sauna_model_id = $1 AND ma.asset_role = 'MODEL_GLB_HIGH'`, [m.id]);
    expect(asset.storage_key).toMatch(/^assets\/hi\/catalog\/cedar-100\/model-glb-high-[0-9a-f]{12}\.glb$/);
    expect(asset).toMatchObject({ content_type: 'model/gltf-binary', owner_reseller_id: null });
    expect(await readdir(join(objects, 'assets/hi/catalog/cedar-100'))).toContain(asset.storage_key.split('/').pop());

    const room = await one(`SELECT preset, status FROM room_scenes WHERE code = 'bathroom'`);
    expect(room).toEqual({ status: 'ACTIVE', preset: { widthMm: 3600, depthMm: 3000, heightMm: 2600, floor: 'tiles', wallColor: '#e9e5dd', windowWall: 'east' } });
  });

  it('is idempotent: a second run plans nothing and does not bump catalog versions', async () => {
    const spec = { saunas: [baseSauna()], rooms: [baseRoom()] };
    await run(spec);
    const before = await catalogVersion('nordic');
    const dry = await run(spec, { dryRun: true });
    expect(dry.result.exitCode).toBe(0);
    expect(planIsEmpty(dry.result.plan!), dry.text).toBe(true);
    const again = await run(spec);
    expect(again.text).toMatch(/Catalog is up to date/);
    expect(again.result.bumped).toBe(false);
    expect(await catalogVersion('nordic')).toBe(before);
  });

  it('bumps every reseller catalog_version once when something changed', async () => {
    await pool.query(`INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, 'svensk', 'Svensk Bastu', 'SEK')`, [manufacturerId]);
    const v1 = await catalogVersion('nordic');
    const v2 = await catalogVersion('svensk');
    const { result } = await run({ saunas: [baseSauna()] });
    expect(result.bumped).toBe(true);
    expect(await catalogVersion('nordic')).toBeGreaterThan(v1);
    expect(await catalogVersion('svensk')).toBeGreaterThan(v2);
  });

  it('dry run writes nothing', async () => {
    const { result, text } = await run({ saunas: [baseSauna()] }, { dryRun: true });
    expect(result.exitCode).toBe(0);
    expect(text).toMatch(/\+ sauna S-100/);
    expect(text).toMatch(/\+ option price audio SEK/);
    expect(await all('SELECT 1 FROM sauna_models')).toEqual([]);
  });

  it('upserts translations: changes, adds and removes locales', async () => {
    await run({ saunas: [baseSauna()] });
    const changed = baseSauna({ translations: { fi: { name: 'Setri 100 uusi' }, sv: { name: 'Ceder 100', description: 'Fyra.' } } });
    const { result, text } = await run({ saunas: [changed] });
    expect(result.exitCode, text).toBe(0);
    expect(text).toMatch(/~ translation fi/);
    expect(text).toMatch(/\+ translation sv/);
    const rows = await all(`SELECT t.locale, t.name, t.description FROM sauna_model_translations t JOIN sauna_models m ON m.id = t.sauna_model_id
      WHERE m.sku = 'S-100' ORDER BY 1`);
    expect(rows).toEqual([{ locale: 'fi', name: 'Setri 100 uusi', description: null }, { locale: 'sv', name: 'Ceder 100', description: 'Fyra.' }]);
    const noLocales = await run({ saunas: [baseSauna({ translations: {} })] });
    expect(noLocales.text).toMatch(/- translation fi/);
    expect(await all(`SELECT 1 FROM sauna_model_translations`)).toEqual([]);
  });

  it('removes an option from the model (prices and rules too) but keeps the shared option', async () => {
    await run({ saunas: [baseSauna()] });
    const s = baseSauna({ rules: { requires: [], excludes: [['spruce', 'thermo-ash']] } });
    s.option_groups.extras.options = [{ code: 'led-lights', name: 'LED lights' }];
    delete s.option_prices.EUR.audio;
    delete s.option_prices.SEK.audio;
    const { result, text } = await run({ saunas: [s] });
    expect(result.exitCode, text).toBe(0);
    expect(text).toMatch(/- model option audio/);
    expect(text).toMatch(/- rule requires audio → led-lights/);
    expect(await all(`SELECT o.code FROM sauna_model_options mo JOIN options o ON o.id = mo.option_id WHERE o.code = 'audio'`)).toEqual([]);
    expect(await all(`SELECT 1 FROM option_requires`)).toEqual([]);
    expect(await all(`SELECT code FROM options WHERE code = 'audio'`)).toEqual([{ code: 'audio' }]);
    expect(planIsEmpty((await run({ saunas: [s] }, { dryRun: true })).result.plan!)).toBe(true);
  });

  it('moves a SINGLE-group default and removes a whole option group', async () => {
    await run({ saunas: [baseSauna()] });
    const s = baseSauna({ rules: { requires: [], excludes: [] } });
    s.option_groups.wood.options[0].default = false;
    s.option_groups.wood.options[1].default = true;
    delete s.option_groups.extras;
    for (const cur of ['EUR', 'SEK']) { delete s.option_prices[cur].audio; delete s.option_prices[cur]['led-lights']; }
    const { result, text } = await run({ saunas: [s] });
    expect(result.exitCode, text).toBe(0);
    expect(await all(`SELECT o.code FROM sauna_model_options mo JOIN options o ON o.id = mo.option_id WHERE mo.is_default`)).toEqual([{ code: 'spruce' }]);
    expect(await all(`SELECT 1 FROM sauna_model_option_groups mg JOIN option_groups g ON g.id = mg.option_group_id WHERE g.code = 'extras'`)).toEqual([]);
  });

  it('blocks removing a currency a reseller sells in, naming the reseller (pre-check)', async () => {
    await run({ saunas: [baseSauna()] });
    await pool.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) SELECT r.id, m.id FROM resellers r, sauna_models m WHERE r.slug = 'nordic'`);
    const s = baseSauna({ name: 'Renamed' });
    delete s.prices.EUR;
    delete s.option_prices.EUR;
    const { result, text } = await run({ saunas: [s] });
    expect(result.exitCode).toBe(1);
    expect(text).toMatch(/reseller "nordic" sells S-100 in EUR/);
    expect((await one(`SELECT name FROM sauna_models WHERE sku = 'S-100'`)).name).toBe('Cedar 100');
  });

  it('rolls the whole sauna back when the database rejects it (trigger error names the reseller)', async () => {
    await run({ saunas: [baseSauna()] });
    await pool.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) SELECT r.id, m.id FROM resellers r, sauna_models m WHERE r.slug = 'nordic'`);
    const before = await catalogVersion('nordic');
    const s = baseSauna({ name: 'Renamed', translations: { de: { name: 'Zeder 100' } } });
    delete s.prices.EUR;
    delete s.option_prices.EUR;
    const { result, text } = await run({ saunas: [s] }, { ownerChecks: false });
    expect(result.exitCode).toBe(1);
    expect(result.failed[0]!.message).toMatch(/reseller nordic offers this sauna/);
    expect(text).toMatch(/S-100 rolled back/);
    expect((await one(`SELECT name FROM sauna_models WHERE sku = 'S-100'`)).name).toBe('Cedar 100');
    expect(await all(`SELECT locale FROM sauna_model_translations`)).toEqual([{ locale: 'fi' }]);
    expect(Number((await one(`SELECT count(*) AS n FROM sauna_model_prices WHERE currency_code = 'EUR'`)).n)).toBe(1);
    expect(result.bumped).toBe(false);
    expect(await catalogVersion('nordic')).toBe(before);
  });

  it('one failing sauna does not stop the others; replacing an asset relinks it', async () => {
    await run({ saunas: [baseSauna()] });
    const keyBefore = (await one(`SELECT a.storage_key FROM sauna_model_assets ma JOIN assets a ON a.id = ma.asset_id`)).storage_key;
    // A second sauna whose slug is taken by S-100 is blocked; S-100 itself gets a new model file.
    const clash = baseSauna({ sku: 'S-200', assets: {} });
    const s = baseSauna();
    const { result, text } = await run({
      saunas: [s, { ...clash, slug: 'cedar-200' }],
      files: { 'models/cedar.glb': glb(4096) },
    });
    expect(result.exitCode, text).toBe(0);
    const keyAfter = (await one(`SELECT a.storage_key FROM sauna_model_assets ma JOIN assets a ON a.id = ma.asset_id JOIN sauna_models m ON m.id = ma.sauna_model_id WHERE m.sku = 'S-100'`)).storage_key;
    expect(keyAfter).not.toBe(keyBefore);
    const blocked = await run({ saunas: [baseSauna(), { ...baseSauna({ sku: 'S-300', assets: {} }), slug: 'cedar-200' }] });
    expect(blocked.result.exitCode).toBe(1);
    expect(blocked.text).toMatch(/slug "cedar-200" belongs to sauna S-200/);
    expect(blocked.result.applied).toContain('S-100');
    expect(blocked.result.bumped).toBe(true);
  });
});
