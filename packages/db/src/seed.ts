/**
 * Development seed (idempotent, runs as the owner/superuser in one transaction).
 *
 * Manufacturer "Nordlicht Saunabau", 6 saunas with specs, EUR/CHF/SEK prices for models and every
 * option, option groups and rules, 3 room scenes, translations (de, fr, it), resellers alpha
 * (EUR), beta (CHF) and gamma (SEK, suspended) with branding, assignments and discounts, staff,
 * customers (anna@example.test exists at alpha AND beta), configurations (drafts, locked with
 * snapshots), a share link, requests in several statuses with quotes, and one sample asset set.
 *
 * Every id is deterministic (seedId), so tests and E2E can reference rows. With LOCAL_IDP=1 the
 * matching local IdP users are created with the password SEED_PASSWORD.
 *
 * CLI: `node src/seed.ts` (DATABASE_URL, LOCAL_IDP=1).
 */
import { createHash } from 'node:crypto';
import pg from 'pg';
import { calculatePrice, type Discount } from '@saunaklar/pricing';
import { DEFAULT_DATABASE_URL, isLocalIdp, isMain } from './migrate.ts';
import { hashPassword } from './password.ts';

/** Deterministic UUID (v5 layout) for a seed label. */
export function seedId(label: string): string {
  const h = createHash('sha256').update(`saunaklar-seed:${label}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export const SEED_PASSWORD = 'Sauna!2026';
/** Share token of the seeded alpha link: open http://alpha.localhost:5173/s/<token>. */
export const SEED_SHARE_TOKEN = createHash('sha256').update('saunaklar-seed-share-alpha').digest('base64url');

export const SEED = {
  manufacturerId: seedId('manufacturer:nordlicht'),
  resellers: { alpha: seedId('reseller:alpha'), beta: seedId('reseller:beta'), gamma: seedId('reseller:gamma') },
  staff: {
    admin: seedId('staff:admin@nordlicht.test'),
    alphaOwner: seedId('staff:owner@alpha.test'),
    betaOwner: seedId('staff:owner@beta.test'),
    gammaOwner: seedId('staff:owner@gamma.test'),
  },
  customers: {
    annaAlpha: seedId('customer:alpha:anna'),
    annaBeta: seedId('customer:beta:anna'),
    benAlpha: seedId('customer:alpha:ben'),
  },
  models: (slug: string) => seedId(`model:${slug}`),
  options: (code: string) => seedId(`option:${code}`),
  groups: (code: string) => seedId(`group:${code}`),
  rooms: (code: string) => seedId(`room:${code}`),
  configurations: {
    annaDraft: seedId('configuration:alpha:anna-draft'),
    annaInReview: seedId('configuration:alpha:anna-in-review'),
    annaQuoted: seedId('configuration:alpha:anna-quoted'),
    benSubmitted: seedId('configuration:alpha:ben-submitted'),
    staffShared: seedId('configuration:alpha:staff-shared'),
    annaBetaAccepted: seedId('configuration:beta:anna-accepted'),
    annaBetaDraft: seedId('configuration:beta:anna-draft'),
  },
  shareLinkId: seedId('share-link:alpha'),
} as const;

// ---------------------------------------------------------------------------------------------
// Catalog data
// ---------------------------------------------------------------------------------------------
type Tr = { de: string; fr: string; it: string };
const CURRENCIES = ['EUR', 'CHF', 'SEK'] as const;
type Cur = (typeof CURRENCIES)[number];

/** EUR minor units -> rounded amount in another currency (CHF to 10, SEK to 100 units). */
function convert(eurMinor: number, cur: Cur): number {
  if (cur === 'EUR' || eurMinor === 0) return eurMinor;
  if (cur === 'CHF') return Math.round((eurMinor * 0.95) / 1000) * 1000;
  return Math.round((eurMinor * 11.5) / 10000) * 10000;
}

interface GroupDef { code: string; name: string; tr: Tr; type: 'SINGLE' | 'MULTI'; required: boolean }
const GROUPS: GroupDef[] = [
  { code: 'wood', name: 'Wood', tr: { de: 'Holzart', fr: 'Essence de bois', it: 'Tipo di legno' }, type: 'SINGLE', required: true },
  { code: 'heater', name: 'Heater', tr: { de: 'Ofen', fr: 'Poêle', it: 'Stufa' }, type: 'SINGLE', required: true },
  { code: 'control', name: 'Control unit', tr: { de: 'Steuerung', fr: 'Commande', it: 'Centralina' }, type: 'SINGLE', required: false },
  { code: 'door', name: 'Door', tr: { de: 'Tür', fr: 'Porte', it: 'Porta' }, type: 'SINGLE', required: true },
  { code: 'lighting', name: 'Lighting', tr: { de: 'Beleuchtung', fr: 'Éclairage', it: 'Illuminazione' }, type: 'MULTI', required: false },
  { code: 'extras', name: 'Extras', tr: { de: 'Extras', fr: 'Options supplémentaires', it: 'Extra' }, type: 'MULTI', required: false },
];

interface OptionDef { code: string; group: string; name: string; tr: Tr; eur: number; scales?: boolean; swatch?: string; description?: string }
const OPTIONS: OptionDef[] = [
  { code: 'spruce', group: 'wood', name: 'Nordic spruce', tr: { de: 'Nordische Fichte', fr: 'Épicéa nordique', it: 'Abete nordico' }, eur: 0, scales: true, swatch: '#e8d4a8', description: 'Light, resinous and fragrant; the classic Finnish sauna wood.' },
  { code: 'aspen', group: 'wood', name: 'Aspen', tr: { de: 'Espe', fr: 'Tremble', it: 'Pioppo tremulo' }, eur: 45000, scales: true, swatch: '#efe3c8', description: 'Pale, resin-free and cool to the touch.' },
  { code: 'thermo-aspen', group: 'wood', name: 'Thermo-aspen', tr: { de: 'Thermo-Espe', fr: 'Tremble thermotraité', it: 'Pioppo tremulo termotrattato' }, eur: 89000, scales: true, swatch: '#8a5a3b', description: 'Heat-treated aspen with a deep caramel tone and high dimensional stability.' },
  { code: 'red-cedar', group: 'wood', name: 'Western red cedar', tr: { de: 'Rote Zeder', fr: 'Cèdre rouge', it: 'Cedro rosso' }, eur: 129000, scales: true, swatch: '#a0522d', description: 'Aromatic, naturally durable and warm in colour.' },
  { code: 'heater-6kw', group: 'heater', name: 'Electric heater 6 kW', tr: { de: 'Elektroofen 6 kW', fr: 'Poêle électrique 6 kW', it: 'Stufa elettrica 6 kW' }, eur: 0 },
  { code: 'heater-9kw', group: 'heater', name: 'Electric heater 9 kW', tr: { de: 'Elektroofen 9 kW', fr: 'Poêle électrique 9 kW', it: 'Stufa elettrica 9 kW' }, eur: 39000 },
  { code: 'heater-wood', group: 'heater', name: 'Wood-fired stove', tr: { de: 'Holzofen', fr: 'Poêle à bois', it: 'Stufa a legna' }, eur: 119000 },
  { code: 'control-basic', group: 'control', name: 'Basic control panel', tr: { de: 'Basis-Steuerung', fr: 'Commande de base', it: 'Centralina base' }, eur: 29000 },
  { code: 'control-wifi', group: 'control', name: 'Wi-Fi control with app', tr: { de: 'WLAN-Steuerung mit App', fr: 'Commande Wi-Fi avec application', it: 'Centralina Wi-Fi con app' }, eur: 59000 },
  { code: 'door-clear', group: 'door', name: 'Clear glass door', tr: { de: 'Klarglastür', fr: 'Porte en verre clair', it: 'Porta in vetro trasparente' }, eur: 0 },
  { code: 'door-bronze', group: 'door', name: 'Bronze glass door', tr: { de: 'Bronzeglastür', fr: 'Porte en verre bronze', it: 'Porta in vetro bronzato' }, eur: 19000 },
  { code: 'door-wood', group: 'door', name: 'Solid wood door', tr: { de: 'Massivholztür', fr: 'Porte en bois massif', it: 'Porta in legno massiccio' }, eur: 24000 },
  { code: 'led-backrest', group: 'lighting', name: 'LED backrest lighting', tr: { de: 'LED-Rückenlehnenbeleuchtung', fr: 'Éclairage LED du dossier', it: 'Illuminazione LED dello schienale' }, eur: 24000 },
  { code: 'led-underbench', group: 'lighting', name: 'LED under-bench lighting', tr: { de: 'LED-Unterbankbeleuchtung', fr: 'Éclairage LED sous les bancs', it: 'Illuminazione LED sotto le panche' }, eur: 21000 },
  { code: 'star-ceiling', group: 'lighting', name: 'Starry-sky ceiling', tr: { de: 'Sternenhimmel', fr: 'Plafond ciel étoilé', it: 'Cielo stellato' }, eur: 69000 },
  { code: 'audio', group: 'extras', name: 'Bluetooth audio system', tr: { de: 'Bluetooth-Audiosystem', fr: 'Système audio Bluetooth', it: 'Impianto audio Bluetooth' }, eur: 49000 },
  { code: 'aroma', group: 'extras', name: 'Aroma dispenser', tr: { de: 'Aromaspender', fr: 'Diffuseur d’arômes', it: 'Diffusore di aromi' }, eur: 18000 },
  { code: 'bucket-set', group: 'extras', name: 'Bucket and ladle set', tr: { de: 'Kübel- und Kellenset', fr: 'Seau et louche', it: 'Set secchio e mestolo' }, eur: 12000 },
  { code: 'salt-wall', group: 'extras', name: 'Himalayan salt wall', tr: { de: 'Himalaya-Salzwand', fr: 'Mur de sel de l’Himalaya', it: 'Parete di sale himalayano' }, eur: 99000 },
];

/** [option, required option] and [option, option] pairs, applied when the model offers both. */
const REQUIRES: [string, string][] = [['audio', 'led-backrest']];
const EXCLUDES: [string, string][] = [
  ['heater-wood', 'control-basic'],
  ['heater-wood', 'control-wifi'],
  ['star-ceiling', 'spruce'],
  ['salt-wall', 'heater-wood'],
];

interface ModelDef {
  slug: string; sku: string; name: string; description: string; tr: { de: [string, string]; fr: [string, string]; it: [string, string] };
  w: number; d: number; h: number; persons: number; kw: number; kg: number;
  eur: number; capBps: number; size: number; without: string[];
}
const MODELS: ModelDef[] = [
  { slug: 'espoo-compact', sku: 'NL-ESP-160', name: 'Espoo Compact', description: 'A compact two-to-three seat indoor sauna that fits a bathroom corner.',
    tr: { de: ['Espoo Compact', 'Kompakte Innensauna für zwei bis drei Personen, passt in jede Badezimmerecke.'], fr: ['Espoo Compact', 'Sauna d’intérieur compact pour deux à trois personnes, idéal pour un coin de salle de bain.'], it: ['Espoo Compact', 'Sauna da interno compatta per due o tre persone, ideale per un angolo del bagno.'] },
    w: 1600, d: 1400, h: 2050, persons: 3, kw: 6, kg: 380, eur: 699000, capBps: 1500, size: 0.8, without: ['heater-9kw', 'salt-wall', 'star-ceiling'] },
  { slug: 'lappi-barrel', sku: 'NL-LAP-220', name: 'Lappi Barrel', description: 'A classic outdoor barrel sauna for four, with a panoramic rear window.',
    tr: { de: ['Lappi Barrel', 'Klassische Fasssauna für vier Personen mit Panorama-Rückfenster.'], fr: ['Lappi Barrel', 'Sauna tonneau classique pour quatre personnes avec fenêtre panoramique.'], it: ['Lappi Barrel', 'Classica sauna a botte per quattro persone con finestra panoramica.'] },
    w: 2200, d: 1900, h: 2000, persons: 4, kw: 9, kg: 620, eur: 949000, capBps: 1200, size: 1.0, without: [] },
  { slug: 'turku-panorama', sku: 'NL-TUR-240', name: 'Turku Panorama', description: 'A garden sauna for six with a full-height glass front.',
    tr: { de: ['Turku Panorama', 'Gartensauna für sechs Personen mit raumhoher Glasfront.'], fr: ['Turku Panorama', 'Sauna de jardin pour six personnes avec façade entièrement vitrée.'], it: ['Turku Panorama', 'Sauna da giardino per sei persone con vetrata a tutta altezza.'] },
    w: 2400, d: 2000, h: 2100, persons: 6, kw: 9, kg: 820, eur: 1499000, capBps: 1000, size: 1.2, without: [] },
  { slug: 'oulu-corner', sku: 'NL-OUL-180', name: 'Oulu Corner', description: 'A space-saving corner sauna for four with an angled glass door.',
    tr: { de: ['Oulu Corner', 'Platzsparende Ecksauna für vier Personen mit abgewinkelter Glastür.'], fr: ['Oulu Corner', 'Sauna d’angle peu encombrant pour quatre personnes avec porte vitrée en biais.'], it: ['Oulu Corner', 'Sauna angolare salvaspazio per quattro persone con porta in vetro angolata.'] },
    w: 1800, d: 1800, h: 2050, persons: 4, kw: 6, kg: 450, eur: 829000, capBps: 2000, size: 0.9, without: ['heater-wood'] },
  { slug: 'kuopio-cube', sku: 'NL-KUO-200', name: 'Kuopio Cube', description: 'A cubic outdoor sauna for five with a flat green roof.',
    tr: { de: ['Kuopio Cube', 'Würfelförmige Außensauna für fünf Personen mit begrüntem Flachdach.'], fr: ['Kuopio Cube', 'Sauna d’extérieur cubique pour cinq personnes avec toit plat végétalisé.'], it: ['Kuopio Cube', 'Sauna da esterno cubica per cinque persone con tetto piano verde.'] },
    w: 2000, d: 2000, h: 2200, persons: 5, kw: 9, kg: 700, eur: 1199000, capBps: 1500, size: 1.1, without: [] },
  { slug: 'helsinki-studio', sku: 'NL-HEL-280', name: 'Helsinki Studio', description: 'A sauna house for eight with a changing room and lounge bench.',
    tr: { de: ['Helsinki Studio', 'Saunahaus für acht Personen mit Umkleide und Ruhebank.'], fr: ['Helsinki Studio', 'Maison-sauna pour huit personnes avec vestiaire et banc de repos.'], it: ['Helsinki Studio', 'Casetta sauna per otto persone con spogliatoio e panca relax.'] },
    w: 2800, d: 2200, h: 2200, persons: 8, kw: 9, kg: 1050, eur: 1899000, capBps: 800, size: 1.4, without: ['heater-6kw'] },
];

const ATTRIBUTES: { code: string; label: string; unit: string | null; tr: Tr; get: (m: ModelDef) => number }[] = [
  { code: 'width_mm', label: 'Width', unit: 'mm', tr: { de: 'Breite', fr: 'Largeur', it: 'Larghezza' }, get: m => m.w },
  { code: 'depth_mm', label: 'Depth', unit: 'mm', tr: { de: 'Tiefe', fr: 'Profondeur', it: 'Profondità' }, get: m => m.d },
  { code: 'height_mm', label: 'Height', unit: 'mm', tr: { de: 'Höhe', fr: 'Hauteur', it: 'Altezza' }, get: m => m.h },
  { code: 'capacity_persons', label: 'Seats', unit: 'persons', tr: { de: 'Sitzplätze', fr: 'Places', it: 'Posti' }, get: m => m.persons },
  { code: 'heater_kw', label: 'Heater output', unit: 'kW', tr: { de: 'Ofenleistung', fr: 'Puissance du poêle', it: 'Potenza della stufa' }, get: m => m.kw },
  { code: 'weight_kg', label: 'Weight', unit: 'kg', tr: { de: 'Gewicht', fr: 'Poids', it: 'Peso' }, get: m => m.kg },
];

const ROOMS = [
  { code: 'garden-deck', name: 'Garden deck', description: 'An open wooden deck in a green garden.',
    tr: { de: ['Gartenterrasse', 'Eine offene Holzterrasse in einem grünen Garten.'], fr: ['Terrasse de jardin', 'Une terrasse en bois ouverte dans un jardin verdoyant.'], it: ['Terrazza in giardino', 'Una terrazza in legno aperta in un giardino verde.'] },
    preset: { widthMm: 6000, depthMm: 5000, heightMm: 3000, floor: 'decking', wallColor: '#f3efe6', windowWall: 'none' } },
  { code: 'basement-spa', name: 'Basement spa', description: 'A calm tiled spa room in the basement.',
    tr: { de: ['Wellnesskeller', 'Ein ruhiger, gefliester Wellnessraum im Keller.'], fr: ['Spa au sous-sol', 'Une salle de spa carrelée et calme au sous-sol.'], it: ['Spa nel seminterrato', 'Una tranquilla sala spa piastrellata nel seminterrato.'] },
    preset: { widthMm: 4000, depthMm: 3500, heightMm: 2500, floor: 'tiles', wallColor: '#d9d4cc', windowWall: 'east' } },
  { code: 'lakeside-terrace', name: 'Lakeside terrace', description: 'A stone terrace by a Nordic lake.',
    tr: { de: ['Seeterrasse', 'Eine Steinterrasse an einem nordischen See.'], fr: ['Terrasse au bord du lac', 'Une terrasse en pierre au bord d’un lac nordique.'], it: ['Terrazza sul lago', 'Una terrazza in pietra sulla riva di un lago nordico.'] },
    preset: { widthMm: 7000, depthMm: 6000, heightMm: 3200, floor: 'stone', wallColor: '#e6ebee', windowWall: 'south' } },
] as const;

interface ResellerDef {
  key: 'alpha' | 'beta' | 'gamma'; name: string; currency: Cur; status: 'ACTIVE' | 'SUSPENDED';
  branding: { display: string; tagline: string; color: string; email: string; phone: string; legalName: string; legalAddress: string };
  saunas: { slug: string; visible?: boolean; discount?: Discount }[];
  defaultDiscount?: Discount; rooms: string[]; owner: { key: keyof typeof SEED.staff; email: string; name: string };
}
const RESELLERS: ResellerDef[] = [
  { key: 'alpha', name: 'Alpha Spa & Sauna GmbH', currency: 'EUR', status: 'ACTIVE',
    branding: { display: 'Alpha Spa', tagline: 'Finnish saunas, built for your garden', color: '#1f2a24', email: 'support@alpha.test', phone: '+49 30 1234567', legalName: 'Alpha Spa & Sauna GmbH', legalAddress: 'Gartenstraße 12, 10115 Berlin, Germany' },
    saunas: [
      { slug: 'espoo-compact', discount: { type: 'FIXED', value: 50000 } },
      { slug: 'lappi-barrel', discount: { type: 'PERCENT', value: 800 } },
      { slug: 'turku-panorama' },
      { slug: 'oulu-corner', visible: false },
      { slug: 'kuopio-cube' },
    ],
    defaultDiscount: { type: 'PERCENT', value: 1000 }, rooms: ['garden-deck', 'basement-spa', 'lakeside-terrace'],
    owner: { key: 'alphaOwner', email: 'owner@alpha.test', name: 'Anton Albrecht' } },
  { key: 'beta', name: 'Beta Wellness AG', currency: 'CHF', status: 'ACTIVE',
    branding: { display: 'Beta Wellness', tagline: 'Swiss calm, Nordic heat', color: '#2b2440', email: 'support@beta.test', phone: '+41 44 123 45 67', legalName: 'Beta Wellness AG', legalAddress: 'Seestrasse 5, 8002 Zürich, Switzerland' },
    saunas: [
      { slug: 'espoo-compact' }, { slug: 'turku-panorama' }, { slug: 'kuopio-cube' },
      { slug: 'helsinki-studio', discount: { type: 'PERCENT', value: 500 } },
    ],
    rooms: ['garden-deck', 'lakeside-terrace'],
    owner: { key: 'betaOwner', email: 'owner@beta.test', name: 'Beatrice Brunner' } },
  { key: 'gamma', name: 'Gamma Bastu AB', currency: 'SEK', status: 'SUSPENDED',
    branding: { display: 'Gamma Bastu', tagline: 'Bastu för hela familjen', color: '#3a2a1c', email: 'support@gamma.test', phone: '+46 8 123 456 78', legalName: 'Gamma Bastu AB', legalAddress: 'Strandvägen 7, 114 56 Stockholm, Sweden' },
    saunas: [{ slug: 'lappi-barrel' }, { slug: 'oulu-corner' }, { slug: 'kuopio-cube' }],
    defaultDiscount: { type: 'FIXED', value: 100000 }, rooms: ['basement-spa'],
    owner: { key: 'gammaOwner', email: 'owner@gamma.test', name: 'Gustav Gran' } },
];

const modelBySlug = new Map(MODELS.map(m => [m.slug, m]));
const optionByCode = new Map(OPTIONS.map(o => [o.code, o]));

function offers(m: ModelDef, code: string): boolean {
  return !m.without.includes(code);
}
function optionDeltaEur(m: ModelDef, o: OptionDef): number {
  return o.scales ? Math.round((o.eur * m.size) / 1000) * 1000 : o.eur;
}

// ---------------------------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------------------------
type Db = pg.ClientBase;

async function q(db: Db, text: string, values: unknown[] = []): Promise<pg.QueryResult> {
  return db.query(text, values);
}

async function setActor(db: Db, actor: { staff?: string; customer?: string }, note = ''): Promise<void> {
  await q(db, `SELECT set_config('app.actor_staff_id', $1, true), set_config('app.actor_customer_id', $2, true),
                      set_config('app.status_note', $3, true)`, [actor.staff ?? '', actor.customer ?? '', note]);
}

async function seedCatalog(db: Db): Promise<void> {
  await q(db, `INSERT INTO manufacturers (id, name) VALUES ($1, 'Nordlicht Saunabau')`, [SEED.manufacturerId]);

  for (const [i, a] of ATTRIBUTES.entries()) {
    await q(db, `INSERT INTO attribute_definitions (code, label, unit, value_type, sort_order) VALUES ($1, $2, $3, 'NUMBER', $4)
                 ON CONFLICT (code) DO NOTHING`, [a.code, a.label, a.unit, i]);
    for (const [loc, label] of Object.entries(a.tr)) {
      await q(db, `INSERT INTO attribute_definition_translations (attribute_code, locale, label) VALUES ($1, $2, $3)
                   ON CONFLICT DO NOTHING`, [a.code, loc, label]);
    }
  }

  for (const [i, g] of GROUPS.entries()) {
    await q(db, `INSERT INTO option_groups (id, code, name, selection_type, sort_order) VALUES ($1, $2, $3, $4, $5)`,
      [SEED.groups(g.code), g.code, g.name, g.type, i]);
    for (const [loc, name] of Object.entries(g.tr)) {
      await q(db, `INSERT INTO option_group_translations (option_group_id, locale, name) VALUES ($1, $2, $3)`, [SEED.groups(g.code), loc, name]);
    }
  }
  for (const [i, o] of OPTIONS.entries()) {
    await q(db, `INSERT INTO options (id, option_group_id, code, name, description, swatch_color, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [SEED.options(o.code), SEED.groups(o.group), o.code, o.name, o.description ?? null, o.swatch ?? null, i]);
    for (const [loc, name] of Object.entries(o.tr)) {
      await q(db, `INSERT INTO option_translations (option_id, locale, name) VALUES ($1, $2, $3)`, [SEED.options(o.code), loc, name]);
    }
  }

  for (const [i, m] of MODELS.entries()) {
    const id = SEED.models(m.slug);
    await q(db, `INSERT INTO sauna_models (id, manufacturer_id, sku, slug, status, name, description, sort_order)
                 VALUES ($1, $2, $3, $4, 'ACTIVE', $5, $6, $7)`, [id, SEED.manufacturerId, m.sku, m.slug, m.name, m.description, i * 10]);
    for (const [loc, [name, description]] of Object.entries(m.tr)) {
      await q(db, `INSERT INTO sauna_model_translations (sauna_model_id, locale, name, description) VALUES ($1, $2, $3, $4)`, [id, loc, name, description]);
    }
    for (const a of ATTRIBUTES) {
      await q(db, `INSERT INTO sauna_model_attributes (sauna_model_id, attribute_code, value_number) VALUES ($1, $2, $3)`, [id, a.code, a.get(m)]);
    }
    for (const cur of CURRENCIES) {
      await q(db, `INSERT INTO sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) VALUES ($1, $2, $3, $4)`,
        [id, cur, convert(m.eur, cur), m.capBps]);
    }
    for (const [gi, g] of GROUPS.entries()) {
      await q(db, `INSERT INTO sauna_model_option_groups (sauna_model_id, option_group_id, is_required, sort_order) VALUES ($1, $2, $3, $4)`,
        [id, SEED.groups(g.code), g.required, gi]);
      const groupOptions = OPTIONS.filter(o => o.group === g.code && offers(m, o.code));
      for (const [oi, o] of groupOptions.entries()) {
        // The first option of each required group is its default.
        await q(db, `INSERT INTO sauna_model_options (sauna_model_id, option_id, option_group_id, is_default) VALUES ($1, $2, $3, $4)`,
          [id, SEED.options(o.code), SEED.groups(g.code), g.required && oi === 0]);
        for (const cur of CURRENCIES) {
          await q(db, `INSERT INTO sauna_model_option_prices (sauna_model_id, option_id, currency_code, price_delta_minor) VALUES ($1, $2, $3, $4)`,
            [id, SEED.options(o.code), cur, convert(optionDeltaEur(m, o), cur)]);
        }
      }
    }
    for (const [a, b] of REQUIRES) {
      if (offers(m, a) && offers(m, b)) {
        await q(db, `INSERT INTO option_requires (sauna_model_id, option_id, required_option_id) VALUES ($1, $2, $3)`, [id, SEED.options(a), SEED.options(b)]);
      }
    }
    for (const [a, b] of EXCLUDES) {
      if (offers(m, a) && offers(m, b)) {
        const [x, y] = [SEED.options(a), SEED.options(b)].sort();
        await q(db, `INSERT INTO option_excludes (sauna_model_id, option_a_id, option_b_id) VALUES ($1, $2, $3)`, [id, x, y]);
      }
    }
  }

  for (const [i, r] of ROOMS.entries()) {
    const id = SEED.rooms(r.code);
    await q(db, `INSERT INTO room_scenes (id, manufacturer_id, code, name, description, status, preset, sort_order)
                 VALUES ($1, $2, $3, $4, $5, 'ACTIVE', $6, $7)`, [id, SEED.manufacturerId, r.code, r.name, r.description, JSON.stringify(r.preset), i]);
    for (const [loc, [name, description]] of Object.entries(r.tr)) {
      await q(db, `INSERT INTO room_scene_translations (room_scene_id, locale, name, description) VALUES ($1, $2, $3, $4)`, [id, loc, name, description]);
    }
  }

  // Sample asset set for Espoo Compact (files provided separately). URL = '/' + storage_key.
  const espoo = SEED.models('espoo-compact');
  const assets: [string, string, string, string][] = [
    ['MODEL_GLB_HIGH', 'assets/hi/catalog/espoo-compact/high-9f3c2a.glb', 'model/gltf-binary', 'asset:espoo:high'],
    ['MODEL_AR_GLB', 'assets/hi/catalog/espoo-compact/ar-9f3c2a.glb', 'model/gltf-binary', 'asset:espoo:ar'],
    ['MODEL_GLB_LOW', 'assets/lo/catalog/espoo-compact/low-4b1e7d.glb', 'model/gltf-binary', 'asset:espoo:low'],
    ['MODEL_THUMBNAIL', 'media/catalog/espoo-compact/thumb-1a2b3c.webp', 'image/webp', 'asset:espoo:thumb'],
  ];
  for (const [role, key, type, label] of assets) {
    await q(db, `INSERT INTO assets (id, storage_key, content_type) VALUES ($1, $2, $3)`, [seedId(label), key, type]);
    await q(db, `INSERT INTO sauna_model_assets (sauna_model_id, asset_role, asset_id) VALUES ($1, $2, $3)`, [espoo, role, seedId(label)]);
  }
}

async function seedTenants(db: Db): Promise<void> {
  await q(db, `INSERT INTO staff_users (id, email, display_name, idp_subject, status) VALUES ($1, 'admin@nordlicht.test', 'Nora Lindqvist', $2, 'ACTIVE')`,
    [SEED.staff.admin, seedId('idp:admin@nordlicht.test')]);
  await q(db, `INSERT INTO manufacturer_admins (staff_user_id, manufacturer_id) VALUES ($1, $2)`, [SEED.staff.admin, SEED.manufacturerId]);

  for (const r of RESELLERS) {
    const rid = SEED.resellers[r.key];
    await q(db, `INSERT INTO resellers (id, manufacturer_id, slug, name, currency_code, status) VALUES ($1, $2, $3, $4, $5, $6)`,
      [rid, SEED.manufacturerId, r.key, r.name, r.currency, r.status]);
    const b = r.branding;
    await q(db, `INSERT INTO reseller_branding (reseller_id, display_name, tagline, primary_color, support_email, support_phone, legal_name, legal_address)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [rid, b.display, b.tagline, b.color, b.email, b.phone, b.legalName, b.legalAddress]);
    const sid = SEED.staff[r.owner.key];
    await q(db, `INSERT INTO staff_users (id, email, display_name, idp_subject, status) VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [sid, r.owner.email, r.owner.name, seedId(`idp:${r.owner.email}`)]);
    await q(db, `INSERT INTO reseller_admins (reseller_id, staff_user_id, role) VALUES ($1, $2, 'OWNER')`, [rid, sid]);

    for (const [i, s] of r.saunas.entries()) {
      await q(db, `INSERT INTO reseller_saunas (reseller_id, sauna_model_id, is_visible, sort_order) VALUES ($1, $2, $3, $4)`,
        [rid, SEED.models(s.slug), s.visible ?? true, i * 10]);
      if (s.discount) {
        await q(db, `INSERT INTO reseller_sauna_discounts (reseller_id, sauna_model_id, discount_type, discount_value) VALUES ($1, $2, $3, $4)`,
          [rid, SEED.models(s.slug), s.discount.type, s.discount.value]);
      }
    }
    // Written after the assignments: it is checked against the lowest cap of the assigned saunas.
    if (r.defaultDiscount) {
      await q(db, `INSERT INTO reseller_default_discounts (reseller_id, discount_type, discount_value) VALUES ($1, $2, $3)`,
        [rid, r.defaultDiscount.type, r.defaultDiscount.value]);
    }
    for (const [i, code] of r.rooms.entries()) {
      await q(db, `INSERT INTO reseller_room_scenes (reseller_id, room_scene_id, sort_order) VALUES ($1, $2, $3)`, [rid, SEED.rooms(code), i]);
    }
  }
}

interface CustomerDef { id: string; reseller: 'alpha' | 'beta'; email: string; first: string; last: string; phone: string; locale: string; marketing: boolean;
  addresses: { type: 'BILLING' | 'SITE'; line1: string; postal: string; city: string; country: string }[] }
const CUSTOMERS: CustomerDef[] = [
  { id: SEED.customers.annaAlpha, reseller: 'alpha', email: 'anna@example.test', first: 'Anna', last: 'Virtanen', phone: '+49 151 2345678', locale: 'de', marketing: true,
    addresses: [
      { type: 'BILLING', line1: 'Lindenallee 4', postal: '10437', city: 'Berlin', country: 'DE' },
      { type: 'SITE', line1: 'Am Seeufer 9', postal: '14469', city: 'Potsdam', country: 'DE' },
    ] },
  { id: SEED.customers.annaBeta, reseller: 'beta', email: 'anna@example.test', first: 'Anna', last: 'Virtanen', phone: '+41 79 123 45 67', locale: 'de', marketing: false,
    addresses: [{ type: 'BILLING', line1: 'Bahnhofstrasse 21', postal: '8001', city: 'Zürich', country: 'CH' }] },
  { id: SEED.customers.benAlpha, reseller: 'alpha', email: 'ben@example.test', first: 'Ben', last: 'Koskinen', phone: '+49 89 7654321', locale: 'en', marketing: false,
    addresses: [{ type: 'BILLING', line1: 'Leopoldstraße 50', postal: '80802', city: 'München', country: 'DE' }] },
];

async function seedCustomers(db: Db): Promise<void> {
  for (const c of CUSTOMERS) {
    const rid = SEED.resellers[c.reseller];
    await q(db, `INSERT INTO customers (id, reseller_id, email, first_name, last_name, phone, locale, status, email_verified_at, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', now() - interval '20 days', now() - interval '21 days')`,
      [c.id, rid, c.email, c.first, c.last, c.phone, c.locale]);
    for (const a of c.addresses) {
      await q(db, `INSERT INTO customer_addresses (customer_id, reseller_id, address_type, recipient, line1, postal_code, city, country_code, is_default)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`, [c.id, rid, a.type, `${c.first} ${c.last}`, a.line1, a.postal, a.city, a.country]);
    }
    const consents = ['TERMS', 'PRIVACY', ...(c.marketing ? ['MARKETING'] : [])];
    for (const t of consents) {
      await q(db, `INSERT INTO customer_consents (customer_id, reseller_id, consent_type, version, granted_at)
                   VALUES ($1, $2, $3, '2026-01', now() - interval '21 days')`, [c.id, rid, t]);
    }
  }
}

interface ConfigDef { id: string; reseller: 'alpha' | 'beta'; model: string; customer?: string; staff?: string; name: string; options: string[];
  room?: { code: string; x: number; z: number; rot: number }; lock: boolean }

/** Writes a configuration with selections; when lock, also a price snapshot (pricing package) and locked_at. */
async function writeConfiguration(db: Db, c: ConfigDef): Promise<void> {
  const r = RESELLERS.find(x => x.key === c.reseller)!;
  const rid = SEED.resellers[c.reseller];
  const m = modelBySlug.get(c.model)!;
  const mid = SEED.models(c.model);
  await q(db, `INSERT INTO configurations (id, reseller_id, sauna_model_id, customer_id, created_by_staff_id, name, created_at)
               VALUES ($1, $2, $3, $4, $5, $6, now() - interval '10 days')`, [c.id, rid, mid, c.customer ?? null, c.staff ?? null, c.name]);
  for (const code of c.options) {
    await q(db, `INSERT INTO configuration_selections (configuration_id, sauna_model_id, option_id) VALUES ($1, $2, $3)`, [c.id, mid, SEED.options(code)]);
  }
  if (c.room) {
    await q(db, `INSERT INTO configuration_room_placements (configuration_id, reseller_id, room_scene_id, position_x_mm, position_z_mm, rotation_deg)
                 VALUES ($1, $2, $3, $4, $5, $6)`, [c.id, rid, SEED.rooms(c.room.code), c.room.x, c.room.z, c.room.rot]);
  }
  if (!c.lock) return;

  const sauna = r.saunas.find(s => s.slug === c.model);
  const price = calculatePrice({
    listPriceMinor: convert(m.eur, r.currency),
    maxDiscountBps: m.capBps,
    options: c.options.map(code => ({ optionId: SEED.options(code), priceDeltaMinor: convert(optionDeltaEur(m, optionByCode.get(code)!), r.currency) })),
    perSaunaDiscount: sauna?.discount ?? null,
    defaultDiscount: r.defaultDiscount ?? null,
  });
  await q(db, `INSERT INTO configuration_price_snapshots
                 (configuration_id, currency_code, list_price_minor, options_total_minor, discount_amount_minor, final_price_minor,
                  discount_source, discount_type, discount_value, max_discount_bps)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [c.id, r.currency, price.listPriceMinor, price.optionsTotalMinor, price.discountMinor, price.finalPriceMinor,
     price.discountSource, price.discountType, price.discountValue, m.capBps]);
  for (const l of price.lines) {
    await q(db, `INSERT INTO configuration_price_snapshot_lines (configuration_id, option_id, price_delta_minor) VALUES ($1, $2, $3)`,
      [c.id, l.optionId, l.priceDeltaMinor]);
  }
  await q(db, `UPDATE configurations SET locked_at = now() WHERE id = $1`, [c.id]);
}

async function seedConfigurations(db: Db): Promise<void> {
  const C = SEED.configurations;
  const { annaAlpha, annaBeta, benAlpha } = SEED.customers;
  const alphaOwner = SEED.staff.alphaOwner;
  const betaOwner = SEED.staff.betaOwner;
  const configs: ConfigDef[] = [
    { id: C.annaDraft, reseller: 'alpha', model: 'espoo-compact', customer: annaAlpha, name: 'Bathroom sauna (draft)',
      options: ['spruce', 'heater-6kw', 'door-clear', 'led-backrest'], lock: false },
    { id: C.annaInReview, reseller: 'alpha', model: 'lappi-barrel', customer: annaAlpha, name: 'Lappi with audio',
      options: ['thermo-aspen', 'heater-9kw', 'control-wifi', 'door-bronze', 'led-backrest', 'audio'],
      room: { code: 'garden-deck', x: 1200, z: -800, rot: 90 }, lock: true },
    { id: C.annaQuoted, reseller: 'alpha', model: 'turku-panorama', customer: annaAlpha, name: 'Turku by the lake',
      options: ['red-cedar', 'heater-wood', 'door-wood', 'led-underbench', 'bucket-set'],
      room: { code: 'lakeside-terrace', x: 0, z: 0, rot: 180 }, lock: true },
    { id: C.benSubmitted, reseller: 'alpha', model: 'kuopio-cube', customer: benAlpha, name: 'Kuopio for the family',
      options: ['aspen', 'heater-9kw', 'door-clear', 'aroma', 'bucket-set'], lock: true },
    { id: C.staffShared, reseller: 'alpha', model: 'espoo-compact', staff: alphaOwner, name: 'Showroom offer: Espoo Compact',
      options: ['spruce', 'heater-6kw', 'control-basic', 'door-bronze'], lock: true },
    { id: C.annaBetaAccepted, reseller: 'beta', model: 'helsinki-studio', customer: annaBeta, name: 'Helsinki Studio',
      options: ['aspen', 'heater-9kw', 'control-wifi', 'door-clear', 'star-ceiling', 'led-backrest', 'audio', 'salt-wall'], lock: true },
    { id: C.annaBetaDraft, reseller: 'beta', model: 'espoo-compact', customer: annaBeta, name: 'Small one',
      options: ['aspen'], lock: false },
  ];
  for (const c of configs) await writeConfiguration(db, c);

  // Share link created by the alpha owner (token SEED_SHARE_TOKEN; only its SHA-256 is stored).
  await q(db, `INSERT INTO share_links (id, reseller_id, configuration_id, token_hash, created_by_staff_id, expires_at)
               VALUES ($1, $2, $3, $4, $5, now() + interval '30 days')`,
    [SEED.shareLinkId, SEED.resellers.alpha, C.staffShared, createHash('sha256').update(SEED_SHARE_TOKEN).digest(), alphaOwner]);
  await q(db, `INSERT INTO share_link_views (share_link_id, reseller_id, device_class, viewed_at)
               VALUES ($1, $2, 'DESKTOP', now() - interval '2 days'), ($1, $2, 'MOBILE', now() - interval '1 day')`,
    [SEED.shareLinkId, SEED.resellers.alpha]);

  // Requests (each sent by its customer; transitions by staff or customer, via the triggers).
  const send = async (id: string, configId: string, reseller: string, customer: string, message: string) => {
    await setActor(db, { customer });
    await q(db, `INSERT INTO configuration_requests (id, reseller_id, customer_id, configuration_id, message) VALUES ($1, $2, $3, $4, $5)`,
      [id, reseller, customer, configId, message]);
  };
  const move = async (id: string, to: string, actor: { staff?: string; customer?: string }, note = '') => {
    await setActor(db, actor, note);
    await q(db, `UPDATE configuration_requests SET status_code = $2 WHERE id = $1`, [id, to]);
  };
  const quote = async (id: string, reseller: string, currency: string, amount: number, staff: string, note: string) => {
    await setActor(db, { staff });
    await q(db, `INSERT INTO request_quotes (request_id, reseller_id, amount_minor, currency_code, valid_until, note, created_by_staff_id)
                 VALUES ($1, $2, $3, $4, now() + interval '21 days', $5, $6)`, [id, reseller, amount, currency, note, staff]);
  };

  const rInReview = seedId('request:alpha:anna-in-review');
  await send(rInReview, C.annaInReview, SEED.resellers.alpha, annaAlpha, 'Could you deliver in May? We have a level gravel base.');
  await move(rInReview, 'IN_REVIEW', { staff: alphaOwner }, 'Checking delivery slots for May.');
  await setActor(db, { staff: alphaOwner });
  await q(db, `INSERT INTO request_notes (request_id, reseller_id, author_staff_id, body) VALUES ($1, $2, $3, $4)`,
    [rInReview, SEED.resellers.alpha, alphaOwner, 'Customer prefers delivery in week 19; crane access via the north gate.']);

  const rQuoted = seedId('request:alpha:anna-quoted');
  await send(rQuoted, C.annaQuoted, SEED.resellers.alpha, annaAlpha, 'Please include installation on our lakeside terrace.');
  await move(rQuoted, 'IN_REVIEW', { staff: alphaOwner });
  await quote(rQuoted, SEED.resellers.alpha, 'EUR', 1650000, alphaOwner, 'First draft including transport.');
  await move(rQuoted, 'QUOTED', { staff: alphaOwner });
  await move(rQuoted, 'IN_REVIEW', { staff: alphaOwner }, 'Revising: installation added.');
  await quote(rQuoted, SEED.resellers.alpha, 'EUR', 1790000, alphaOwner, 'Including installation and transport.');
  await move(rQuoted, 'QUOTED', { staff: alphaOwner }, 'Quote with installation sent.');

  await send(seedId('request:alpha:ben-submitted'), C.benSubmitted, SEED.resellers.alpha, benAlpha, 'Is a green roof kit available?');

  const rAccepted = seedId('request:beta:anna-accepted');
  await send(rAccepted, C.annaBetaAccepted, SEED.resellers.beta, annaBeta, 'For our chalet in Graubünden.');
  await move(rAccepted, 'IN_REVIEW', { staff: betaOwner });
  await quote(rAccepted, SEED.resellers.beta, 'CHF', 2150000, betaOwner, 'Delivery to Graubünden included.');
  await move(rAccepted, 'QUOTED', { staff: betaOwner });
  await move(rAccepted, 'ACCEPTED', { customer: annaBeta });
  await setActor(db, {});
}

async function seedIdpUsers(db: Db): Promise<number> {
  const users: { sub: string; pool: 'CUSTOMER' | 'STAFF'; username: string; email: string; attributes: Record<string, unknown> }[] = [
    ...CUSTOMERS.map(c => ({ sub: c.id, pool: 'CUSTOMER' as const, username: c.id, email: c.email,
      attributes: { resellerId: SEED.resellers[c.reseller], given_name: c.first, family_name: c.last, locale: c.locale } })),
    { sub: seedId('idp:admin@nordlicht.test'), pool: 'STAFF', username: 'admin@nordlicht.test', email: 'admin@nordlicht.test', attributes: { name: 'Nora Lindqvist' } },
    ...RESELLERS.map(r => ({ sub: seedId(`idp:${r.owner.email}`), pool: 'STAFF' as const, username: r.owner.email.toLowerCase(), email: r.owner.email,
      attributes: { name: r.owner.name } })),
  ];
  const { rows } = await q(db, `SELECT sub::text FROM idp.users WHERE sub = ANY($1::uuid[])`, [users.map(u => u.sub)]);
  const existing = new Set(rows.map(r => (r as { sub: string }).sub));
  let created = 0;
  for (const u of users) {
    if (existing.has(u.sub)) continue;
    await q(db, `INSERT INTO idp.users (sub, pool, username, email, email_verified, password_hash, status, mfa_enabled, attributes)
                 VALUES ($1, $2, $3, $4, true, $5, 'CONFIRMED', false, $6) ON CONFLICT DO NOTHING`,
      [u.sub, u.pool, u.username, u.email, await hashPassword(SEED_PASSWORD), JSON.stringify(u.attributes)]);
    created++;
  }
  return created;
}

export interface SeedOptions {
  /** Also create local IdP users (requires migrations/local). */
  local?: boolean;
  log?: (message: string) => void;
}

/** Seeds the database at url. Idempotent: skips the data set when it already exists. */
export async function seed(url: string, options: SeedOptions = {}): Promise<{ seeded: boolean; idpUsers: number }> {
  const log = options.log ?? (() => {});
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    await q(db, 'BEGIN');
    await q(db, 'SELECT pg_advisory_xact_lock(732810443)');
    const { rowCount } = await q(db, 'SELECT 1 FROM manufacturers WHERE id = $1', [SEED.manufacturerId]);
    const seeded = !rowCount;
    if (seeded) {
      await seedCatalog(db);
      await seedTenants(db);
      await seedCustomers(db);
      await seedConfigurations(db);
      log('seeded catalog, resellers alpha/beta/gamma, staff, customers, configurations and requests');
    } else {
      log('seed data already present');
    }
    const idpUsers = options.local ? await seedIdpUsers(db) : 0;
    if (options.local) log(`local IdP users created: ${idpUsers} (password ${SEED_PASSWORD})`);
    await q(db, 'COMMIT');
    return { seeded, idpUsers };
  } catch (err) {
    await q(db, 'ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

if (isMain(import.meta.url)) {
  const url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  seed(url, { local: isLocalIdp(), log: m => console.log(m) })
    .then(() => console.log(`share link: http://alpha.localhost:5173/s/${SEED_SHARE_TOKEN}`))
    .catch(err => {
      console.error(err instanceof Error ? err.message : err);
      process.exitCode = 1;
    });
}
