/**
 * The construction spec: everything the kit needs to build one sauna. A model
 * contributes its form and size; each selected catalogue option patches the
 * spec. Option codes are matched by meaning, so the platform's seed codes
 * (`led-backrest`, `door-bronze`, …), the demo catalogue codes
 * (`backrest-led`, `bronze`, …) and a manufacturer's own codes that follow the
 * same words all reach the 3D view. Unknown codes are ignored.
 */
export type SaunaForm = 'box' | 'panorama' | 'corner' | 'glass-corner' | 'barrel' | 'hex' | 'cabin';
export type BenchLayout = 'auto' | 'straight' | 'l' | 'u';
export type BenchFront = 'boards' | 'framed' | 'open';
export type BenchEnd = 'waterfall' | 'framed' | 'plain';
export type BenchEdge = 'rounded' | 'square';
export type Backrest = 'continuous' | 'panels' | 'none';
export type Door = 'clear' | 'bronze' | 'satin' | 'timber';
export type Heater = 'electric' | 'electric-large' | 'storage' | 'stove';
export type Exterior = 'wood' | 'slate' | 'thermo';

/** A wood finish: a tint plus the grain family that suits it. */
export interface WoodFinish {
  color: string;
  /** Knotty softwoods (spruce, pine, kelo, Zirbe) or clear woods (aspen, alder, cedar). */
  grain: 'knotty' | 'clear';
}

export interface KitOptions {
  wallWood: WoodFinish;
  benchWood: WoodFinish;
  door: Door;
  heater: Heater;
  control: boolean;
  bench: { layout: BenchLayout; levels: 1 | 2; front: BenchFront; end: BenchEnd; edge: BenchEdge };
  backrest: Backrest;
  exterior: Exterior;
  lights: { backrest: boolean; underBench: boolean; stars: boolean; ceilingPanel: boolean };
  extras: { irPanel: boolean; headrests: boolean; bucket: boolean; thermometer: boolean; saltWall: boolean; aroma: boolean; audio: boolean; stoneFloor: boolean };
}

export interface KitSpec extends KitOptions {
  form: SaunaForm;
  /** Outer size in metres. */
  width: number;
  depth: number;
  height: number;
}

export const DEFAULT_KIT_OPTIONS: KitOptions = {
  wallWood: { color: '#dcc39b', grain: 'knotty' },
  benchWood: { color: '#efe3c8', grain: 'clear' },
  door: 'clear',
  heater: 'electric',
  control: false,
  bench: { layout: 'auto', levels: 2, front: 'boards', end: 'waterfall', edge: 'rounded' },
  backrest: 'continuous',
  exterior: 'wood',
  lights: { backrest: false, underBench: false, stars: false, ceilingPanel: false },
  extras: { irPanel: false, headrests: false, bucket: false, thermometer: false, saltWall: false, aroma: false, audio: false, stoneFloor: false },
};

const CLEAR_WOODS = /aspen|espe|alder|erle|cedar|zeder|abachi|hemlock|poplar|pappel|thermo|linden|linde|ayous/i;
const PALE_BENCH = '#efe3c8';

export function woodFinish(code: string, swatch: string | null | undefined, fallback: WoodFinish): WoodFinish {
  return { color: swatch ?? fallback.color, grain: CLEAR_WOODS.test(code) ? 'clear' : /spruce|fichte|pine|kiefer|kelo|zirbe|arve|knot/i.test(code) ? 'knotty' : fallback.grain };
}

/** The pieces of a catalogue option group the kit reads. */
export interface KitGroup {
  code: string;
  options: { id: string; code: string; swatchColor: string | null }[];
}

const strip = (code: string, ...prefixes: string[]) => {
  let c = code.toLowerCase();
  for (const p of prefixes) if (c.startsWith(`${p}-`)) c = c.slice(p.length + 1);
  return c;
};

/** Selected options → kit options. `benchLevels` comes from the model (1 for small cabins). */
export function kitOptionsOf(groups: readonly KitGroup[], selection: readonly string[], benchLevels: 1 | 2 = 2): KitOptions {
  const sel = new Set(selection);
  const chosen = (...codes: string[]) => groups.filter(g => codes.includes(g.code)).flatMap(g => g.options.filter(o => sel.has(o.id)));
  const has = (...codes: string[]) => groups.some(g => codes.includes(g.code));
  const allChosen = groups.flatMap(g => g.options.filter(o => sel.has(o.id)).map(o => o.code.toLowerCase()));
  const any = (re: RegExp) => allChosen.some(c => re.test(c));
  const o: KitOptions = structuredClone(DEFAULT_KIT_OPTIONS);
  o.bench.levels = benchLevels;

  const wood = chosen('wood', 'wall-wood')[0];
  if (wood) o.wallWood = woodFinish(wood.code, wood.swatchColor, o.wallWood);
  const bench = chosen('bench-wood')[0];
  if (bench) o.benchWood = woodFinish(bench.code, bench.swatchColor, o.benchWood);
  else if (wood && CLEAR_WOODS.test(wood.code)) o.benchWood = { color: wood.swatchColor ?? PALE_BENCH, grain: 'clear' };

  const door = chosen('door')[0];
  if (door) {
    const c = strip(door.code, 'door');
    o.door = /bronze|tint|grey|gray|smoke/.test(c) ? 'bronze' : /satin|frost|matt/.test(c) ? 'satin' : /timber|wood|solid/.test(c) ? 'timber' : 'clear';
  }

  const heater = chosen('heater')[0];
  if (heater) {
    const c = heater.code.toLowerCase();
    const kw = Number(/(\d+(?:\.\d+)?)\s*-?kw|-(\d+)$/.exec(c)?.slice(1).find(Boolean) ?? 0);
    o.heater = /wood|stove|holz/.test(c) ? 'stove' : /storage|tower|speicher/.test(c) ? 'storage' : kw >= 8 ? 'electric-large' : 'electric';
  }
  const control = chosen('control')[0];
  o.control = Boolean(control && !/dial|none|integrated/.test(control.code.toLowerCase()));

  const layout = chosen('bench-layout')[0];
  if (layout) {
    const c = strip(layout.code, 'bench', 'layout');
    o.bench.layout = /\bu\b|u-shape|^u$/.test(c) ? 'u' : /\bl\b|l-shape|^l$|corner/.test(c) ? 'l' : /straight|single|^i$/.test(c) ? 'straight' : 'auto';
  }
  const front = chosen('bench-front')[0];
  if (front) {
    const c = strip(front.code, 'front', 'bench');
    o.bench.front = /frame|mitre|miter/.test(c) ? 'framed' : /open/.test(c) ? 'open' : 'boards';
  }
  const end = chosen('bench-end')[0];
  if (end) {
    const c = strip(end.code, 'end', 'bench');
    o.bench.end = /waterfall|vertical|slat/.test(c) ? 'waterfall' : /frame/.test(c) ? 'framed' : 'plain';
  }
  const edge = chosen('bench-edge')[0];
  if (edge) o.bench.edge = /round|nose|soft/.test(edge.code.toLowerCase()) ? 'rounded' : 'square';
  const backrest = chosen('backrest')[0];
  if (backrest) {
    const c = strip(backrest.code, 'backrest');
    o.backrest = /none|without|no$/.test(c) ? 'none' : /panel|split|segment/.test(c) ? 'panels' : 'continuous';
  } else if (has('extras') && groups.some(g => g.options.some(x => /^backrests?$/i.test(x.code)))) {
    // Catalogues that sell backrests as an extra: no backrest unless chosen.
    o.backrest = any(/^backrests?$/) ? 'continuous' : 'none';
  }
  const exterior = chosen('exterior', 'cladding')[0];
  if (exterior) {
    const c = strip(exterior.code, 'exterior', 'cladding');
    o.exterior = /slate|schiefer|stone/.test(c) ? 'slate' : /thermo|charred|dark|black/.test(c) ? 'thermo' : 'wood';
  }

  o.lights = {
    backrest: any(/backrest-led|led-backrest|backrest-light/),
    underBench: any(/bench-led|led-underbench|under-?bench|led-bench/),
    stars: any(/star|fibre|fiber/),
    ceilingPanel: any(/ceiling-panel|ceiling-light|led-ceiling|light-panel/),
  };
  o.extras = {
    irPanel: any(/^ir-|infra|infrared/),
    headrests: any(/headrest|kopfstütze|kopfstuetze/),
    bucket: any(/bucket|kübel|kuebel|ladle/),
    thermometer: any(/thermo-?hygro|thermometer|hygrometer|climate/),
    saltWall: any(/salt/),
    aroma: any(/aroma/),
    audio: any(/audio|speaker|sound/),
    stoneFloor: any(/stone-floor|pebble/),
  };
  return o;
}
