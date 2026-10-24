import { describe, expect, it } from 'vitest';
import { loadCatalog, percentToBps } from '../src/catalog.ts';
import { checkGlb, storageKey, MB } from '../src/files.ts';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeSampleSauna } from '../scripts/make-sample-sauna.ts';
import { baseRoom, baseSauna, glb, writeCatalog, type Json } from './fixtures.ts';

async function errorsFor(spec: Parameters<typeof writeCatalog>[0], opts = {}) {
  const dir = await writeCatalog(spec);
  const { catalog, diagnostics } = await loadCatalog(dir, opts);
  return { catalog, errors: diagnostics.errors.map((d) => `${d.path}: ${d.message}`), warnings: diagnostics.warnings.map((d) => d.message) };
}

describe('percentToBps', () => {
  it('converts up to two decimals exactly', () => {
    expect(percentToBps('15')).toBe(1500);
    expect(percentToBps('12.5')).toBe(1250);
    expect(percentToBps('7.25')).toBe(725);
    expect(percentToBps('0.01')).toBe(1);
    expect(percentToBps('100')).toBe(10000);
  });
  it('rejects more decimals, negatives, > 100 and junk', () => {
    for (const bad of ['12.345', '-1', '100.01', '101', 'abc', '', '1e2']) expect(percentToBps(bad)).toBeNull();
  });
});

describe('validate', () => {
  it('accepts a valid catalog and resolves money, bps and translations', async () => {
    const { catalog, errors } = await errorsFor({ saunas: [baseSauna()], rooms: [baseRoom()] });
    expect(errors).toEqual([]);
    const s = catalog.saunas[0]!;
    expect(s.prices).toEqual([
      { currency: 'EUR', listPriceMinor: 1290000, maxDiscountBps: 1500 },
      { currency: 'SEK', listPriceMinor: 13900000, maxDiscountBps: 1250 },
    ]);
    expect(s.optionPrices.find((p) => p.option === 'thermo-ash' && p.currency === 'EUR')?.deltaMinor).toBe(90000);
    expect(s.groups[0]!.options[0]!.swatch).toBe('#a0522d');
    expect(s.assets.map((a) => a.role)).toEqual(['MODEL_GLB_HIGH']);
    expect(catalog.rooms[0]!.preset.wallColor).toBe('#e9e5dd');
  });

  it('C4: requires a price for every option in every currency', async () => {
    const s = baseSauna();
    delete s.option_prices.SEK.audio;
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors).toEqual([expect.stringMatching(/option_prices\.SEK\.audio: option "audio" has no price in SEK/)]);
  });

  it('C4: option prices in a currency without a list price are rejected', async () => {
    const s = baseSauna();
    s.option_prices.NOK = { ...s.option_prices.EUR };
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors.join('\n')).toMatch(/option prices in NOK, but the sauna has no list price in NOK/);
  });

  it('rejects bad percentages and bad money', async () => {
    const s = baseSauna();
    s.prices.EUR.max_discount_pct = '12.345';
    s.prices.SEK.list_price = '12.999';
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors.join('\n')).toMatch(/prices\.EUR\.max_discount_pct: "12.345" is not a percentage/);
    expect(errors.join('\n')).toMatch(/prices\.SEK\.list_price: .*more than 2 decimals/);
  });

  it('rejects duplicate option codes within a group and across groups', async () => {
    const s = baseSauna();
    s.option_groups.wood.options.push({ code: 'cedar', name: 'Cedar again' });
    s.option_groups.extras.options.push({ code: 'spruce', name: 'Spruce extra' });
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors.join('\n')).toMatch(/duplicate option code "cedar" in group "wood"/);
    expect(errors.join('\n')).toMatch(/option code "spruce" is used in both "wood" and "extras"/);
  });

  it('rejects duplicate SKUs and slugs across files', async () => {
    const a = baseSauna();
    const b = baseSauna({ slug: 'cedar-200' });
    const c = baseSauna({ sku: 'S-300' });
    const { errors } = await errorsFor({ saunas: [a, b, c] });
    expect(errors.join('\n')).toMatch(/sku "S-100" is also used/);
    expect(errors.join('\n')).toMatch(/slug "cedar-100" is also used/);
  });

  it('rejects unknown attributes and type mismatches', async () => {
    const s = baseSauna({ attributes: { width_mm: 'wide', sauna_colour: 'red' } });
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors.join('\n')).toMatch(/unknown attribute "sauna_colour": declare it in attributes.yaml/);
    expect(errors.join('\n')).toMatch(/attribute "width_mm" is declared as number/);
  });

  it('rejects a file that is not a GLB, a broken header and a wrong extension', async () => {
    const broken = glb();
    new DataView(broken.buffer).setUint32(4, 1, true);
    const s1 = baseSauna({ assets: { model_high: '../models/fake.glb', model_low: '../models/v1.glb', ar_glb: '../models/cedar.gltf' } });
    const { errors } = await errorsFor({ saunas: [s1], files: { 'models/fake.glb': 'this is a text file and not a binary glTF model', 'models/v1.glb': broken, 'models/cedar.gltf': '{}' } });
    expect(errors.join('\n')).toMatch(/fake\.glb: missing 'glTF' magic bytes/);
    expect(errors.join('\n')).toMatch(/v1\.glb: glTF container version 1, expected 2/);
    expect(errors.join('\n')).toMatch(/cedar\.gltf: expected \.glb/);
  });

  it('enforces size budgets unless --allow-oversize', async () => {
    const s = baseSauna({ assets: { model_low: '../models/big.glb' } });
    const spec = { saunas: [s], files: { 'models/big.glb': glb(1.6 * MB) } };
    expect((await errorsFor(spec)).errors.join('\n')).toMatch(/budget for MODEL_GLB_LOW is 1\.50 MB/);
    const allowed = await errorsFor(spec, { allowOversize: true });
    expect(allowed.errors).toEqual([]);
    expect(allowed.warnings.join('\n')).toMatch(/allowed by --allow-oversize/);
  });

  it('rejects missing asset files', async () => {
    const { errors } = await errorsFor({ saunas: [baseSauna({ assets: { thumbnail: 'nope.png' } })] });
    expect(errors.join('\n')).toMatch(/nope\.png: file not found/);
  });

  it('rule sanity: requires+excludes, impossible chains, SINGLE-group requirements, bad defaults', async () => {
    const s = baseSauna({
      rules: {
        requires: [{ audio: 'led-lights' }, { 'led-lights': 'spruce', cedar: 'spruce' }],
        excludes: [['audio', 'led-lights'], ['spruce', 'audio']],
      },
    });
    const { errors } = await errorsFor({ saunas: [s] });
    const all = errors.join('\n');
    expect(all).toMatch(/"audio" both requires and excludes "led-lights"/);
    expect(all).toMatch(/"cedar" requires "spruce" but both are in SINGLE group "wood"/);
    expect(all).toMatch(/"audio" can never be selected/);
  });

  it('rejects two defaults in a SINGLE group and unknown rule options', async () => {
    const s = baseSauna({ rules: { requires: [{ audio: 'nope' }], excludes: [] } });
    s.option_groups.wood.options[1].default = true;
    const { errors } = await errorsFor({ saunas: [s] });
    expect(errors.join('\n')).toMatch(/SINGLE group "wood" has 2 defaults/);
    expect(errors.join('\n')).toMatch(/unknown option "nope"/);
  });

  it('shared option groups must be defined identically in every manifest', async () => {
    const b: Json = baseSauna({ sku: 'S-200', slug: 'cedar-200' });
    b.option_groups.wood.name = 'Timber';
    const { errors } = await errorsFor({ saunas: [baseSauna(), b] });
    expect(errors.join('\n')).toMatch(/option group "wood" is shared and defined differently/);
  });

  it('reports schema errors with their path (bad SKU, unknown key, bad room preset)', async () => {
    const s = baseSauna({ sku: 's 100', colour: 'red' });
    const r = baseRoom({ preset: { widthMm: 3600, depthMm: 3000, heightMm: 2600, floor: 'carpet', wallColor: 'white' } });
    const { errors } = await errorsFor({ saunas: [s], rooms: [r] });
    const all = errors.join('\n');
    expect(all).toMatch(/^sku: /m);
    expect(all).toMatch(/colour/);
    expect(all).toMatch(/preset\.floor/);
    expect(all).toMatch(/preset\.wallColor/);
  });
});

describe('files', () => {
  it('checkGlb accepts a valid GLB and rejects a length mismatch', () => {
    expect(checkGlb(glb())).toBeNull();
    const g = glb(1000);
    expect(checkGlb(g.subarray(0, 900))).toMatch(/declares/);
  });
  it('storage keys follow the tier prefix convention', () => {
    const h = 'abcdef0123456789'.repeat(4);
    expect(storageKey('cedar-100', 'MODEL_GLB_LOW', h, '.glb')).toBe('assets/lo/catalog/cedar-100/model-glb-low-abcdef012345.glb');
    expect(storageKey('cedar-100', 'MODEL_AR_USDZ', h, '.usdz')).toBe('assets/hi/catalog/cedar-100/model-ar-usdz-abcdef012345.usdz');
    expect(storageKey('cedar-100', 'MODEL_THUMBNAIL', h, '.png')).toBe('media/catalog/cedar-100/model-thumbnail-abcdef012345.png');
  });
});

describe('make-sample-sauna', () => {
  it('writes valid GLBs within the size budgets, deterministically', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sample-sauna-'));
    const a = await makeSampleSauna(dir);
    expect(checkGlb(await readFile(a.high))).toBeNull();
    expect(checkGlb(await readFile(a.low))).toBeNull();
    expect(a.highBytes).toBeLessThan(300 * 1024);
    expect(a.lowBytes).toBeLessThan(a.highBytes / 2);
    const first = await readFile(a.high);
    await makeSampleSauna(dir);
    expect(Buffer.compare(first, await readFile(a.high))).toBe(0);
  });
});
