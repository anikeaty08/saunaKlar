/**
 * Plan: the difference between the manifests and the database, per entity, by natural keys.
 * `apply` performs exactly these changes (as idempotent upserts and deletes), so applying a plan
 * and planning again yields an empty plan.
 */
import { exponentOf } from '@saunaklar/pricing';
import type { Catalog, DesiredRoom, DesiredSauna } from './catalog.ts';
import { CONTENT_TYPES, storageKey } from './files.ts';
import type { PreparedAsset } from './optimise.ts';
import {
  readAttributeDefs, readRoom, readSauna, readSharedGroups, readSharedOptions,
  type CurrentSauna, type Queryable,
} from './state.ts';

export type Op = 'create' | 'update' | 'remove';
export interface Change { op: Op; what: string; detail?: string }

export interface ItemPlan {
  kind: 'attributes' | 'sauna' | 'room';
  key: string;
  file: string;
  isNew: boolean;
  changes: Change[];
  /** Problems found against live data (e.g. a reseller still sells in a currency being removed). */
  blockers: string[];
}

export interface PlannedAsset {
  role: string;
  position: number;
  key: string;
  contentType: string;
  byteSize: number;
  sha256: string;
  /** File to upload. */
  outPath: string;
  manifestPath: string;
}

export interface Plan { items: ItemPlan[] }

export const planIsEmpty = (p: Plan): boolean => p.items.every((i) => i.changes.length === 0);

export function plannedAssets(owner: string, prepared: PreparedAsset[]): PlannedAsset[] {
  return prepared.map((a) => ({
    role: a.role,
    position: a.position,
    key: storageKey(owner, a.role, a.sha256, a.ext),
    contentType: CONTENT_TYPES[a.ext] ?? 'application/octet-stream',
    byteSize: a.outSize,
    sha256: a.sha256,
    outPath: a.outPath,
    manifestPath: a.manifestPath,
  }));
}

/** Owner prefix for room assets inside the catalog namespace. */
export const roomOwner = (code: string): string => `rooms/${code}`;

const nullIfEmpty = (s: string | null | undefined): string | null => (s === undefined || s === null || s === '' ? null : s);
const money = (minor: number, cur: string): string => `${cur} ${(minor / 10 ** exponentOf(cur)).toFixed(exponentOf(cur))}`;
const pct = (bps: number): string => `${(bps / 100).toString()}%`;

function diffMap<V>(
  changes: Change[], what: string, desired: Map<string, V>, current: Map<string, V> | null | undefined,
  eq: (a: V, b: V) => boolean, show: (v: V) => string,
): void {
  for (const [k, v] of desired) {
    const c = current?.get(k);
    if (c === undefined) changes.push({ op: 'create', what: `${what} ${k}`, detail: show(v) });
    else if (!eq(v, c)) changes.push({ op: 'update', what: `${what} ${k}`, detail: `${show(c)} → ${show(v)}` });
  }
  for (const [k, c] of current ?? []) {
    if (!desired.has(k)) changes.push({ op: 'remove', what: `${what} ${k}`, detail: show(c) });
  }
}

function diffSet(changes: Change[], what: string, desired: Set<string>, current: Set<string> | null | undefined, show: (k: string) => string): void {
  for (const k of desired) if (!current?.has(k)) changes.push({ op: 'create', what: `${what} ${show(k)}` });
  for (const k of current ?? []) if (!desired.has(k)) changes.push({ op: 'remove', what: `${what} ${show(k)}` });
}

async function lookupBlockers(owner: Queryable | null, cur: CurrentSauna, removedCurrencies: string[], removedOptions: string[]): Promise<string[]> {
  if (!owner) return [];
  const out: string[] = [];
  try {
    if (removedCurrencies.length > 0) {
      const { rows } = await owner.query<{ slug: string; currency_code: string }>(
        `SELECT r.slug, r.currency_code FROM reseller_saunas rs JOIN resellers r ON r.id = rs.reseller_id
          WHERE rs.sauna_model_id = $1 AND r.currency_code = ANY($2::text[]) ORDER BY r.slug`, [cur.id, removedCurrencies]);
      for (const r of rows) {
        out.push(`reseller "${r.slug}" sells ${cur.sku} in ${r.currency_code}; keep the ${r.currency_code} price or unassign the sauna from "${r.slug}" first`);
      }
    }
    const ids = removedOptions.map((c) => cur.options.get(c)?.id).filter((x): x is string => !!x);
    if (ids.length > 0) {
      const { rows } = await owner.query<{ code: string; slug: string; n: string }>(
        `SELECT o.code, r.slug, count(*) AS n FROM configuration_selections cs
           JOIN options o ON o.id = cs.option_id JOIN configurations c ON c.id = cs.configuration_id
           JOIN resellers r ON r.id = c.reseller_id
          WHERE cs.sauna_model_id = $1 AND cs.option_id = ANY($2::uuid[]) GROUP BY o.code, r.slug ORDER BY o.code, r.slug`, [cur.id, ids]);
      for (const r of rows) out.push(`option "${r.code}" is used by ${r.n} saved configuration(s) of reseller "${r.slug}"`);
    }
  } catch {
    // The connection may lack access to tenant tables (production catalog_admin login): the DB
    // triggers and foreign keys still reject the change, and apply reports that error.
  }
  return out;
}

export async function planSauna(db: Queryable, owner: Queryable | null, s: DesiredSauna, assets: PlannedAsset[]): Promise<ItemPlan> {
  const cur = await readSauna(db, s.sku);
  const changes: Change[] = [];
  const item: ItemPlan = { kind: 'sauna', key: s.sku, file: s.file, isNew: !cur, changes, blockers: [] };

  if (!cur) {
    const bySlug = await db.query<{ sku: string }>('SELECT sku FROM sauna_models WHERE slug = $1', [s.slug]);
    if (bySlug.rows[0]) item.blockers.push(`slug "${s.slug}" belongs to sauna ${bySlug.rows[0].sku}`);
    changes.push({ op: 'create', what: `sauna ${s.sku}`, detail: `${s.name} (${s.slug}, ${s.status})` });
  } else {
    const fields: string[] = [];
    if (cur.slug !== s.slug) fields.push(`slug ${cur.slug} → ${s.slug}`);
    if (cur.status !== s.status) fields.push(`status ${cur.status} → ${s.status}`);
    if (cur.name !== s.name) fields.push(`name "${cur.name}" → "${s.name}"`);
    if (nullIfEmpty(cur.description) !== nullIfEmpty(s.description)) fields.push('description');
    if (cur.sortOrder !== s.sortOrder) fields.push(`sort ${cur.sortOrder} → ${s.sortOrder}`);
    if (fields.length) changes.push({ op: 'update', what: `sauna ${s.sku}`, detail: fields.join(', ') });
  }

  diffMap(changes, 'translation', new Map(Object.entries(s.translations)), cur?.translations,
    (a, b) => a.name === b.name && nullIfEmpty(a.description) === nullIfEmpty(b.description), (v) => `"${v.name}"`);
  diffMap(changes, 'attribute', new Map(s.attributes.map((a) => [a.code, { number: a.number, text: a.text, bool: a.bool }])), cur?.attributes,
    (a, b) => a.number === b.number && a.text === b.text && a.bool === b.bool, (v) => String(v.number ?? v.text ?? v.bool));
  diffMap(changes, 'price', new Map(s.prices.map((p) => [p.currency, { ...p }])),
    cur && new Map([...cur.prices].map(([c, v]) => [c, { currency: c, ...v }])),
    (a, b) => a.listPriceMinor === b.listPriceMinor && a.maxDiscountBps === b.maxDiscountBps,
    (v) => `${money(v.listPriceMinor, v.currency)}, max discount ${pct(v.maxDiscountBps)}`);

  // Shared option groups and options (catalog-wide, keyed by code).
  const groupCodes = s.groups.map((g) => g.code);
  const sharedGroups = await readSharedGroups(db, groupCodes);
  const sharedOptions = await readSharedOptions(db, groupCodes);
  for (const g of s.groups) {
    const sg = sharedGroups.get(g.code);
    const tr = new Map(Object.entries(g.translations).map(([l, t]) => [l, t.name]));
    if (!sg) changes.push({ op: 'create', what: `option group ${g.code}`, detail: `${g.name} (${g.selection}, shared)` });
    else {
      const f: string[] = [];
      if (sg.name !== g.name) f.push(`name "${sg.name}" → "${g.name}"`);
      if (sg.selection !== g.selection) f.push(`selection ${sg.selection} → ${g.selection}`);
      if (f.length) changes.push({ op: 'update', what: `option group ${g.code}`, detail: `${f.join(', ')} (shared)` });
    }
    diffMap(changes, `option group ${g.code} translation`, tr, sg?.translations, (a, b) => a === b, (v) => `"${v}"`);
    for (const o of g.options) {
      const so = sharedOptions.get(`${g.code}/${o.code}`);
      if (!so) changes.push({ op: 'create', what: `option ${g.code}/${o.code}`, detail: `${o.name} (shared)` });
      else {
        const f: string[] = [];
        if (so.name !== o.name) f.push(`name "${so.name}" → "${o.name}"`);
        if (nullIfEmpty(so.description) !== nullIfEmpty(o.description)) f.push('description');
        if (so.swatch !== o.swatch) f.push(`swatch ${so.swatch ?? '-'} → ${o.swatch ?? '-'}`);
        if (f.length) changes.push({ op: 'update', what: `option ${g.code}/${o.code}`, detail: `${f.join(', ')} (shared)` });
      }
      diffMap(changes, `option ${g.code}/${o.code} translation`, new Map(Object.entries(o.translations)), so?.translations,
        (a, b) => a.name === b.name && nullIfEmpty(a.description) === nullIfEmpty(b.description), (v) => `"${v.name}"`);
    }
  }

  // Model-level links.
  diffMap(changes, 'model option group', new Map(s.groups.map((g) => [g.code, { isRequired: g.isRequired, sortOrder: g.sortOrder }])),
    cur && new Map([...cur.groups].map(([k, v]) => [k, { isRequired: v.isRequired, sortOrder: v.sortOrder }])),
    (a, b) => a.isRequired === b.isRequired && a.sortOrder === b.sortOrder,
    (v) => `${v.isRequired ? 'required' : 'optional'}, sort ${v.sortOrder}`);
  const desiredOptions = new Map(s.groups.flatMap((g) => g.options.map((o) => [o.code, { group: g.code, isDefault: o.isDefault }] as const)));
  diffMap(changes, 'model option', desiredOptions,
    cur && new Map([...cur.options].map(([k, v]) => [k, { group: v.group, isDefault: v.isDefault }])),
    (a, b) => a.group === b.group && a.isDefault === b.isDefault, (v) => `${v.group}${v.isDefault ? ', default' : ''}`);
  diffMap(changes, 'option price', new Map(s.optionPrices.map((p) => [`${p.option} ${p.currency}`, { m: p.deltaMinor, c: p.currency }])),
    cur && new Map([...cur.optionPrices].map(([k, v]) => { const [o, c] = k.split('|') as [string, string]; return [`${o} ${c}`, { m: v, c }]; })),
    (a, b) => a.m === b.m, (v) => money(v.m, v.c));
  diffSet(changes, 'rule requires', new Set(s.requires.map(([a, b]) => `${a}|${b}`)), cur?.requires, (k) => k.replace('|', ' → '));
  diffSet(changes, 'rule excludes', new Set(s.excludes.map(([a, b]) => `${a}|${b}`)), cur?.excludes, (k) => k.replace('|', ' ⊥ '));
  diffMap(changes, 'asset', new Map(assets.map((a) => [`${a.role}|${a.position}`, a.key])), cur?.assets,
    (a, b) => a === b, (v) => v);
  for (const c of changes) if (c.what.startsWith('asset ')) c.what = c.what.replace(/\|0$/, '').replace('|', ' #');

  if (cur) {
    const removedCurrencies = [...cur.prices.keys()].filter((c) => !s.prices.some((p) => p.currency === c));
    const removedOptions = [...cur.options.keys()].filter((c) => !desiredOptions.has(c));
    item.blockers.push(...await lookupBlockers(owner, cur, removedCurrencies, removedOptions));
  }
  return item;
}

export async function planRoom(db: Queryable, r: DesiredRoom, assets: PlannedAsset[]): Promise<ItemPlan> {
  const cur = await readRoom(db, r.code);
  const changes: Change[] = [];
  if (!cur) changes.push({ op: 'create', what: `room ${r.code}`, detail: `${r.name} (${r.status})` });
  else {
    const f: string[] = [];
    if (cur.name !== r.name) f.push(`name "${cur.name}" → "${r.name}"`);
    if (nullIfEmpty(cur.description) !== nullIfEmpty(r.description)) f.push('description');
    if (cur.status !== r.status) f.push(`status ${cur.status} → ${r.status}`);
    if (JSON.stringify(sortKeys(cur.preset)) !== JSON.stringify(sortKeys(r.preset))) f.push('preset');
    if (f.length) changes.push({ op: 'update', what: `room ${r.code}`, detail: f.join(', ') });
  }
  diffMap(changes, 'asset', new Map(assets.map((a) => [`${a.role}|0`, a.key])), cur?.assets, (a, b) => a === b, (v) => v);
  for (const c of changes) if (c.what.startsWith('asset ')) c.what = c.what.replace(/\|0$/, '');
  return { kind: 'room', key: r.code, file: r.file, isNew: !cur, changes, blockers: [] };
}

export function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]));
  return v;
}

export async function planAttributes(db: Queryable, catalog: Catalog): Promise<ItemPlan> {
  const cur = await readAttributeDefs(db);
  const changes: Change[] = [];
  for (const a of catalog.attributes) {
    const c = cur.get(a.code);
    if (!c) changes.push({ op: 'create', what: `attribute ${a.code}`, detail: `${a.label}${a.unit ? ` [${a.unit}]` : ''}, ${a.valueType}` });
    else if (c.label !== a.label || c.unit !== a.unit || c.valueType !== a.valueType || c.sortOrder !== a.sortOrder) {
      changes.push({ op: 'update', what: `attribute ${a.code}`, detail: `${c.label} → ${a.label}` });
    }
  }
  // Attribute definitions are shared and never removed by the importer (other saunas may use them).
  return { kind: 'attributes', key: 'attributes.yaml', file: 'attributes.yaml', isNew: false, changes, blockers: [] };
}
