/**
 * Fixtures for `VITE_MOCK_API=1`: a realistic catalogue that satisfies the
 * `@saunaklar/shared` schemas. Prices are EUR minor units.
 */
import type { Attribute, Discount, OptionGroupDto, RoomPreset, SaunaDetail, Tenant } from './types.ts';

/** Deterministic UUID-shaped id (FNV-1a based) so fixtures are stable across reloads. */
export function fid(seed: string): string {
  const parts: string[] = [];
  let h = 0x811c9dc5;
  for (let round = 0; round < 4; round++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + round * 131;
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    parts.push(h.toString(16).padStart(8, '0'));
  }
  const hex = parts.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// ---- tenants -------------------------------------------------------------------

interface MockTenant {
  slug: string;
  name: string;
  tagline: string;
  primaryColor: string;
  supportEmail: string;
  supportPhone: string;
  legalName: string;
  legalAddress: string;
  vatDisplay: Tenant['branding']['vatDisplay'];
  defaultDiscount: Discount | null;
  perSauna: Record<string, Discount>;
  hidden: string[];
}

export const MOCK_TENANTS: Record<string, MockTenant> = {
  nordic: {
    slug: 'nordic',
    name: 'Nordic Heat',
    tagline: 'Finnish saunas, built to order and delivered across Europe.',
    primaryColor: '#1c1c1a',
    supportEmail: 'hello@nordicheat.example',
    supportPhone: '+358 9 4242 1100',
    legalName: 'Nordic Heat Oy',
    legalAddress: 'Kalevankatu 12\n00100 Helsinki\nFinland',
    vatDisplay: 'INCLUDED',
    defaultDiscount: { type: 'PERCENT', value: 800 },
    perSauna: { 'fjord-panorama': { type: 'PERCENT', value: 1500 }, 'kelo-barrel': { type: 'FIXED', value: 50000 } },
    hidden: [],
  },
  fjord: {
    slug: 'fjord',
    name: 'Fjord Bad',
    tagline: 'Saunas for Norwegian coasts and cabins.',
    primaryColor: '#1f3a5f',
    supportEmail: 'post@fjordbad.example',
    supportPhone: '+47 22 00 41 41',
    legalName: 'Fjord Bad AS',
    legalAddress: 'Bryggen 4\n5003 Bergen\nNorway',
    vatDisplay: 'INCLUDED',
    defaultDiscount: { type: 'PERCENT', value: 500 },
    perSauna: {},
    hidden: ['espoo-compact'],
  },
  kelo: {
    slug: 'kelo',
    name: 'Kelo & Kiuas',
    tagline: 'Outdoor saunas for gardens and lakesides.',
    primaryColor: '#5a3e2b',
    supportEmail: 'info@kelokiuas.example',
    supportPhone: '+49 30 555 0199',
    legalName: 'Kelo & Kiuas GmbH',
    legalAddress: 'Torstraße 88\n10119 Berlin\nGermany',
    vatDisplay: 'EXCLUDED',
    defaultDiscount: null,
    perSauna: { 'saimaa-garden-house': { type: 'PERCENT', value: 600 } },
    hidden: [],
  },
};
MOCK_TENANTS['alpha-spa'] = { ...MOCK_TENANTS.nordic!, slug: 'alpha-spa', name: 'Alpha Spa', legalName: 'Alpha Spa Ltd', primaryColor: '#2f4f3a' };

export function tenantDto(t: MockTenant, catalogVersion: number): Tenant {
  return {
    id: fid(`tenant:${t.slug}`),
    slug: t.slug,
    name: t.name,
    currency: 'EUR',
    catalogVersion,
    defaultShareExpiryDays: 30,
    branding: {
      displayName: t.name,
      tagline: t.tagline,
      primaryColor: t.primaryColor,
      logoUrl: null,
      faviconUrl: null,
      supportEmail: t.supportEmail,
      supportPhone: t.supportPhone,
      legalName: t.legalName,
      legalAddress: t.legalAddress,
      vatDisplay: t.vatDisplay,
    },
  };
}

// ---- option catalogue ----------------------------------------------------------

interface OptionSeed { code: string; name: string; description?: string; price: number; swatch?: string; isDefault?: boolean }
interface GroupSeed { code: string; name: string; selectionType: 'SINGLE' | 'MULTI'; required: boolean; options: OptionSeed[] }

const GROUPS: GroupSeed[] = [
  {
    code: 'wood', name: 'Wood', selectionType: 'SINGLE', required: true, options: [
      { code: 'spruce', name: 'Nordic spruce', description: 'Slow-grown, knot-sparse spruce with a pale, even grain.', price: 0, swatch: '#dcc39b', isDefault: true },
      { code: 'alder', name: 'Alder', description: 'Warm red-brown tone that deepens with use.', price: 49000, swatch: '#c48d5e' },
      { code: 'thermo-aspen', name: 'Thermo aspen', description: 'Heat-treated aspen: splinter-free, stable, honey-coloured.', price: 69000, swatch: '#a8774a' },
      { code: 'kelo', name: 'Kelo pine', description: 'Standing-dead Lapland pine, silver-grey and centuries old.', price: 149000, swatch: '#8d7a66' },
    ],
  },
  {
    code: 'heater', name: 'Heater', selectionType: 'SINGLE', required: true, options: [
      { code: 'electric-6', name: 'Electric 6.8 kW', description: 'Wall-mounted, for rooms up to 9 m³.', price: 0, isDefault: true },
      { code: 'electric-9', name: 'Electric 9 kW', description: 'Faster heat-up for larger rooms, 8–14 m³.', price: 39000 },
      { code: 'storage-10', name: 'Heat-storage 10.5 kW', description: '200 kg of stones for a soft, continuous löyly.', price: 189000 },
      { code: 'wood-stove', name: 'Wood-burning stove', description: 'Traditional firewood stove with external feed. No electricity needed.', price: 129000 },
    ],
  },
  {
    code: 'control', name: 'Control', selectionType: 'SINGLE', required: false, options: [
      { code: 'dial', name: 'Integrated dial', description: 'Mechanical thermostat and timer on the heater.', price: 0, isDefault: true },
      { code: 'digital', name: 'Digital panel', description: 'Wall panel with temperature, timer and lighting control.', price: 35000 },
      { code: 'app', name: 'App control', description: 'Wi-Fi module: pre-heat from your phone. Includes the digital panel.', price: 69000 },
    ],
  },
  {
    code: 'door', name: 'Door', selectionType: 'SINGLE', required: true, options: [
      { code: 'clear', name: 'Clear glass', description: '8 mm tempered safety glass.', price: 0, isDefault: true },
      { code: 'bronze', name: 'Bronze glass', description: 'Tinted for privacy without losing light.', price: 19000 },
      { code: 'satin', name: 'Satin glass', description: 'Frosted, fully private.', price: 24000 },
      { code: 'timber', name: 'Timber with window', description: 'Solid door with a narrow vertical window.', price: 12000 },
    ],
  },
  {
    code: 'lighting', name: 'Lighting', selectionType: 'MULTI', required: false, options: [
      { code: 'backrest-led', name: 'Backrest LED strip', description: 'Warm 2700 K strip behind the backrest.', price: 29000, isDefault: true },
      { code: 'bench-led', name: 'Under-bench LED', description: 'Indirect light under the upper bench.', price: 24000 },
      { code: 'starlight', name: 'Fibre-optic ceiling', description: 'Forty points of light. Requires the digital panel.', price: 59000 },
    ],
  },
  {
    code: 'extras', name: 'Extras', selectionType: 'MULTI', required: false, options: [
      { code: 'aroma', name: 'Aroma dispenser', price: 12000 },
      { code: 'bucket', name: 'Bucket and ladle set', description: 'Hand-turned, in the cabin wood.', price: 8900 },
      { code: 'backrests', name: 'Ergonomic backrests', price: 24000 },
      { code: 'stone-floor', name: 'Pebble floor tiles', price: 39000 },
    ],
  },
];

const optId = (g: string, o: string) => fid(`option:${g}:${o}`);
const groupId = (g: string) => fid(`group:${g}`);

// ---- models ----------------------------------------------------------------------

interface ModelSeed {
  slug: string;
  sku: string;
  name: string;
  description: string;
  form: 'box' | 'panorama' | 'corner' | 'barrel' | 'hex' | 'cabin';
  widthMm: number;
  depthMm: number;
  heightMm: number;
  persons: number;
  heaterKw: number;
  weightKg: number;
  placement: 'Indoor' | 'Outdoor' | 'Indoor or outdoor';
  listPrice: number;
  maxDiscountBps: number;
  /** Groups to leave out (e.g. no wood stove indoors). */
  omit?: string[];
  defaultWood?: string;
}

const MODELS: ModelSeed[] = [
  {
    slug: 'espoo-compact', sku: 'SK-ESP-140', name: 'Espoo Compact', form: 'box',
    description: 'A two-person sauna that fits where a shower cubicle would. Flat-pack modules, assembled in an afternoon, with a full-height glass front that makes a small bathroom feel larger.',
    widthMm: 1400, depthMm: 1200, heightMm: 2000, persons: 2, heaterKw: 4.5, weightKg: 240, placement: 'Indoor', listPrice: 690000, maxDiscountBps: 1500,
    omit: ['heater:storage-10', 'heater:wood-stove', 'extras:stone-floor'],
  },
  {
    slug: 'fjord-panorama', sku: 'SK-FJD-220', name: 'Fjord Panorama', form: 'panorama',
    description: 'Floor-to-ceiling glass on the long side, so the view does the decorating. Two bench levels in an L, seating four or five, with the heater tucked behind a slatted guard.',
    widthMm: 2200, depthMm: 1800, heightMm: 2100, persons: 5, heaterKw: 9, weightKg: 520, placement: 'Indoor or outdoor', listPrice: 1490000, maxDiscountBps: 1200,
  },
  {
    slug: 'lappi-corner', sku: 'SK-LAP-160', name: 'Lappi Corner', form: 'corner',
    description: 'A corner sauna with a chamfered glass door that opens into the room on the diagonal. Built for apartments and basements where every metre counts.',
    widthMm: 1600, depthMm: 1600, heightMm: 2050, persons: 3, heaterKw: 6.8, weightKg: 330, placement: 'Indoor', listPrice: 890000, maxDiscountBps: 1500,
    omit: ['heater:wood-stove'],
  },
  {
    slug: 'kelo-barrel', sku: 'SK-KEL-240', name: 'Kelo Barrel', form: 'barrel',
    description: 'The classic barrel: staves of thick pine held by stainless bands, with a round heat-efficient profile that warms quickly even in January.',
    widthMm: 2000, depthMm: 2400, heightMm: 2050, persons: 6, heaterKw: 9, weightKg: 780, placement: 'Outdoor', listPrice: 1190000, maxDiscountBps: 1000, defaultWood: 'kelo',
  },
  {
    slug: 'aurora-hex', sku: 'SK-AUR-240', name: 'Aurora Hex', form: 'hex',
    description: 'A six-sided pavilion with a raised lantern roof and a ring of benches that puts everyone at the same height. Made for sauna evenings, not solo sessions.',
    widthMm: 2400, depthMm: 2100, heightMm: 2600, persons: 8, heaterKw: 10.5, weightKg: 1100, placement: 'Outdoor', listPrice: 1890000, maxDiscountBps: 1000,
  },
  {
    slug: 'saimaa-garden-house', sku: 'SK-SAI-300', name: 'Saimaa Garden House', form: 'cabin',
    description: 'A garden building with a covered porch, a changing room and a sauna for six. Insulated walls, a pitched roof and a door you can leave the summer open through.',
    widthMm: 3000, depthMm: 2400, heightMm: 2600, persons: 6, heaterKw: 10.5, weightKg: 1650, placement: 'Outdoor', listPrice: 2490000, maxDiscountBps: 800,
  },
];

export const ROOM_PRESETS: { code: string; name: string; description: string; preset: RoomPreset }[] = [
  { code: 'bathroom', name: 'Scandinavian bathroom', description: 'Large-format tiles and a pale wall: the indoor classic.', preset: { widthMm: 3600, depthMm: 3000, heightMm: 2600, floor: 'tiles', wallColor: '#e9e5dd', windowWall: 'east' } },
  { code: 'basement', name: 'Basement spa', description: 'Polished concrete, room for a shower and a cold plunge.', preset: { widthMm: 5200, depthMm: 4200, heightMm: 2500, floor: 'concrete', wallColor: '#d2cfc8', windowWall: 'none' } },
  { code: 'garden', name: 'Garden deck', description: 'A timber deck in the garden, open to the sky.', preset: { widthMm: 8000, depthMm: 6000, heightMm: 4000, floor: 'decking', wallColor: '#dfe5dc', windowWall: 'none' } },
];

function attributes(m: ModelSeed): Attribute[] {
  return [
    { code: 'capacity_persons', label: 'Seats', unit: 'persons', value: m.persons },
    { code: 'width_mm', label: 'Width', unit: 'mm', value: m.widthMm },
    { code: 'depth_mm', label: 'Depth', unit: 'mm', value: m.depthMm },
    { code: 'height_mm', label: 'Height', unit: 'mm', value: m.heightMm },
    { code: 'heater_kw', label: 'Heater output', unit: 'kW', value: m.heaterKw },
    { code: 'volume_m3', label: 'Volume', unit: 'm³', value: Math.round((m.widthMm * m.depthMm * m.heightMm) / 1e8) / 10 },
    { code: 'weight_kg', label: 'Weight', unit: 'kg', value: m.weightKg },
    { code: 'placement', label: 'Placement', unit: null, value: m.placement },
    { code: 'form', label: 'Form', unit: null, value: m.form },
    { code: 'bench_levels', label: 'Bench levels', unit: null, value: m.persons > 3 ? 2 : 1 },
    { code: 'assembly', label: 'Delivered', unit: null, value: m.form === 'cabin' || m.form === 'hex' ? 'Pre-assembled panels' : 'Flat-pack modules' },
  ];
}

function groups(m: ModelSeed): OptionGroupDto[] {
  return GROUPS.map(g => ({
    id: groupId(g.code),
    code: g.code,
    name: g.name,
    selectionType: g.selectionType,
    required: g.required,
    options: g.options
      .filter(o => !m.omit?.includes(`${g.code}:${o.code}`))
      .map(o => ({
        id: optId(g.code, o.code),
        code: o.code,
        name: o.name,
        description: o.description ?? null,
        swatchColor: o.swatch ?? null,
        thumbnailUrl: null,
        glbUrl: null,
        // Larger saunas need more material for the same option.
        priceDeltaMinor: Math.round((o.price * (g.code === 'wood' ? m.widthMm * m.depthMm / 2_640_000 : 1)) / 100) * 100,
        isDefault: g.code === 'wood' && m.defaultWood ? o.code === m.defaultWood : Boolean(o.isDefault),
      })),
  }));
}

const RULES = {
  requires: [
    { optionId: optId('lighting', 'starlight'), requiredOptionId: optId('control', 'digital') },
  ],
  excludes: [
    { optionAId: optId('heater', 'wood-stove'), optionBId: optId('control', 'digital') },
    { optionAId: optId('heater', 'wood-stove'), optionBId: optId('control', 'app') },
    { optionAId: optId('heater', 'wood-stove'), optionBId: optId('lighting', 'starlight') },
  ],
};

export function saunaDetails(): SaunaDetail[] {
  return MODELS.map((m, i) => ({
    id: fid(`model:${m.slug}`),
    slug: m.slug,
    sku: m.sku,
    name: m.name,
    description: m.description,
    attributes: attributes(m),
    assets: { thumbnailUrl: null, gallery: [], lowGlbUrl: null, highGlbUrl: null, hasAr: false },
    listPriceMinor: m.listPrice,
    priceFromMinor: m.listPrice,
    discount: null,
    sortOrder: i * 10,
    groups: groups(m).filter(g => g.options.length > 0),
    rules: (() => {
      const ids = new Set(groups(m).flatMap(g => g.options.map(o => o.id)));
      return {
        requires: RULES.requires.filter(r => ids.has(r.optionId) && ids.has(r.requiredOptionId)),
        excludes: RULES.excludes.filter(x => ids.has(x.optionAId) && ids.has(x.optionBId)),
      };
    })(),
    maxDiscountBps: m.maxDiscountBps,
  }));
}

export const optionIds = { optId, groupId };
