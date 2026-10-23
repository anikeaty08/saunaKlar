import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stringify } from 'yaml';

/** A minimal valid GLB (glTF 2.0) of at least `minBytes` bytes (padding goes into a BIN chunk). */
export function glb(minBytes = 0): Uint8Array {
  const json = new TextEncoder().encode(JSON.stringify({ asset: { version: '2.0', generator: 'catalog-import test' } }));
  const jsonLen = Math.ceil(json.length / 4) * 4;
  const binLen = Math.max(0, Math.ceil((minBytes - 12 - 8 - jsonLen - 8) / 4) * 4);
  const total = 12 + 8 + jsonLen + (binLen ? 8 + binLen : 0);
  const buf = new Uint8Array(total);
  const v = new DataView(buf.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, total, true);
  v.setUint32(12, jsonLen, true);
  v.setUint32(16, 0x4e4f534a, true);
  buf.fill(0x20, 20, 20 + jsonLen);
  buf.set(json, 20);
  if (binLen) {
    v.setUint32(20 + jsonLen, binLen, true);
    v.setUint32(24 + jsonLen, 0x004e4942, true);
  }
  return buf;
}

export const ATTRIBUTES = {
  attributes: {
    width_mm: { label: 'Width', unit: 'mm', type: 'number' },
    heater_kw: { label: 'Heater', unit: 'kW', type: 'number' },
    wood: { label: 'Wood', type: 'text' },
    outdoor: { label: 'Outdoor', type: 'boolean' },
  },
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export function baseSauna(over: Record<string, Json> = {}): Json {
  return {
    sku: 'S-100',
    slug: 'cedar-100',
    status: 'ACTIVE',
    name: 'Cedar 100',
    description: 'Four persons.',
    translations: { fi: { name: 'Setri 100', description: 'Neljä henkeä.' } },
    attributes: { width_mm: 2200, heater_kw: 6.5, wood: 'cedar', outdoor: true },
    prices: {
      EUR: { list_price: '12900.00', max_discount_pct: 15 },
      SEK: { list_price: '139000.00', max_discount_pct: '12.5' },
    },
    option_groups: {
      wood: {
        name: 'Wood', selection: 'SINGLE', required: true, translations: { fi: 'Puu' },
        options: [
          { code: 'cedar', name: 'Cedar', swatch: '#A0522D', default: true },
          { code: 'spruce', name: 'Spruce', translations: { fi: { name: 'Kuusi' } } },
          { code: 'thermo-ash', name: 'Thermo ash' },
        ],
      },
      extras: {
        name: 'Extras', selection: 'MULTI',
        options: [{ code: 'led-lights', name: 'LED lights' }, { code: 'audio', name: 'Audio' }],
      },
    },
    option_prices: {
      EUR: { cedar: '0', spruce: '0.00', 'thermo-ash': '900.00', 'led-lights': '250.00', audio: '400.00' },
      SEK: { cedar: '0', spruce: '0', 'thermo-ash': '9900', 'led-lights': '2700', audio: '4300' },
    },
    rules: { requires: [{ audio: 'led-lights' }], excludes: [['spruce', 'thermo-ash']] },
    assets: { model_high: '../models/cedar.glb' },
    ...over,
  };
}

export function baseRoom(over: Record<string, Json> = {}): Json {
  return {
    code: 'bathroom', name: 'Bathroom', status: 'ACTIVE',
    translations: { fi: { name: 'Kylpyhuone' } },
    preset: { widthMm: 3600, depthMm: 3000, heightMm: 2600, floor: 'tiles', wallColor: '#E9E5DD', windowWall: 'east' },
    ...over,
  };
}

export interface CatalogSpec {
  saunas?: Json[];
  rooms?: Json[];
  attributes?: Json;
  files?: Record<string, Uint8Array | string>;
}

/** Writes a catalog directory and returns its path. */
export async function writeCatalog(spec: CatalogSpec, dir?: string): Promise<string> {
  const root = dir ?? (await mkdtemp(join(tmpdir(), 'catalog-test-')));
  const files: Record<string, Uint8Array | string> = {
    'attributes.yaml': stringify(spec.attributes ?? ATTRIBUTES),
    'models/cedar.glb': glb(),
    ...spec.files,
  };
  (spec.saunas ?? []).forEach((s, i) => { files[`saunas/${String(i).padStart(2, "0")}-${s.slug}.yaml`] = stringify({ sauna: s }); });
  for (const r of spec.rooms ?? []) files[`rooms/${r.code}.yaml`] = stringify({ room: r });
  for (const [p, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, p)), { recursive: true });
    await writeFile(join(root, p), content);
  }
  return root;
}
