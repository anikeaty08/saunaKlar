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
    /** Alpha's second staff user, role ADMIN: works requests, cannot change shop settings. */
    alphaAdmin: seedId('staff:admin@alpha.test'),
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
/** Per-locale names; TrText adds the description: [name, description]. English is the base text and the fallback. */
type Tr = { de: string; fr: string; it: string };
type TrText = { de: readonly [string, string]; fr: readonly [string, string]; it: readonly [string, string] };
const CURRENCIES = ['EUR', 'CHF', 'SEK'] as const;
type Cur = (typeof CURRENCIES)[number];

/** EUR minor units -> rounded amount in another currency (CHF to 10, SEK to 100 units). */
function convert(eurMinor: number, cur: Cur): number {
  if (cur === 'EUR' || eurMinor === 0) return eurMinor;
  if (cur === 'CHF') return Math.round((eurMinor * 0.95) / 1000) * 1000;
  return Math.round((eurMinor * 11.5) / 10000) * 10000;
}

interface GroupDef { code: string; name: string; description: string; tr: TrText; type: 'SINGLE' | 'MULTI'; required: boolean }
const GROUPS: GroupDef[] = [
  { code: 'wood', name: 'Wood', description: 'The timber for walls and ceiling inside the cabin.', type: 'SINGLE', required: true,
    tr: { de: ['Holzart', 'Das Holz für Wände und Decke im Inneren der Kabine.'], fr: ['Essence de bois', 'Le bois des parois et du plafond à l’intérieur de la cabine.'], it: ['Tipo di legno', 'Il legno di pareti e soffitto all’interno della cabina.'] } },
  { code: 'heater', name: 'Heater', description: 'What heats the sauna and the stones.', type: 'SINGLE', required: true,
    tr: { de: ['Ofen', 'Was die Sauna und die Steine erhitzt.'], fr: ['Poêle', 'Ce qui chauffe le sauna et les pierres.'], it: ['Stufa', 'Ciò che riscalda la sauna e le pietre.'] } },
  { code: 'control', name: 'Control unit', description: 'How you set temperature and timer.', type: 'SINGLE', required: false,
    tr: { de: ['Steuerung', 'Wie Sie Temperatur und Zeitschaltung einstellen.'], fr: ['Commande', 'Le réglage de la température et de la minuterie.'], it: ['Centralina', 'Come impostare temperatura e timer.'] } },
  { code: 'door', name: 'Door', description: 'The glass or timber door of the cabin.', type: 'SINGLE', required: true,
    tr: { de: ['Tür', 'Die Glas- oder Holztür der Kabine.'], fr: ['Porte', 'La porte en verre ou en bois de la cabine.'], it: ['Porta', 'La porta in vetro o in legno della cabina.'] } },
  { code: 'bench-layout', name: 'Bench layout', description: 'How the benches run along the walls.', type: 'SINGLE', required: false,
    tr: { de: ['Bankanordnung', 'Wie die Bänke an den Wänden entlang verlaufen.'], fr: ['Disposition des bancs', 'La disposition des bancs le long des parois.'], it: ['Disposizione delle panche', 'Come corrono le panche lungo le pareti.'] } },
  { code: 'bench-wood', name: 'Bench wood', description: 'The timber you sit on.', type: 'SINGLE', required: false,
    tr: { de: ['Bankholz', 'Das Holz, auf dem Sie sitzen.'], fr: ['Bois des bancs', 'Le bois sur lequel vous vous asseyez.'], it: ['Legno delle panche', 'Il legno su cui ci si siede.'] } },
  { code: 'bench-front', name: 'Bench front', description: 'The face under the benches.', type: 'SINGLE', required: false,
    tr: { de: ['Bankfront', 'Die Front unter den Bänken.'], fr: ['Façade des bancs', 'La façade sous les bancs.'], it: ['Frontale delle panche', 'Il frontale sotto le panche.'] } },
  { code: 'bench-end', name: 'Bench ends', description: 'How the open ends of the benches are finished.', type: 'SINGLE', required: false,
    tr: { de: ['Bankabschluss', 'Wie die offenen Enden der Bänke abschließen.'], fr: ['Extrémités des bancs', 'La finition des extrémités ouvertes des bancs.'], it: ['Testate delle panche', 'La finitura delle estremità aperte delle panche.'] } },
  { code: 'bench-edge', name: 'Bench edge', description: 'The profile of the front edge of each seat.', type: 'SINGLE', required: false,
    tr: { de: ['Bankkante', 'Das Profil der Vorderkante jeder Sitzfläche.'], fr: ['Chant des bancs', 'Le profil du chant avant de chaque assise.'], it: ['Bordo delle panche', 'Il profilo del bordo anteriore di ogni seduta.'] } },
  { code: 'backrest', name: 'Backrest', description: 'Support for your back on the upper bench.', type: 'SINGLE', required: false,
    tr: { de: ['Rückenlehne', 'Halt für den Rücken auf der oberen Bank.'], fr: ['Dossier', 'Un appui pour le dos sur le banc supérieur.'], it: ['Schienale', 'Un sostegno per la schiena sulla panca superiore.'] } },
  { code: 'exterior', name: 'Exterior cladding', description: 'The outer skin of a free-standing sauna.', type: 'SINGLE', required: false,
    tr: { de: ['Außenverkleidung', 'Die Außenhaut einer frei stehenden Sauna.'], fr: ['Bardage extérieur', 'L’enveloppe extérieure d’un sauna autonome.'], it: ['Rivestimento esterno', 'Il rivestimento esterno di una sauna indipendente.'] } },
  { code: 'lighting', name: 'Lighting', description: 'Light inside the cabin; combine as you like.', type: 'MULTI', required: false,
    tr: { de: ['Beleuchtung', 'Licht in der Kabine, frei kombinierbar.'], fr: ['Éclairage', 'L’éclairage de la cabine, à combiner librement.'], it: ['Illuminazione', 'Luce nella cabina, combinabile a piacere.'] } },
  { code: 'extras', name: 'Extras', description: 'Comfort and wellness additions.', type: 'MULTI', required: false,
    tr: { de: ['Extras', 'Zusätze für Komfort und Wohlbefinden.'], fr: ['Options supplémentaires', 'Compléments de confort et de bien-être.'], it: ['Extra', 'Accessori per comfort e benessere.'] } },
  // Size groups of parametric (model_source = reference) saunas; option codes carry millimetres.
  { code: 'width', name: 'Width', description: 'Outer width of the cabin along the long bench wall.', type: 'SINGLE', required: true,
    tr: { de: ['Breite', 'Außenbreite der Kabine entlang der langen Bankwand.'], fr: ['Largeur', 'Largeur extérieure de la cabine le long de la paroi du grand banc.'], it: ['Larghezza', 'Larghezza esterna della cabina lungo la parete della panca lunga.'] } },
  { code: 'depth', name: 'Depth', description: 'Outer depth from the back wall to the glass front.', type: 'SINGLE', required: true,
    tr: { de: ['Tiefe', 'Außentiefe von der Rückwand bis zur Glasfront.'], fr: ['Profondeur', 'Profondeur extérieure de la paroi du fond à la façade vitrée.'], it: ['Profondità', 'Profondità esterna dalla parete di fondo alla vetrata.'] } },
  { code: 'height', name: 'Height', description: 'Outer height; both bench levels follow it.', type: 'SINGLE', required: true,
    tr: { de: ['Höhe', 'Außenhöhe; beide Bankebenen passen sich an.'], fr: ['Hauteur', 'Hauteur extérieure ; les deux niveaux de bancs suivent.'], it: ['Altezza', 'Altezza esterna; entrambi i livelli delle panche si adeguano.'] } },
];

/** Option codes use the words the 3D construction kit reads (apps/web/src/three/kit/spec.ts). */
interface OptionDef {
  code: string; group: string; name: string; description: string; tr: TrText; eur: number; scales?: boolean; swatch?: string;
  /** Offered only by these model slugs (default: every model that does not list it in `without`). */
  only?: string[];
  /** Default of its group (default: the group's first offered option). */
  isDefault?: boolean;
}

/** The parametric six-sided glass-front sauna rebuilt from the reference PDF and SketchUp model. */
const REFERENCE_SLUG = 'kide-glass-six';
/**
 * Offered sizes in mm with EUR price deltas over the smallest; `ref` marks the measured
 * 3060 × 3013 × 2292 mm source. Keep in step with apps/web/src/three/reference/layout.ts.
 */
const REFERENCE_SIZES = {
  width: [[2400, 0], [2700, 90000], [3060, 190000, 'ref'], [3300, 260000], [3600, 350000]],
  depth: [[2400, 0], [2700, 80000], [3013, 170000, 'ref'], [3300, 240000], [3600, 320000]],
  height: [[2100, 0], [2292, 60000, 'ref'], [2400, 95000], [2700, 190000]],
} as const;
/** layout.ts REFERENCE_ASPECT_RANGE: width/depth pairs outside it stretch the measured facets. */
const REFERENCE_ASPECT_RANGE = [0.78, 1.30] as const;

function sizeOptions(): OptionDef[] {
  const words = {
    width: { en: 'width', de: 'Außenbreite', fr: 'Largeur', it: 'Larghezza' },
    depth: { en: 'depth', de: 'Außentiefe', fr: 'Profondeur', it: 'Profondità' },
    height: { en: 'height', de: 'Außenhöhe', fr: 'Hauteur', it: 'Altezza' },
  };
  return (Object.keys(REFERENCE_SIZES) as (keyof typeof REFERENCE_SIZES)[]).flatMap(group =>
    REFERENCE_SIZES[group].map((size): OptionDef => {
      const [mm, eur] = size;
      const ref = size.length > 2;
      const w = words[group];
      const name = `${mm} mm`;
      return {
        code: `${group}-${mm}`, group, name, eur, only: [REFERENCE_SLUG], isDefault: ref,
        description: `Outer ${w.en} ${mm} mm${ref ? ', the measured reference size' : ''}.`,
        tr: {
          de: [name, `${w.de} ${mm} mm${ref ? ', gemessene Referenzgröße' : ''}.`],
          fr: [name, `${w.fr} extérieure ${mm} mm${ref ? ', taille de référence mesurée' : ''}.`],
          it: [name, `${w.it} esterna ${mm} mm${ref ? ', misura di riferimento rilevata' : ''}.`],
        },
      };
    }));
}

/** Width/depth option pairs the reference sauna cannot be built in (same rule as layout.ts). */
function referenceSizeExcludes(): [string, string][] {
  const pairs: [string, string][] = [];
  for (const [w] of REFERENCE_SIZES.width) for (const [d] of REFERENCE_SIZES.depth) {
    const aspect = w / d;
    if (aspect < REFERENCE_ASPECT_RANGE[0] || aspect > REFERENCE_ASPECT_RANGE[1]) pairs.push([`width-${w}`, `depth-${d}`]);
  }
  return pairs;
}

const OPTIONS: OptionDef[] = [
  { code: 'spruce', group: 'wood', name: 'Nordic spruce', eur: 0, scales: true, swatch: '#e8d4a8', description: 'Light, resinous and fragrant; the classic Finnish sauna wood.',
    tr: { de: ['Nordische Fichte', 'Hell, harzig und duftend: das klassische finnische Saunaholz.'], fr: ['Épicéa nordique', 'Clair, résineux et parfumé : le bois de sauna finlandais classique.'], it: ['Abete nordico', 'Chiaro, resinoso e profumato: il classico legno della sauna finlandese.'] } },
  { code: 'pine', group: 'wood', name: 'Knotty Nordic pine', eur: 0, scales: true, swatch: '#d3a877', only: [REFERENCE_SLUG, 'kide-glass-corner'], isDefault: true, description: 'Warm honey-toned boards with lively knots, as in the reference cabin.',
    tr: { de: ['Astige nordische Kiefer', 'Warme, honigfarbene Bretter mit lebhaften Ästen, wie in der Referenzkabine.'], fr: ['Pin nordique noueux', 'Lames chaudes couleur miel aux nœuds vivants, comme dans la cabine de référence.'], it: ['Pino nordico nodoso', 'Doghe calde color miele con nodi vivaci, come nella cabina di riferimento.'] } },
  { code: 'aspen', group: 'wood', name: 'Aspen', eur: 45000, scales: true, swatch: '#efe3c8', description: 'Pale, resin-free and cool to the touch.',
    tr: { de: ['Espe', 'Hell, harzfrei und angenehm kühl bei Berührung.'], fr: ['Tremble', 'Pâle, sans résine et frais au toucher.'], it: ['Pioppo tremulo', 'Chiaro, privo di resina e fresco al tatto.'] } },
  { code: 'thermo-aspen', group: 'wood', name: 'Thermo-aspen', eur: 89000, scales: true, swatch: '#8a5a3b', description: 'Heat-treated aspen with a deep caramel tone and high dimensional stability.',
    tr: { de: ['Thermo-Espe', 'Hitzebehandelte Espe in tiefem Karamellton, sehr formstabil.'], fr: ['Tremble thermotraité', 'Tremble traité thermiquement, ton caramel profond et grande stabilité dimensionnelle.'], it: ['Pioppo tremulo termotrattato', 'Pioppo tremulo termotrattato dal tono caramello intenso e grande stabilità dimensionale.'] } },
  { code: 'red-cedar', group: 'wood', name: 'Western red cedar', eur: 129000, scales: true, swatch: '#a0522d', description: 'Aromatic, naturally durable and warm in colour.',
    tr: { de: ['Rote Zeder', 'Aromatisch, von Natur aus langlebig und warm im Farbton.'], fr: ['Cèdre rouge', 'Aromatique, naturellement durable et de teinte chaude.'], it: ['Cedro rosso', 'Aromatico, naturalmente durevole e dal colore caldo.'] } },
  { code: 'heater-6kw', group: 'heater', name: 'Electric heater 6 kW', eur: 0, description: 'Compact electric heater for small cabins.',
    tr: { de: ['Elektroofen 6 kW', 'Kompakter Elektroofen für kleine Kabinen.'], fr: ['Poêle électrique 6 kW', 'Poêle électrique compact pour petites cabines.'], it: ['Stufa elettrica 6 kW', 'Stufa elettrica compatta per cabine piccole.'] } },
  { code: 'heater-9kw', group: 'heater', name: 'Electric heater 9 kW', eur: 39000, description: 'More output for larger cabins and a faster heat-up.',
    tr: { de: ['Elektroofen 9 kW', 'Mehr Leistung für größere Kabinen und schnelleres Aufheizen.'], fr: ['Poêle électrique 9 kW', 'Plus de puissance pour les grandes cabines et une montée en température plus rapide.'], it: ['Stufa elettrica 9 kW', 'Più potenza per cabine grandi e un riscaldamento più rapido.'] } },
  { code: 'heater-wood', group: 'heater', name: 'Wood-fired stove', eur: 119000, description: 'Traditional wood-burning stove with a soft, crackling heat.',
    tr: { de: ['Holzofen', 'Traditioneller Holzofen mit weicher, knisternder Wärme.'], fr: ['Poêle à bois', 'Poêle à bois traditionnel à la chaleur douce et crépitante.'], it: ['Stufa a legna', 'Stufa a legna tradizionale dal calore morbido e scoppiettante.'] } },
  { code: 'heater-storage', group: 'heater', name: 'Storage heater', eur: 99000, description: 'A tall tower of stones that holds an even, gentle heat.',
    tr: { de: ['Speicherofen', 'Ein hoher Steinturm, der eine gleichmäßige, sanfte Wärme hält.'], fr: ['Poêle à accumulation', 'Une haute tour de pierres qui garde une chaleur douce et régulière.'], it: ['Stufa ad accumulo', 'Un’alta torre di pietre che mantiene un calore dolce e uniforme.'] } },
  { code: 'control-basic', group: 'control', name: 'Basic control panel', eur: 29000, description: 'Wall panel for temperature and timer.',
    tr: { de: ['Basis-Steuerung', 'Wandbedienteil für Temperatur und Zeitschaltung.'], fr: ['Commande de base', 'Panneau mural pour la température et la minuterie.'], it: ['Centralina base', 'Pannello a parete per temperatura e timer.'] } },
  { code: 'control-wifi', group: 'control', name: 'Wi-Fi control with app', eur: 59000, description: 'Wall panel plus an app to preheat the sauna from anywhere.',
    tr: { de: ['WLAN-Steuerung mit App', 'Wandbedienteil plus App, um die Sauna von überall vorzuheizen.'], fr: ['Commande Wi-Fi avec application', 'Panneau mural et application pour préchauffer le sauna à distance.'], it: ['Centralina Wi-Fi con app', 'Pannello a parete e app per preriscaldare la sauna ovunque.'] } },
  { code: 'door-clear', group: 'door', name: 'Clear glass door', eur: 0, description: 'Clear tempered glass that keeps the cabin open and bright.',
    tr: { de: ['Klarglastür', 'Klares Sicherheitsglas, das die Kabine offen und hell wirken lässt.'], fr: ['Porte en verre clair', 'Verre trempé clair qui garde la cabine ouverte et lumineuse.'], it: ['Porta in vetro trasparente', 'Vetro temperato trasparente che rende la cabina aperta e luminosa.'] } },
  { code: 'door-bronze', group: 'door', name: 'Bronze glass door', eur: 19000, description: 'Bronze-tinted glass for a warmer light and more privacy.',
    tr: { de: ['Bronzeglastür', 'Bronzefarben getöntes Glas für wärmeres Licht und mehr Privatsphäre.'], fr: ['Porte en verre bronze', 'Verre teinté bronze pour une lumière plus chaude et plus d’intimité.'], it: ['Porta in vetro bronzato', 'Vetro bronzato per una luce più calda e più riservatezza.'] } },
  { code: 'door-satin', group: 'door', name: 'Satin glass door', eur: 21000, description: 'Frosted glass: lets the light in, keeps the view out.',
    tr: { de: ['Satinierte Glastür', 'Mattiertes Glas: lässt Licht herein, hält Blicke draußen.'], fr: ['Porte en verre satiné', 'Verre dépoli : laisse passer la lumière, pas les regards.'], it: ['Porta in vetro satinato', 'Vetro satinato: lascia passare la luce, non gli sguardi.'] } },
  { code: 'door-wood', group: 'door', name: 'Solid wood door', eur: 24000, description: 'A solid timber door that holds the heat best.',
    tr: { de: ['Massivholztür', 'Eine Massivholztür, die die Wärme am besten hält.'], fr: ['Porte en bois massif', 'Une porte en bois massif qui retient le mieux la chaleur.'], it: ['Porta in legno massiccio', 'Una porta in legno massiccio che trattiene meglio il calore.'] } },
  { code: 'bench-straight', group: 'bench-layout', name: 'Straight benches', eur: 0, description: 'Upper and lower bench along the back wall.',
    tr: { de: ['Gerade Bänke', 'Obere und untere Bank entlang der Rückwand.'], fr: ['Bancs droits', 'Banc supérieur et inférieur le long de la paroi du fond.'], it: ['Panche dritte', 'Panca superiore e inferiore lungo la parete di fondo.'] } },
  { code: 'bench-l', group: 'bench-layout', name: 'L-shaped benches', eur: 39000, scales: true, description: 'The upper bench turns the corner onto the side wall.',
    tr: { de: ['Bänke in L-Form', 'Die obere Bank führt um die Ecke an die Seitenwand.'], fr: ['Bancs en L', 'Le banc supérieur tourne dans l’angle vers la paroi latérale.'], it: ['Panche a L', 'La panca superiore gira l’angolo sulla parete laterale.'] } },
  { code: 'bench-u', group: 'bench-layout', name: 'U-shaped benches', eur: 69000, scales: true, description: 'Upper benches on three walls; the heater moves to a corner.',
    tr: { de: ['Bänke in U-Form', 'Obere Bänke an drei Wänden; der Ofen rückt in eine Ecke.'], fr: ['Bancs en U', 'Bancs supérieurs sur trois parois ; le poêle passe dans un angle.'], it: ['Panche a U', 'Panche superiori su tre pareti; la stufa si sposta in un angolo.'] } },
  { code: 'bench-aspen', group: 'bench-wood', name: 'Aspen benches', eur: 29000, scales: true, swatch: '#efe3c8', description: 'Pale, splinter-free and cool to sit on.',
    tr: { de: ['Bänke aus Espe', 'Hell, splitterfrei und angenehm kühl zum Sitzen.'], fr: ['Bancs en tremble', 'Pâle, sans échardes et frais à l’assise.'], it: ['Panche in pioppo tremulo', 'Chiaro, senza schegge e fresco da sedere.'] } },
  { code: 'bench-alder', group: 'bench-wood', name: 'Alder benches', eur: 35000, scales: true, swatch: '#c48d5e', description: 'Warm red-brown tone that deepens with use.',
    tr: { de: ['Bänke aus Erle', 'Warmer rotbrauner Ton, der mit der Zeit kräftiger wird.'], fr: ['Bancs en aulne', 'Teinte brun-rouge chaude qui s’intensifie avec l’usage.'], it: ['Panche in ontano', 'Tono bruno-rossiccio caldo che si intensifica con l’uso.'] } },
  { code: 'bench-thermo-aspen', group: 'bench-wood', name: 'Thermo-aspen benches', eur: 49000, scales: true, swatch: '#8a5a3b', description: 'Heat-treated aspen in a deep caramel tone.',
    tr: { de: ['Bänke aus Thermo-Espe', 'Hitzebehandelte Espe in tiefem Karamellton.'], fr: ['Bancs en tremble thermotraité', 'Tremble traité thermiquement, d’un ton caramel profond.'], it: ['Panche in pioppo termotrattato', 'Pioppo tremulo termotrattato dal tono caramello intenso.'] } },
  { code: 'front-boards', group: 'bench-front', name: 'Closed board front', eur: 0, description: 'Horizontal boards close the space under the benches.',
    tr: { de: ['Geschlossene Bretterfront', 'Waagrechte Bretter schließen den Raum unter den Bänken.'], fr: ['Façade en lames fermée', 'Des lames horizontales ferment l’espace sous les bancs.'], it: ['Frontale chiuso a doghe', 'Doghe orizzontali chiudono lo spazio sotto le panche.'] } },
  { code: 'front-framed', group: 'bench-front', name: 'Framed panel front', eur: 19000, description: 'Vertical slats set in a mitred frame.',
    tr: { de: ['Rahmenfront', 'Senkrechte Leisten in einem auf Gehrung gefügten Rahmen.'], fr: ['Façade à cadre', 'Lattes verticales dans un cadre assemblé d’onglet.'], it: ['Frontale con cornice', 'Listelli verticali in una cornice tagliata a 45°.'] } },
  { code: 'front-open', group: 'bench-front', name: 'Open front', eur: 0, description: 'Open frames: lighter look, easier to clean underneath.',
    tr: { de: ['Offene Front', 'Offene Rahmen: leichtere Optik, darunter leichter zu reinigen.'], fr: ['Façade ouverte', 'Cadres ouverts : aspect plus léger, nettoyage facilité dessous.'], it: ['Frontale aperto', 'Telai aperti: aspetto più leggero, pulizia più facile sotto.'] } },
  { code: 'end-waterfall', group: 'bench-end', name: 'Waterfall ends', eur: 14000, description: 'Vertical slats run from the seat to the floor.',
    tr: { de: ['Wasserfall-Abschluss', 'Senkrechte Leisten laufen von der Sitzfläche bis zum Boden.'], fr: ['Extrémités en cascade', 'Des lattes verticales descendent de l’assise jusqu’au sol.'], it: ['Testate a cascata', 'Listelli verticali scendono dalla seduta fino al pavimento.'] } },
  { code: 'end-framed', group: 'bench-end', name: 'Framed ends', eur: 9000, description: 'A framed panel closes each bench end.',
    tr: { de: ['Gerahmter Abschluss', 'Ein gerahmtes Paneel schließt jedes Bankende ab.'], fr: ['Extrémités encadrées', 'Un panneau encadré ferme chaque extrémité de banc.'], it: ['Testate con cornice', 'Un pannello con cornice chiude ogni estremità della panca.'] } },
  { code: 'end-plain', group: 'bench-end', name: 'Plain ends', eur: 0, description: 'A simple board finishes each bench end.',
    tr: { de: ['Einfacher Abschluss', 'Ein schlichtes Brett schließt jedes Bankende ab.'], fr: ['Extrémités simples', 'Une simple planche termine chaque extrémité de banc.'], it: ['Testate semplici', 'Una semplice tavola rifinisce ogni estremità della panca.'] } },
  { code: 'edge-rounded', group: 'bench-edge', name: 'Rounded front edge', eur: 0, description: 'A softly rounded front edge, comfortable behind the knees.',
    tr: { de: ['Abgerundete Vorderkante', 'Sanft gerundete Vorderkante, angenehm in der Kniekehle.'], fr: ['Chant avant arrondi', 'Chant avant légèrement arrondi, confortable sous les genoux.'], it: ['Bordo anteriore arrotondato', 'Bordo anteriore leggermente arrotondato, comodo sotto le ginocchia.'] } },
  { code: 'edge-square', group: 'bench-edge', name: 'Square front edge', eur: 0, description: 'A crisp square front edge for a clean, modern line.',
    tr: { de: ['Gerade Vorderkante', 'Klare, gerade Vorderkante für eine schlichte, moderne Linie.'], fr: ['Chant avant droit', 'Chant avant droit et net pour une ligne sobre et moderne.'], it: ['Bordo anteriore dritto', 'Bordo anteriore dritto e netto per una linea pulita e moderna.'] } },
  { code: 'backrest-continuous', group: 'backrest', name: 'Continuous backrest', eur: 0, description: 'One backrest along the full length of the upper bench.',
    tr: { de: ['Durchgehende Rückenlehne', 'Eine Rückenlehne über die ganze Länge der oberen Bank.'], fr: ['Dossier continu', 'Un dossier sur toute la longueur du banc supérieur.'], it: ['Schienale continuo', 'Uno schienale per tutta la lunghezza della panca superiore.'] } },
  { code: 'backrest-panels', group: 'backrest', name: 'Backrest panels', eur: 18000, description: 'Separate panels with gaps between them.',
    tr: { de: ['Rückenlehnen-Elemente', 'Einzelne Elemente mit Abständen dazwischen.'], fr: ['Dossiers individuels', 'Panneaux séparés espacés les uns des autres.'], it: ['Schienali a pannelli', 'Pannelli separati con spazi tra l’uno e l’altro.'] } },
  { code: 'backrest-none', group: 'backrest', name: 'No backrest', eur: 0, description: 'Bare wall behind the upper bench.',
    tr: { de: ['Ohne Rückenlehne', 'Freie Wand hinter der oberen Bank.'], fr: ['Sans dossier', 'Paroi nue derrière le banc supérieur.'], it: ['Senza schienale', 'Parete libera dietro la panca superiore.'] } },
  { code: 'exterior-wood', group: 'exterior', name: 'Wood cladding', eur: 0, description: 'Natural timber cladding that weathers to silver-grey.',
    tr: { de: ['Holzverkleidung', 'Naturholzverkleidung, die mit der Zeit silbergrau wird.'], fr: ['Bardage bois', 'Bardage en bois naturel qui grisaille en vieillissant.'], it: ['Rivestimento in legno', 'Rivestimento in legno naturale che invecchia in grigio argento.'] } },
  { code: 'exterior-thermo', group: 'exterior', name: 'Thermowood cladding', eur: 89000, scales: true, description: 'Dark heat-treated timber, stable and weather-resistant.',
    tr: { de: ['Thermoholz-Verkleidung', 'Dunkles, hitzebehandeltes Holz, formstabil und wetterfest.'], fr: ['Bardage bois thermotraité', 'Bois sombre traité thermiquement, stable et résistant aux intempéries.'], it: ['Rivestimento in legno termotrattato', 'Legno scuro termotrattato, stabile e resistente alle intemperie.'] } },
  { code: 'exterior-slate', group: 'exterior', name: 'Slate cladding', eur: 149000, scales: true, description: 'Natural slate tiles for a stone look outside.',
    tr: { de: ['Schieferverkleidung', 'Natürliche Schieferplatten für eine Steinoptik außen.'], fr: ['Bardage en ardoise', 'Ardoises naturelles pour un aspect pierre à l’extérieur.'], it: ['Rivestimento in ardesia', 'Lastre di ardesia naturale per un aspetto in pietra all’esterno.'] } },
  { code: 'led-backrest', group: 'lighting', name: 'LED backrest lighting', eur: 24000, description: 'A warm LED strip behind the backrest.',
    tr: { de: ['LED-Rückenlehnenbeleuchtung', 'Warmweißes LED-Band hinter der Rückenlehne.'], fr: ['Éclairage LED du dossier', 'Bande LED chaude derrière le dossier.'], it: ['Illuminazione LED dello schienale', 'Striscia LED calda dietro lo schienale.'] } },
  { code: 'led-underbench', group: 'lighting', name: 'LED under-bench lighting', eur: 21000, description: 'Indirect LED light under the benches.',
    tr: { de: ['LED-Unterbankbeleuchtung', 'Indirektes LED-Licht unter den Bänken.'], fr: ['Éclairage LED sous les bancs', 'Éclairage LED indirect sous les bancs.'], it: ['Illuminazione LED sotto le panche', 'Luce LED indiretta sotto le panche.'] } },
  { code: 'star-ceiling', group: 'lighting', name: 'Starry-sky ceiling', eur: 69000, description: 'Fibre-optic points of light across the ceiling.',
    tr: { de: ['Sternenhimmel', 'Lichtpunkte aus Glasfaser an der ganzen Decke.'], fr: ['Plafond ciel étoilé', 'Points lumineux en fibre optique sur tout le plafond.'], it: ['Cielo stellato', 'Punti luce in fibra ottica su tutto il soffitto.'] } },
  { code: 'ceiling-panel', group: 'lighting', name: 'LED ceiling panel', eur: 26000, description: 'A flat LED panel for even light from above.',
    tr: { de: ['LED-Deckenpaneel', 'Ein flaches LED-Paneel für gleichmäßiges Licht von oben.'], fr: ['Panneau LED au plafond', 'Un panneau LED plat pour une lumière homogène venue d’en haut.'], it: ['Pannello LED a soffitto', 'Un pannello LED piatto per una luce uniforme dall’alto.'] } },
  { code: 'audio', group: 'extras', name: 'Bluetooth audio system', eur: 49000, description: 'Heat-proof Bluetooth speakers; needs the backrest lighting.',
    tr: { de: ['Bluetooth-Audiosystem', 'Hitzefeste Bluetooth-Lautsprecher; setzt die Rückenlehnenbeleuchtung voraus.'], fr: ['Système audio Bluetooth', 'Haut-parleurs Bluetooth résistants à la chaleur ; nécessite l’éclairage du dossier.'], it: ['Impianto audio Bluetooth', 'Altoparlanti Bluetooth resistenti al calore; richiede l’illuminazione dello schienale.'] } },
  { code: 'aroma', group: 'extras', name: 'Aroma dispenser', eur: 18000, description: 'Releases essential oils into the steam.',
    tr: { de: ['Aromaspender', 'Gibt ätherische Öle an den Dampf ab.'], fr: ['Diffuseur d’arômes', 'Diffuse des huiles essentielles dans la vapeur.'], it: ['Diffusore di aromi', 'Rilascia oli essenziali nel vapore.'] } },
  { code: 'bucket-set', group: 'extras', name: 'Bucket and ladle set', eur: 12000, description: 'A wooden bucket and ladle for pouring water on the stones.',
    tr: { de: ['Kübel- und Kellenset', 'Holzkübel und Kelle für den Aufguss auf die Steine.'], fr: ['Seau et louche', 'Seau et louche en bois pour verser l’eau sur les pierres.'], it: ['Set secchio e mestolo', 'Secchio e mestolo in legno per versare l’acqua sulle pietre.'] } },
  { code: 'ir-panel', group: 'extras', name: 'Infrared back panel', eur: 59000, description: 'An infrared panel that warms the back directly.',
    tr: { de: ['Infrarot-Rückenstrahler', 'Infrarotstrahler, der den Rücken direkt wärmt.'], fr: ['Panneau infrarouge dorsal', 'Panneau infrarouge qui réchauffe directement le dos.'], it: ['Pannello infrarosso per la schiena', 'Pannello a infrarossi che scalda direttamente la schiena.'] } },
  { code: 'headrests', group: 'extras', name: 'Headrests', eur: 9000, description: 'Shaped wooden headrests for the upper bench.',
    tr: { de: ['Kopfstützen', 'Geformte Holzkopfstützen für die obere Bank.'], fr: ['Appuie-tête', 'Appuie-tête en bois galbé pour le banc supérieur.'], it: ['Poggiatesta', 'Poggiatesta sagomati in legno per la panca superiore.'] } },
  { code: 'thermometer', group: 'extras', name: 'Thermo-hygrometer', eur: 6000, description: 'Shows temperature and humidity at a glance.',
    tr: { de: ['Thermo-Hygrometer', 'Zeigt Temperatur und Luftfeuchtigkeit auf einen Blick.'], fr: ['Thermo-hygromètre', 'Affiche la température et l’humidité d’un coup d’œil.'], it: ['Termoigrometro', 'Mostra temperatura e umidità a colpo d’occhio.'] } },
  { code: 'salt-wall', group: 'extras', name: 'Himalayan salt wall', eur: 99000, description: 'A backlit wall of Himalayan salt bricks.',
    tr: { de: ['Himalaya-Salzwand', 'Hinterleuchtete Wand aus Himalaya-Salzsteinen.'], fr: ['Mur de sel de l’Himalaya', 'Mur rétroéclairé en briques de sel de l’Himalaya.'], it: ['Parete di sale himalayano', 'Parete retroilluminata in mattoni di sale himalayano.'] } },
  { code: 'stone-floor', group: 'extras', name: 'Stone floor', eur: 49000, scales: true, description: 'Natural stone tiles instead of duckboards on the cabin floor.',
    tr: { de: ['Steinboden', 'Natursteinplatten statt Holzrost auf dem Kabinenboden.'], fr: ['Sol en pierre', 'Dalles en pierre naturelle à la place du caillebotis au sol.'], it: ['Pavimento in pietra', 'Lastre in pietra naturale al posto della pedana in legno sul pavimento.'] } },
  ...sizeOptions(),
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
  /** Construction-kit form for the 3D view (see apps/web/src/three/kit). */
  form: 'box' | 'panorama' | 'corner' | 'glass-corner' | 'barrel' | 'hex' | 'cabin';
  /** `reference`: the parametric renderer in apps/web/src/three/reference (model_source attribute). */
  source?: 'reference';
  /** Groups this model requires although they are optional elsewhere. */
  requires?: string[];
  /** Extra model-specific [option, option] exclusions. */
  excludes?: [string, string][];
}
const MODELS: ModelDef[] = [
  { slug: 'espoo-compact', sku: 'NL-ESP-140', name: 'Espoo Compact', description: 'A two-person indoor sauna that fits where a shower cubicle would, with a full-height glass front.',
    tr: { de: ['Espoo Compact', 'Innensauna für zwei Personen, passt dorthin, wo sonst die Dusche steht, mit raumhoher Glasfront.'], fr: ['Espoo Compact', 'Sauna d’intérieur pour deux personnes, à la place d’une cabine de douche, avec façade entièrement vitrée.'], it: ['Espoo Compact', 'Sauna da interno per due persone, al posto di un box doccia, con vetrata a tutta altezza.'] },
    w: 1400, d: 1200, h: 2000, persons: 2, kw: 4.5, kg: 240, eur: 699000, capBps: 1500, size: 0.8, form: 'box', without: ['heater-9kw', 'salt-wall', 'star-ceiling', 'bench-u', 'end-waterfall', 'end-framed', 'end-plain', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'kelo-barrel', sku: 'NL-KEL-240', name: 'Kelo Barrel', description: 'The classic outdoor barrel: thick pine staves held by stainless bands, warm even in January.',
    tr: { de: ['Kelo Barrel', 'Die klassische Fasssauna: dicke Kieferndauben mit Edelstahlbändern, warm selbst im Januar.'], fr: ['Kelo Barrel', 'Le sauna tonneau classique : douelles de pin épaisses cerclées d’inox, chaud même en janvier.'], it: ['Kelo Barrel', 'La classica sauna a botte: doghe di pino spesse con fasce in acciaio, calda anche a gennaio.'] },
    w: 2000, d: 2400, h: 2050, persons: 6, kw: 9, kg: 780, eur: 949000, capBps: 1200, size: 1.0, form: 'barrel', without: ['bench-straight', 'bench-l', 'bench-u', 'front-boards', 'front-framed', 'front-open', 'end-waterfall', 'end-framed', 'end-plain', 'backrest-continuous', 'backrest-panels', 'backrest-none', 'ir-panel', 'headrests', 'stone-floor', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'fjord-panorama', sku: 'NL-FJD-220', name: 'Fjord Panorama', description: 'Floor-to-ceiling glass on the long side and two bench levels in an L for four or five.',
    tr: { de: ['Fjord Panorama', 'Raumhohe Glasfront an der Längsseite und zwei Bankebenen in L-Form für vier bis fünf Personen.'], fr: ['Fjord Panorama', 'Vitrage du sol au plafond sur le grand côté et deux niveaux de bancs en L pour quatre ou cinq.'], it: ['Fjord Panorama', 'Vetrata a tutta altezza sul lato lungo e due livelli di panche a L per quattro o cinque persone.'] },
    w: 2200, d: 1800, h: 2100, persons: 5, kw: 9, kg: 520, eur: 1499000, capBps: 1000, size: 1.2, form: 'panorama', without: [] },
  { slug: 'lappi-corner', sku: 'NL-LAP-160', name: 'Lappi Corner', description: 'A corner sauna for three with a chamfered glass door that opens on the diagonal.',
    tr: { de: ['Lappi Corner', 'Ecksauna für drei Personen mit abgeschrägter Glastür, die diagonal öffnet.'], fr: ['Lappi Corner', 'Sauna d’angle pour trois personnes avec porte vitrée en biais qui s’ouvre en diagonale.'], it: ['Lappi Corner', 'Sauna angolare per tre persone con porta in vetro smussata che si apre in diagonale.'] },
    w: 1600, d: 1600, h: 2050, persons: 3, kw: 6, kg: 330, eur: 829000, capBps: 2000, size: 0.9, form: 'corner', without: ['heater-wood', 'bench-u', 'salt-wall', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'aurora-hex', sku: 'NL-AUR-240', name: 'Aurora Hex', description: 'A six-sided outdoor pavilion with a lantern roof and a ring of benches for eight.',
    tr: { de: ['Aurora Hex', 'Sechseckiger Außenpavillon mit Laternendach und einem Bankring für acht Personen.'], fr: ['Aurora Hex', 'Pavillon d’extérieur hexagonal avec toit lanterne et bancs en anneau pour huit personnes.'], it: ['Aurora Hex', 'Padiglione esagonale da esterno con tetto a lanterna e panche ad anello per otto persone.'] },
    w: 2400, d: 2100, h: 2600, persons: 8, kw: 9, kg: 1100, eur: 1199000, capBps: 1500, size: 1.1, form: 'hex', without: [] },
  { slug: 'saimaa-garden-house', sku: 'NL-SAI-300', name: 'Saimaa Garden House', description: 'A garden sauna house for six with a covered porch, a changing room and a pitched roof.',
    tr: { de: ['Saimaa Garden House', 'Gartensaunahaus für sechs Personen mit überdachter Veranda, Umkleide und Satteldach.'], fr: ['Saimaa Garden House', 'Maison-sauna de jardin pour six personnes avec porche couvert, vestiaire et toit à deux pans.'], it: ['Saimaa Garden House', 'Casetta sauna da giardino per sei persone con portico coperto, spogliatoio e tetto a due falde.'] },
    w: 3000, d: 2400, h: 2600, persons: 6, kw: 9, kg: 1650, eur: 1899000, capBps: 800, size: 1.4, form: 'cabin', without: ['heater-6kw'] },
  // Parked: the six-sided reference model (REFERENCE_SLUG, renderer in apps/web/src/three/reference) is not seeded; the shop shows seven models.
  { slug: 'kide-glass-corner', sku: 'NL-KID-240', name: 'Kide Glass Corner', description: 'An indoor glass-corner sauna for four: a frameless glass front and side panel, solid knotty pine walls, an L of pale aspen benches with a lit backrest and room for an infrared panel.',
    tr: { de: ['Kide Glass Corner', 'Innensauna mit Glasecke für vier Personen: rahmenlose Glasfront und Seitenscheibe, massive Wände aus astiger Kiefer, L-förmige Bank aus heller Espe mit beleuchteter Rückenlehne und Platz für ein Infrarotpaneel.'],
      fr: ['Kide Glass Corner', 'Sauna d’intérieur à angle vitré pour quatre personnes : façade et panneau latéral en verre sans cadre, parois en pin noueux massif, bancs en L en tremble clair avec dossier éclairé et place pour un panneau infrarouge.'],
      it: ['Kide Glass Corner', 'Sauna da interno con angolo in vetro per quattro persone: vetrata frontale e laterale senza telaio, pareti in pino nodoso massiccio, panche a L in pioppo tremulo chiaro con schienale illuminato e spazio per un pannello a infrarossi.'] },
    w: 2400, d: 2000, h: 2100, persons: 4, kw: 6, kg: 620, eur: 1290000, capBps: 1200, size: 1.2, form: 'glass-corner',
    without: ['spruce', 'red-cedar', 'heater-wood', 'bench-u', 'door-wood', 'salt-wall', 'stone-floor', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
];

const ATTRIBUTES: { code: string; label: string; unit: string | null; tr: Tr; get: (m: ModelDef) => number | string | undefined; text?: boolean }[] = [
  { code: 'width_mm', label: 'Width', unit: 'mm', tr: { de: 'Breite', fr: 'Largeur', it: 'Larghezza' }, get: m => m.w },
  { code: 'depth_mm', label: 'Depth', unit: 'mm', tr: { de: 'Tiefe', fr: 'Profondeur', it: 'Profondità' }, get: m => m.d },
  { code: 'height_mm', label: 'Height', unit: 'mm', tr: { de: 'Höhe', fr: 'Hauteur', it: 'Altezza' }, get: m => m.h },
  { code: 'capacity_persons', label: 'Seats', unit: 'persons', tr: { de: 'Sitzplätze', fr: 'Places', it: 'Posti' }, get: m => m.persons },
  { code: 'heater_kw', label: 'Heater output', unit: 'kW', tr: { de: 'Ofenleistung', fr: 'Puissance du poêle', it: 'Potenza della stufa' }, get: m => m.kw },
  { code: 'weight_kg', label: 'Weight', unit: 'kg', tr: { de: 'Gewicht', fr: 'Poids', it: 'Peso' }, get: m => m.kg },
  { code: 'bench_levels', label: 'Bench levels', unit: null, tr: { de: 'Bankebenen', fr: 'Niveaux de bancs', it: 'Livelli di panche' }, get: m => (m.d < 1600 ? 1 : 2) },
  { code: 'form', label: 'Form', unit: null, tr: { de: 'Bauform', fr: 'Forme', it: 'Forma' }, get: m => m.form },
  // Only parametric models carry it; the others use the construction kit.
  { code: 'model_source', label: '3D model', unit: null, tr: { de: '3D-Modell', fr: 'Modèle 3D', it: 'Modello 3D' }, get: m => m.source, text: true },
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
  branding: { display: string; tagline: string; color: string; email: string; phone: string; legalName: string; legalAddress: string;
    layout: 'atelier' | 'showroom' | 'nordic' | 'catalogue' | 'journal' };
  saunas: { slug: string; visible?: boolean; discount?: Discount }[];
  defaultDiscount?: Discount; rooms: string[]; owner: { key: keyof typeof SEED.staff; email: string; name: string };
}
const RESELLERS: ResellerDef[] = [
  { key: 'alpha', name: 'Alpha Spa & Sauna GmbH', currency: 'EUR', status: 'ACTIVE',
    branding: { display: 'Alpha Spa', tagline: 'Finnish saunas, built for your garden', color: '#1f2a24', email: 'support@alpha.test', phone: '+49 30 1234567', legalName: 'Alpha Spa & Sauna GmbH', legalAddress: 'Gartenstraße 12, 10115 Berlin, Germany', layout: 'atelier' },
    saunas: [
      { slug: 'espoo-compact', discount: { type: 'FIXED', value: 50000 } },
      { slug: 'kelo-barrel', discount: { type: 'PERCENT', value: 800 } },
      { slug: 'fjord-panorama' },
      { slug: 'lappi-corner', visible: false },
      { slug: 'aurora-hex' },
      { slug: 'kide-glass-corner' },
    ],
    defaultDiscount: { type: 'PERCENT', value: 1000 }, rooms: ['garden-deck', 'basement-spa', 'lakeside-terrace'],
    owner: { key: 'alphaOwner', email: 'owner@alpha.test', name: 'Anton Albrecht' } },
  { key: 'beta', name: 'Beta Wellness AG', currency: 'CHF', status: 'ACTIVE',
    branding: { display: 'Beta Wellness', tagline: 'Swiss calm, Nordic heat', color: '#2b2440', email: 'support@beta.test', phone: '+41 44 123 45 67', legalName: 'Beta Wellness AG', legalAddress: 'Seestrasse 5, 8002 Zürich, Switzerland', layout: 'showroom' },
    saunas: [
      { slug: 'espoo-compact' }, { slug: 'fjord-panorama' }, { slug: 'aurora-hex' },
      { slug: 'saimaa-garden-house', discount: { type: 'PERCENT', value: 500 } },
      { slug: 'kide-glass-corner' },
    ],
    rooms: ['garden-deck', 'lakeside-terrace'],
    owner: { key: 'betaOwner', email: 'owner@beta.test', name: 'Beatrice Brunner' } },
  { key: 'gamma', name: 'Gamma Bastu AB', currency: 'SEK', status: 'SUSPENDED',
    branding: { display: 'Gamma Bastu', tagline: 'Bastu för hela familjen', color: '#3a2a1c', email: 'support@gamma.test', phone: '+46 8 123 456 78', legalName: 'Gamma Bastu AB', legalAddress: 'Strandvägen 7, 114 56 Stockholm, Sweden', layout: 'nordic' },
    saunas: [{ slug: 'kelo-barrel' }, { slug: 'lappi-corner' }, { slug: 'aurora-hex' }],
    defaultDiscount: { type: 'FIXED', value: 100000 }, rooms: ['basement-spa'],
    owner: { key: 'gammaOwner', email: 'owner@gamma.test', name: 'Gustav Gran' } },
];

const modelBySlug = new Map(MODELS.map(m => [m.slug, m]));
const optionByCode = new Map(OPTIONS.map(o => [o.code, o]));

function offers(m: ModelDef, code: string): boolean {
  const only = optionByCode.get(code)?.only;
  if (only && !only.includes(m.slug)) return false;
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
    const type = a.text || typeof a.get(MODELS[0]!) === 'string' ? 'TEXT' : 'NUMBER';
    await q(db, `INSERT INTO attribute_definitions (code, label, unit, value_type, sort_order) VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (code) DO NOTHING`, [a.code, a.label, a.unit, type, i]);
    for (const [loc, label] of Object.entries(a.tr)) {
      await q(db, `INSERT INTO attribute_definition_translations (attribute_code, locale, label) VALUES ($1, $2, $3)
                   ON CONFLICT DO NOTHING`, [a.code, loc, label]);
    }
  }

  for (const [i, g] of GROUPS.entries()) {
    await q(db, `INSERT INTO option_groups (id, code, name, description, selection_type, sort_order) VALUES ($1, $2, $3, $4, $5, $6)`,
      [SEED.groups(g.code), g.code, g.name, g.description, g.type, i]);
    for (const [loc, [name, description]] of Object.entries(g.tr)) {
      await q(db, `INSERT INTO option_group_translations (option_group_id, locale, name, description) VALUES ($1, $2, $3, $4)`,
        [SEED.groups(g.code), loc, name, description]);
    }
  }
  for (const [i, o] of OPTIONS.entries()) {
    await q(db, `INSERT INTO options (id, option_group_id, code, name, description, swatch_color, sort_order) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [SEED.options(o.code), SEED.groups(o.group), o.code, o.name, o.description, o.swatch ?? null, i]);
    for (const [loc, [name, description]] of Object.entries(o.tr)) {
      await q(db, `INSERT INTO option_translations (option_id, locale, name, description) VALUES ($1, $2, $3, $4)`,
        [SEED.options(o.code), loc, name, description]);
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
      const v = a.get(m);
      if (v === undefined) continue;
      await q(db, `INSERT INTO sauna_model_attributes (sauna_model_id, attribute_code, value_number, value_text) VALUES ($1, $2, $3, $4)`,
        [id, a.code, typeof v === 'number' ? v : null, typeof v === 'string' ? v : null]);
    }
    for (const cur of CURRENCIES) {
      await q(db, `INSERT INTO sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) VALUES ($1, $2, $3, $4)`,
        [id, cur, convert(m.eur, cur), m.capBps]);
    }
    for (const [gi, g] of GROUPS.entries()) {
      // A group is offered only when the model offers at least one of its options.
      if (!OPTIONS.some(o => o.group === g.code && offers(m, o.code))) continue;
      const required = g.required || (m.requires ?? []).includes(g.code);
      // Sizes lead the cabin step of parametric models.
      const sizeAt = ['width', 'depth', 'height'].indexOf(g.code);
      await q(db, `INSERT INTO sauna_model_option_groups (sauna_model_id, option_group_id, is_required, sort_order) VALUES ($1, $2, $3, $4)`,
        [id, SEED.groups(g.code), required, m.source && sizeAt >= 0 ? sizeAt : m.source ? gi + 3 : gi]);
      const groupOptions = OPTIONS.filter(o => o.group === g.code && offers(m, o.code));
      // A required group's default is its marked option, else its first.
      const fallback = groupOptions.find(o => o.isDefault) ?? groupOptions[0];
      for (const o of groupOptions) {
        await q(db, `INSERT INTO sauna_model_options (sauna_model_id, option_id, option_group_id, is_default) VALUES ($1, $2, $3, $4)`,
          [id, SEED.options(o.code), SEED.groups(g.code), required && o === fallback]);
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
    for (const [a, b] of [...EXCLUDES, ...(m.excludes ?? [])]) {
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

  // Sample assets (URL = '/' + storage_key). Espoo Compact keeps its historical keys; every
  // model, option and room gets a thumbnail too. The files themselves are written into the
  // local object store by scripts/seed-media.mjs (placeholder art, and the Espoo GLBs for
  // every model's 3D roles).
  const espoo = SEED.models('espoo-compact');
  const espooAssets: [string, string, string, string][] = [
    ['MODEL_GLB_HIGH', 'assets/hi/catalog/espoo-compact/high-9f3c2a.glb', 'model/gltf-binary', 'asset:espoo:high'],
    ['MODEL_AR_GLB', 'assets/hi/catalog/espoo-compact/ar-9f3c2a.glb', 'model/gltf-binary', 'asset:espoo:ar'],
    ['MODEL_GLB_LOW', 'assets/lo/catalog/espoo-compact/low-4b1e7d.glb', 'model/gltf-binary', 'asset:espoo:low'],
    ['MODEL_THUMBNAIL', 'media/catalog/espoo-compact/thumb-1a2b3c.webp', 'image/webp', 'asset:espoo:thumb'],
  ];
  const asset = async (key: string, type: string, label: string) => {
    await q(db, `INSERT INTO assets (id, storage_key, content_type) VALUES ($1, $2, $3)`, [seedId(label), key, type]);
    return seedId(label);
  };
  /** Stable short content-hash stand-in, so keys look like the import CLI's. */
  const tag = (label: string) => createHash('sha256').update(label).digest('hex').slice(0, 6);
  for (const [role, key, type, label] of espooAssets) {
    await q(db, `INSERT INTO sauna_model_assets (sauna_model_id, asset_role, asset_id) VALUES ($1, $2, $3)`, [espoo, role, await asset(key, type, label)]);
  }
  for (const m of MODELS) {
    const id = SEED.models(m.slug);
    const roles: [string, number, string, string][] = [
      ['MODEL_GALLERY', 0, `media/catalog/${m.slug}/gallery-1-${tag(`${m.slug}:g1`)}.webp`, 'image/webp'],
      ['MODEL_GALLERY', 1, `media/catalog/${m.slug}/gallery-2-${tag(`${m.slug}:g2`)}.webp`, 'image/webp'],
    ];
    if (m.slug !== 'espoo-compact') {
      roles.push(['MODEL_THUMBNAIL', 0, `media/catalog/${m.slug}/thumb-${tag(`${m.slug}:thumb`)}.webp`, 'image/webp']);
    }
    // Parametric models rebuild in the browser: no fixed GLB or AR file to point at.
    if (m.slug !== 'espoo-compact' && !m.source) {
      roles.push(
        ['MODEL_GLB_LOW', 0, `assets/lo/catalog/${m.slug}/low-${tag(`${m.slug}:low`)}.glb`, 'model/gltf-binary'],
        ['MODEL_GLB_HIGH', 0, `assets/hi/catalog/${m.slug}/high-${tag(`${m.slug}:high`)}.glb`, 'model/gltf-binary'],
        ['MODEL_AR_GLB', 0, `assets/hi/catalog/${m.slug}/ar-${tag(`${m.slug}:ar`)}.glb`, 'model/gltf-binary'],
      );
    }
    for (const [role, position, key, type] of roles) {
      await q(db, `INSERT INTO sauna_model_assets (sauna_model_id, asset_role, position, asset_id) VALUES ($1, $2, $3, $4)`,
        [id, role, position, await asset(key, type, `asset:${m.slug}:${role}:${position}`)]);
    }
  }
  for (const o of OPTIONS) {
    const key = `media/options/${o.code}/thumb-${tag(`option:${o.code}`)}.webp`;
    await q(db, `INSERT INTO option_assets (option_id, asset_role, asset_id) VALUES ($1, 'OPTION_THUMBNAIL', $2)`,
      [SEED.options(o.code), await asset(key, 'image/webp', `asset:option:${o.code}`)]);
  }
  for (const r of ROOMS) {
    const key = `media/rooms/${r.code}/thumb-${tag(`room:${r.code}`)}.webp`;
    await q(db, `INSERT INTO room_scene_assets (room_scene_id, asset_role, asset_id) VALUES ($1, 'ROOM_THUMBNAIL', $2)`,
      [SEED.rooms(r.code), await asset(key, 'image/webp', `asset:room:${r.code}`)]);
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
    await q(db, `INSERT INTO reseller_branding (reseller_id, display_name, tagline, primary_color, support_email, support_phone, legal_name, legal_address, storefront_layout)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [rid, b.display, b.tagline, b.color, b.email, b.phone, b.legalName, b.legalAddress, b.layout]);
    const sid = SEED.staff[r.owner.key];
    await q(db, `INSERT INTO staff_users (id, email, display_name, idp_subject, status) VALUES ($1, $2, $3, $4, 'ACTIVE')`,
      [sid, r.owner.email, r.owner.name, seedId(`idp:${r.owner.email}`)]);
    await q(db, `INSERT INTO reseller_admins (reseller_id, staff_user_id, role) VALUES ($1, $2, 'OWNER')`, [rid, sid]);
    if (r.key === 'alpha') {
      await q(db, `INSERT INTO staff_users (id, email, display_name, idp_subject, status) VALUES ($1, 'admin@alpha.test', 'Alma Arnold', $2, 'ACTIVE')`,
        [SEED.staff.alphaAdmin, seedId('idp:admin@alpha.test')]);
      await q(db, `INSERT INTO reseller_admins (reseller_id, staff_user_id, role) VALUES ($1, $2, 'ADMIN')`, [rid, SEED.staff.alphaAdmin]);
    }

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
    { id: C.annaInReview, reseller: 'alpha', model: 'kelo-barrel', customer: annaAlpha, name: 'Kelo with audio',
      options: ['thermo-aspen', 'heater-9kw', 'control-wifi', 'door-bronze', 'led-backrest', 'audio'],
      room: { code: 'garden-deck', x: 1200, z: -800, rot: 90 }, lock: true },
    { id: C.annaQuoted, reseller: 'alpha', model: 'fjord-panorama', customer: annaAlpha, name: 'Fjord by the lake',
      options: ['red-cedar', 'heater-wood', 'door-wood', 'led-underbench', 'bucket-set'],
      room: { code: 'lakeside-terrace', x: 0, z: 0, rot: 180 }, lock: true },
    { id: C.benSubmitted, reseller: 'alpha', model: 'aurora-hex', customer: benAlpha, name: 'Aurora for the family',
      options: ['aspen', 'heater-9kw', 'door-clear', 'aroma', 'bucket-set'], lock: true },
    { id: C.staffShared, reseller: 'alpha', model: 'espoo-compact', staff: alphaOwner, name: 'Showroom offer: Espoo Compact',
      options: ['spruce', 'heater-6kw', 'control-basic', 'door-bronze'], lock: true },
    { id: C.annaBetaAccepted, reseller: 'beta', model: 'saimaa-garden-house', customer: annaBeta, name: 'Saimaa garden house',
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

/**
 * Reseller option settings (0015): alpha does not sell the salt wall on the Aurora Hex and sells
 * the aroma dispenser there for less. Written after the configurations, which were locked at the
 * manufacturer's prices.
 */
const OPTION_SETTINGS: { reseller: 'alpha' | 'beta'; model: string; option: string; enabled: boolean; priceMinor?: number }[] = [
  { reseller: 'alpha', model: 'aurora-hex', option: 'salt-wall', enabled: false },
  { reseller: 'alpha', model: 'aurora-hex', option: 'aroma', enabled: true, priceMinor: 15000 },
];

async function seedOptionSettings(db: Db): Promise<void> {
  for (const s of OPTION_SETTINGS) {
    await q(db, `INSERT INTO reseller_sauna_options (reseller_id, sauna_model_id, option_id, is_enabled, price_override_minor) VALUES ($1, $2, $3, $4, $5)`,
      [SEED.resellers[s.reseller], SEED.models(s.model), SEED.options(s.option), s.enabled, s.priceMinor ?? null]);
  }
}

async function seedIdpUsers(db: Db): Promise<number> {
  const users: { sub: string; pool: 'CUSTOMER' | 'STAFF'; username: string; email: string; attributes: Record<string, unknown> }[] = [
    ...CUSTOMERS.map(c => ({ sub: c.id, pool: 'CUSTOMER' as const, username: c.id, email: c.email,
      attributes: { resellerId: SEED.resellers[c.reseller], given_name: c.first, family_name: c.last, locale: c.locale } })),
    { sub: seedId('idp:admin@nordlicht.test'), pool: 'STAFF', username: 'admin@nordlicht.test', email: 'admin@nordlicht.test', attributes: { name: 'Nora Lindqvist' } },
    ...RESELLERS.map(r => ({ sub: seedId(`idp:${r.owner.email}`), pool: 'STAFF' as const, username: r.owner.email.toLowerCase(), email: r.owner.email,
      attributes: { name: r.owner.name } })),
    { sub: seedId('idp:admin@alpha.test'), pool: 'STAFF', username: 'admin@alpha.test', email: 'admin@alpha.test', attributes: { name: 'Alma Arnold' } },
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
      await seedOptionSettings(db);
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
