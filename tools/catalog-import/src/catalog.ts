/**
 * Loading and validating a catalog directory:
 *
 *   <dir>/attributes.yaml     shared attribute definitions
 *   <dir>/saunas/*.yaml       one `sauna:` per file
 *   <dir>/rooms/*.yaml        one `room:` per file
 *
 * Produces the resolved desired state (minor units, basis points, checked asset files) plus
 * diagnostics. Nothing here touches the database.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, dirname, resolve } from 'node:path';
import { parseDocument } from 'yaml';
import type { z } from 'zod';
import { toMinor, CURRENCY_EXPONENT } from '@saunaklar/pricing';
import { Diagnostics } from './diagnostics.ts';
import {
  attributesFileSchema, roomFileSchema, saunaFileSchema,
  type AttributeDef, type RoomManifest, type SaunaManifest,
} from './schema.ts';
import {
  BUDGETS, IMAGE_BUDGET, ROOM_ASSET_ROLES, SAUNA_ASSET_ROLES, allowedExtensions, checkMagic, extOf,
  formatBytes, GALLERY_ROLE, kindForRole,
} from './files.ts';

export interface Translation { name: string; description: string | null }

export interface AssetSource {
  role: string;
  /** Order within the role (gallery images); 0 for every other role. */
  position: number;
  /** Absolute path of the source file. */
  path: string;
  /** Manifest-relative path as written, for messages. */
  manifestPath: string;
  ext: string;
  byteSize: number;
}

export interface DesiredOption {
  code: string;
  name: string;
  description: string | null;
  swatch: string | null;
  sortOrder: number;
  isDefault: boolean;
  translations: Record<string, Translation>;
}

export interface DesiredGroup {
  code: string;
  name: string;
  selection: 'SINGLE' | 'MULTI';
  isRequired: boolean;
  sortOrder: number;
  translations: Record<string, Translation>;
  options: DesiredOption[];
}

export interface DesiredAttribute { code: string; number: number | null; text: string | null; bool: boolean | null }

export interface DesiredSauna {
  file: string;
  sku: string;
  slug: string;
  status: string;
  name: string;
  description: string;
  sortOrder: number;
  translations: Record<string, Translation>;
  attributes: DesiredAttribute[];
  prices: { currency: string; listPriceMinor: number; maxDiscountBps: number }[];
  groups: DesiredGroup[];
  optionPrices: { option: string; currency: string; deltaMinor: number }[];
  requires: [string, string][];
  excludes: [string, string][];
  assets: AssetSource[];
}

export interface DesiredRoom {
  file: string;
  code: string;
  name: string;
  description: string;
  status: string;
  preset: RoomManifest['preset'];
  assets: AssetSource[];
}

export interface DesiredAttributeDef { code: string; label: string; unit: string | null; valueType: 'NUMBER' | 'TEXT' | 'BOOLEAN'; sortOrder: number }

export interface Catalog {
  dir: string;
  attributes: DesiredAttributeDef[];
  saunas: DesiredSauna[];
  rooms: DesiredRoom[];
}

export interface ValidateOptions { allowOversize?: boolean }

/** "15" → 1500, "12.5" → 1250, "7.25" → 725. More than two decimals or outside 0..100 → null. */
export function percentToBps(s: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

async function listYaml(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((f) => /\.ya?ml$/i.test(f)).sort().map((f) => join(dir, f));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}

async function parseYamlFile<S extends z.ZodType>(abs: string, rel: string, schema: S, diag: Diagnostics): Promise<z.output<S> | null> {
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (e) {
    diag.error(rel, '', `cannot read file: ${(e as Error).message}`);
    return null;
  }
  const doc = parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  if (doc.errors.length > 0) {
    for (const err of doc.errors) diag.error(rel, '', `YAML: ${err.message.split('\n')[0]}`);
    return null;
  }
  const parsed = schema.safeParse(doc.toJS());
  if (!parsed.success) {
    for (const issue of parsed.error.issues) diag.error(rel, issue.path.map(String).join('.'), issue.message);
    return null;
  }
  return parsed.data;
}

async function checkAsset(
  diag: Diagnostics, file: string, manifestDir: string, manifestPath: string, role: string, at: string, opts: ValidateOptions,
  position = 0,
): Promise<AssetSource | null> {
  const path = resolve(manifestDir, manifestPath);
  const ext = extOf(path);
  const kind = kindForRole(role);
  if (!allowedExtensions(kind).includes(ext)) {
    diag.error(file, at, `${manifestPath}: expected ${allowedExtensions(kind).join(' or ')}, got "${ext || 'no extension'}"`);
    return null;
  }
  let bytes: Uint8Array;
  try {
    if (!(await stat(path)).isFile()) throw new Error('not a file');
    bytes = await readFile(path);
  } catch {
    diag.error(file, at, `${manifestPath}: file not found`);
    return null;
  }
  const bad = checkMagic(kind, ext, bytes);
  if (bad) {
    diag.error(file, at, `${manifestPath}: ${bad}`);
    return null;
  }
  const budget = BUDGETS[role];
  if (budget !== undefined && bytes.byteLength > budget) {
    const msg = `${manifestPath} is ${formatBytes(bytes.byteLength)}, budget for ${role} is ${formatBytes(budget)} (design A3)`;
    if (opts.allowOversize) diag.warn(file, at, `${msg}; allowed by --allow-oversize`);
    else diag.error(file, at, `${msg}; optimise it or pass --allow-oversize`);
  } else if (kind === 'image' && bytes.byteLength > IMAGE_BUDGET) {
    diag.warn(file, at, `${manifestPath} is ${formatBytes(bytes.byteLength)}; images above ${formatBytes(IMAGE_BUDGET)} slow down the storefront`);
  }
  return { role, position, path, manifestPath, ext, byteSize: bytes.byteLength };
}

function resolveTranslations(t: Record<string, { name: string; description?: string | undefined }> | undefined): Record<string, Translation> {
  const out: Record<string, Translation> = {};
  for (const [locale, v] of Object.entries(t ?? {})) out[locale] = { name: v.name, description: v.description ?? null };
  return out;
}

/** Rule sanity per sauna. Codes are model-unique (checked before). */
function checkRules(diag: Diagnostics, file: string, s: DesiredSauna, groupOf: Map<string, DesiredGroup>): void {
  const req = new Map<string, Set<string>>();
  for (const [opt, needed] of s.requires) {
    if (!req.has(opt)) req.set(opt, new Set());
    req.get(opt)!.add(needed);
  }
  const excl = new Set(s.excludes.map(([a, b]) => (a < b ? `${a}|${b}` : `${b}|${a}`)));
  const excludes = (a: string, b: string) => excl.has(a < b ? `${a}|${b}` : `${b}|${a}`);

  for (const [opt, needed] of s.requires) {
    if (excludes(opt, needed)) diag.error(file, 'rules', `"${opt}" both requires and excludes "${needed}"`);
    const g1 = groupOf.get(opt);
    const g2 = groupOf.get(needed);
    if (g1 && g2 && g1 === g2 && g1.selection === 'SINGLE') {
      diag.error(file, 'rules.requires', `"${opt}" requires "${needed}" but both are in SINGLE group "${g1.code}", so "${opt}" can never be selected`);
    }
  }

  // Transitive closure of requires: an option is unselectable if its closure contains an excluded
  // pair, an option it excludes itself, or two options of the same SINGLE group.
  const closure = (start: string): Set<string> => {
    const seen = new Set<string>();
    const stack = [start];
    while (stack.length) {
      const cur = stack.pop()!;
      for (const n of req.get(cur) ?? []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    return seen;
  };
  for (const opt of req.keys()) {
    const c = closure(opt);
    if (c.has(opt)) diag.warn(file, 'rules.requires', `requires cycle through "${opt}": these options can only be chosen together`);
    const all = [opt, ...[...c].filter((x) => x !== opt)];
    let reported = false;
    for (let i = 0; i < all.length && !reported; i++) {
      for (let j = i + 1; j < all.length && !reported; j++) {
        const a = all[i]!, b = all[j]!;
        if (excludes(a, b) && !(i === 0 && req.get(opt)?.has(b))) {
          diag.error(file, 'rules', `"${opt}" can never be selected: through its requirements it needs both "${a}" and "${b}", which exclude each other`);
          reported = true;
        }
        const ga = groupOf.get(a), gb = groupOf.get(b);
        if (!reported && i > 0 && ga && ga === gb && ga.selection === 'SINGLE') {
          diag.error(file, 'rules', `"${opt}" can never be selected: it requires both "${a}" and "${b}" from SINGLE group "${ga.code}"`);
          reported = true;
        }
      }
    }
  }

  // Defaults must form a valid selection.
  const defaults = s.groups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => o.code));
  for (let i = 0; i < defaults.length; i++) {
    for (let j = i + 1; j < defaults.length; j++) {
      if (excludes(defaults[i]!, defaults[j]!)) diag.error(file, 'option_groups', `default options "${defaults[i]}" and "${defaults[j]}" exclude each other`);
    }
    for (const n of req.get(defaults[i]!) ?? []) {
      if (!defaults.includes(n)) diag.warn(file, 'option_groups', `default option "${defaults[i]}" requires "${n}", which is not a default`);
    }
  }
}

function resolveSauna(diag: Diagnostics, file: string, m: SaunaManifest, attrDefs: Map<string, AttributeDef>): DesiredSauna {
  const out: DesiredSauna = {
    file, sku: m.sku, slug: m.slug, status: m.status, name: m.name, description: m.description, sortOrder: m.sort,
    translations: resolveTranslations(m.translations),
    attributes: [], prices: [], groups: [], optionPrices: [], requires: [], excludes: [], assets: [],
  };

  for (const [code, value] of Object.entries(m.attributes)) {
    const def = attrDefs.get(code);
    if (!def) {
      diag.error(file, `attributes.${code}`, `unknown attribute "${code}": declare it in attributes.yaml (label, unit, type)`);
      continue;
    }
    const actual = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'text';
    if (actual !== def.type) {
      diag.error(file, `attributes.${code}`, `attribute "${code}" is declared as ${def.type} but the value ${JSON.stringify(value)} is ${actual}`);
      continue;
    }
    out.attributes.push({
      code,
      number: typeof value === 'number' ? value : null,
      text: typeof value === 'string' ? value : null,
      bool: typeof value === 'boolean' ? value : null,
    });
  }

  const currencies = Object.keys(m.prices).sort();
  for (const cur of currencies) {
    const p = m.prices[cur]!;
    if (CURRENCY_EXPONENT[cur] === undefined) {
      diag.error(file, `prices.${cur}`, `unsupported currency ${cur} (supported: ${Object.keys(CURRENCY_EXPONENT).join(', ')})`);
      continue;
    }
    let listPriceMinor: number | null = null;
    try {
      listPriceMinor = toMinor(p.list_price, cur);
    } catch (e) {
      diag.error(file, `prices.${cur}.list_price`, (e as Error).message);
    }
    const bps = percentToBps(p.max_discount_pct);
    if (bps === null) diag.error(file, `prices.${cur}.max_discount_pct`, `"${p.max_discount_pct}" is not a percentage between 0 and 100 with at most 2 decimals`);
    if (listPriceMinor !== null && bps !== null) out.prices.push({ currency: cur, listPriceMinor, maxDiscountBps: bps });
  }

  const groupOf = new Map<string, DesiredGroup>();
  const groupEntries = Object.entries(m.option_groups);
  groupEntries.forEach(([gcode, g], gi) => {
    const group: DesiredGroup = {
      code: gcode, name: g.name, selection: g.selection, isRequired: g.required, sortOrder: g.sort ?? gi,
      translations: resolveTranslations(g.translations), options: [],
    };
    const inGroup = new Set<string>();
    g.options.forEach((o, oi) => {
      const at = `option_groups.${gcode}.options.${oi}`;
      if (inGroup.has(o.code)) {
        diag.error(file, at, `duplicate option code "${o.code}" in group "${gcode}"`);
        return;
      }
      inGroup.add(o.code);
      const other = groupOf.get(o.code);
      if (other) {
        diag.error(file, at, `option code "${o.code}" is used in both "${other.code}" and "${gcode}"; option codes must be unique within a sauna`);
        return;
      }
      groupOf.set(o.code, group);
      group.options.push({
        code: o.code, name: o.name, description: o.description ?? null, swatch: o.swatch ?? null, sortOrder: oi,
        isDefault: o.default, translations: resolveTranslations(o.translations),
      });
    });
    const defaults = group.options.filter((o) => o.isDefault);
    if (g.selection === 'SINGLE' && defaults.length > 1) {
      diag.error(file, `option_groups.${gcode}`, `SINGLE group "${gcode}" has ${defaults.length} defaults (${defaults.map((d) => d.code).join(', ')}); at most one is allowed`);
    }
    if (g.selection === 'SINGLE' && g.required && defaults.length === 0) {
      diag.warn(file, `option_groups.${gcode}`, `required SINGLE group "${gcode}" has no default option`);
    }
    out.groups.push(group);
  });

  // C4: every option needs a price in every currency the model is sold in (0 allowed).
  for (const cur of Object.keys(m.option_prices)) {
    if (!(cur in m.prices)) diag.error(file, `option_prices.${cur}`, `option prices in ${cur}, but the sauna has no list price in ${cur}`);
  }
  for (const cur of currencies) {
    const table = m.option_prices[cur] ?? {};
    for (const code of Object.keys(table)) {
      if (!groupOf.has(code)) diag.error(file, `option_prices.${cur}.${code}`, `price for unknown option "${code}"`);
    }
    for (const code of groupOf.keys()) {
      const raw = table[code];
      if (raw === undefined) {
        diag.error(file, `option_prices.${cur}.${code}`, `option "${code}" has no price in ${cur}; every option needs a price in every currency the sauna is sold in (use "0.00" for no surcharge)`);
        continue;
      }
      if (CURRENCY_EXPONENT[cur] === undefined) continue;
      try {
        out.optionPrices.push({ option: code, currency: cur, deltaMinor: toMinor(raw, cur) });
      } catch (e) {
        diag.error(file, `option_prices.${cur}.${code}`, (e as Error).message);
      }
    }
  }

  const seenReq = new Set<string>();
  m.rules.requires.forEach((r, i) => {
    for (const [opt, needed] of Object.entries(r)) {
      const at = `rules.requires.${i}`;
      if (!groupOf.has(opt)) { diag.error(file, at, `unknown option "${opt}"`); continue; }
      if (!groupOf.has(needed)) { diag.error(file, at, `unknown option "${needed}"`); continue; }
      if (opt === needed) { diag.error(file, at, `"${opt}" cannot require itself`); continue; }
      const k = `${opt}|${needed}`;
      if (seenReq.has(k)) { diag.warn(file, at, `duplicate rule "${opt}" requires "${needed}"`); continue; }
      seenReq.add(k);
      out.requires.push([opt, needed]);
    }
  });
  const seenEx = new Set<string>();
  m.rules.excludes.forEach(([a, b], i) => {
    const at = `rules.excludes.${i}`;
    if (!groupOf.has(a)) { diag.error(file, at, `unknown option "${a}"`); return; }
    if (!groupOf.has(b)) { diag.error(file, at, `unknown option "${b}"`); return; }
    if (a === b) { diag.error(file, at, `"${a}" cannot exclude itself`); return; }
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seenEx.has(k)) { diag.warn(file, at, `duplicate exclusion of "${a}" and "${b}"`); return; }
    if (groupOf.get(a) === groupOf.get(b) && groupOf.get(a)!.selection === 'SINGLE') {
      diag.warn(file, at, `"${a}" and "${b}" are in the same SINGLE group and exclude each other anyway`);
    }
    seenEx.add(k);
    out.excludes.push(a < b ? [a, b] : [b, a]);
  });
  checkRules(diag, file, out, groupOf);
  return out;
}

export async function loadCatalog(dirArg: string, opts: ValidateOptions = {}): Promise<{ catalog: Catalog; diagnostics: Diagnostics }> {
  const dir = resolve(dirArg);
  const diag = new Diagnostics();
  const catalog: Catalog = { dir, attributes: [], saunas: [], rooms: [] };

  const attrDefs = new Map<string, AttributeDef>();
  const attrFile = join(dir, 'attributes.yaml');
  const attrExists = await stat(attrFile).then(() => true, () => false);
  if (attrExists) {
    const parsed = await parseYamlFile(attrFile, 'attributes.yaml', attributesFileSchema, diag);
    for (const [code, def] of Object.entries(parsed?.attributes ?? {})) {
      attrDefs.set(code, def);
      catalog.attributes.push({
        code, label: def.label, unit: def.unit ?? null, sortOrder: def.sort,
        valueType: def.type === 'number' ? 'NUMBER' : def.type === 'boolean' ? 'BOOLEAN' : 'TEXT',
      });
    }
  }

  const saunaFiles = await listYaml(join(dir, 'saunas'));
  const roomFiles = await listYaml(join(dir, 'rooms'));
  if (saunaFiles.length === 0 && roomFiles.length === 0) diag.error('', '', `no manifests found in ${dir}/saunas or ${dir}/rooms`);

  const skus = new Map<string, string>();
  const slugs = new Map<string, string>();
  // Shared catalog entities must be described identically wherever they appear.
  const groupDefs = new Map<string, { file: string; sig: string }>();
  const optionDefs = new Map<string, { file: string; sig: string }>();

  for (const abs of saunaFiles) {
    const rel = relative(dir, abs);
    const parsed = await parseYamlFile(abs, rel, saunaFileSchema, diag);
    if (!parsed) continue;
    const m = parsed.sauna;
    for (const [map, key, label] of [[skus, m.sku, 'sku'], [slugs, m.slug, 'slug']] as const) {
      const prev = map.get(key);
      if (prev) diag.error(rel, label, `${label} "${key}" is also used by ${prev}`);
      else map.set(key, rel);
    }
    const sauna = resolveSauna(diag, rel, m, attrDefs);

    for (const g of sauna.groups) {
      const sig = JSON.stringify([g.name, g.selection, g.translations]);
      const prev = groupDefs.get(g.code);
      if (prev && prev.sig !== sig) diag.error(rel, `option_groups.${g.code}`, `option group "${g.code}" is shared and defined differently in ${prev.file} (name, selection and translations must match)`);
      else if (!prev) groupDefs.set(g.code, { file: rel, sig });
      for (const o of g.options) {
        const osig = JSON.stringify([o.name, o.description, o.swatch, o.translations]);
        const key = `${g.code}/${o.code}`;
        const p = optionDefs.get(key);
        if (p && p.sig !== osig) diag.error(rel, `option_groups.${g.code}`, `option "${key}" is shared and defined differently in ${p.file} (name, description, swatch and translations must match)`);
        else if (!p) optionDefs.set(key, { file: rel, sig: osig });
      }
    }

    const mdir = dirname(abs);
    const a = m.assets;
    for (const [key, role] of Object.entries(SAUNA_ASSET_ROLES)) {
      const p = a[key as keyof typeof SAUNA_ASSET_ROLES];
      if (!p) continue;
      const src = await checkAsset(diag, rel, mdir, p, role, `assets.${key}`, opts);
      if (src) sauna.assets.push(src);
    }
    for (const [i, p] of a.gallery.entries()) {
      const src = await checkAsset(diag, rel, mdir, p, GALLERY_ROLE, `assets.gallery.${i}`, opts, i);
      if (src) sauna.assets.push(src);
    }
    if (m.status === 'ACTIVE' && !a.model_high && !a.model_low) {
      diag.warn(rel, 'assets', 'ACTIVE sauna without a 3D model: the storefront will show a placeholder');
    }
    catalog.saunas.push(sauna);
  }

  const roomCodes = new Map<string, string>();
  for (const abs of roomFiles) {
    const rel = relative(dir, abs);
    const parsed = await parseYamlFile(abs, rel, roomFileSchema, diag);
    if (!parsed) continue;
    const r = parsed.room;
    const prev = roomCodes.get(r.code);
    if (prev) diag.error(rel, 'code', `room code "${r.code}" is also used by ${prev}`);
    roomCodes.set(r.code, rel);
    const room: DesiredRoom = { file: rel, code: r.code, name: r.name, description: r.description, status: r.status, preset: r.preset, assets: [] };
    for (const [key, role] of Object.entries(ROOM_ASSET_ROLES)) {
      const p = r.assets[key as keyof typeof ROOM_ASSET_ROLES];
      if (!p) continue;
      const src = await checkAsset(diag, rel, dirname(abs), p, role, `assets.${key}`, opts);
      if (src) room.assets.push(src);
    }
    catalog.rooms.push(room);
  }

  return { catalog, diagnostics: diag };
}
