/**
 * Reading the current catalog state from the database, keyed by natural keys (codes, SKUs,
 * storage keys) so it can be compared with the manifests.
 */
export interface Queryable {
  query<R = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export interface Translation { name: string; description: string | null }

export interface CurrentSauna {
  id: string;
  sku: string;
  slug: string;
  status: string;
  name: string;
  description: string | null;
  sortOrder: number;
  translations: Map<string, Translation>;
  attributes: Map<string, { number: number | null; text: string | null; bool: boolean | null }>;
  prices: Map<string, { listPriceMinor: number; maxDiscountBps: number }>;
  /** group code → model-level settings */
  groups: Map<string, { id: string; isRequired: boolean; sortOrder: number }>;
  /** option code → model-level settings */
  options: Map<string, { id: string; group: string; isDefault: boolean }>;
  /** `${option}|${currency}` → delta */
  optionPrices: Map<string, number>;
  requires: Set<string>;
  excludes: Set<string>;
  /** `${role}|${position}` → storage key */
  assets: Map<string, string>;
}

export interface SharedGroup { id: string; name: string; selection: string; translations: Map<string, string> }
export interface SharedOption { id: string; name: string; description: string | null; swatch: string | null; translations: Map<string, Translation> }

export interface CurrentRoom {
  id: string;
  code: string;
  name: string;
  description: string | null;
  status: string;
  sortOrder: number;
  preset: unknown;
  translations: Map<string, Translation>;
  assets: Map<string, string>;
}

/** Awaits thunks one after another; keeps the tuple types. */
async function sequential<T extends readonly (() => Promise<unknown>)[]>(fns: T): Promise<{ -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const out: unknown[] = [];
  for (const fn of fns) out.push(await fn());
  return out as { -readonly [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

const num = (v: unknown): number => (typeof v === 'string' ? Number(v) : (v as number));

export async function readSauna(db: Queryable, sku: string): Promise<CurrentSauna | null> {
  const { rows } = await db.query<{ id: string; sku: string; slug: string; status: string; name: string; description: string | null; sort_order: number }>(
    'SELECT id, sku, slug, status, name, description, sort_order FROM sauna_models WHERE sku = $1', [sku]);
  const m = rows[0];
  if (!m) return null;
  const id = m.id;
  // Sequential on purpose: one client cannot run queries concurrently (pg@9 removes queueing).
  const [tr, attrs, prices, groups, options, oprices, req, exc, assets] = await sequential([
    () => db.query<{ locale: string; name: string; description: string | null }>(
      'SELECT locale, name, description FROM sauna_model_translations WHERE sauna_model_id = $1', [id]),
    () => db.query<{ attribute_code: string; value_number: string | null; value_text: string | null; value_bool: boolean | null }>(
      'SELECT attribute_code, value_number, value_text, value_bool FROM sauna_model_attributes WHERE sauna_model_id = $1', [id]),
    () => db.query<{ currency_code: string; list_price_minor: string; max_discount_bps: number }>(
      'SELECT currency_code, list_price_minor, max_discount_bps FROM sauna_model_prices WHERE sauna_model_id = $1', [id]),
    () => db.query<{ id: string; code: string; is_required: boolean; sort_order: number }>(
      `SELECT g.id, g.code, mg.is_required, mg.sort_order FROM sauna_model_option_groups mg
         JOIN option_groups g ON g.id = mg.option_group_id WHERE mg.sauna_model_id = $1`, [id]),
    () => db.query<{ id: string; code: string; group_code: string; is_default: boolean }>(
      `SELECT o.id, o.code, g.code AS group_code, mo.is_default FROM sauna_model_options mo
         JOIN options o ON o.id = mo.option_id JOIN option_groups g ON g.id = mo.option_group_id
        WHERE mo.sauna_model_id = $1`, [id]),
    () => db.query<{ code: string; currency_code: string; price_delta_minor: string }>(
      `SELECT o.code, p.currency_code, p.price_delta_minor FROM sauna_model_option_prices p
         JOIN options o ON o.id = p.option_id WHERE p.sauna_model_id = $1`, [id]),
    () => db.query<{ a: string; b: string }>(
      `SELECT o1.code AS a, o2.code AS b FROM option_requires r
         JOIN options o1 ON o1.id = r.option_id JOIN options o2 ON o2.id = r.required_option_id
        WHERE r.sauna_model_id = $1`, [id]),
    () => db.query<{ a: string; b: string }>(
      `SELECT o1.code AS a, o2.code AS b FROM option_excludes x
         JOIN options o1 ON o1.id = x.option_a_id JOIN options o2 ON o2.id = x.option_b_id
        WHERE x.sauna_model_id = $1`, [id]),
    () => db.query<{ asset_role: string; position: number; storage_key: string }>(
      `SELECT ma.asset_role, ma.position, a.storage_key FROM sauna_model_assets ma
         JOIN assets a ON a.id = ma.asset_id WHERE ma.sauna_model_id = $1`, [id]),
  ] as const);
  return {
    id, sku: m.sku, slug: m.slug, status: m.status, name: m.name, description: m.description, sortOrder: m.sort_order,
    translations: new Map(tr.rows.map((r) => [r.locale, { name: r.name, description: r.description }])),
    attributes: new Map(attrs.rows.map((r) => [r.attribute_code, {
      number: r.value_number === null ? null : Number(r.value_number), text: r.value_text, bool: r.value_bool,
    }])),
    prices: new Map(prices.rows.map((r) => [r.currency_code, { listPriceMinor: num(r.list_price_minor), maxDiscountBps: r.max_discount_bps }])),
    groups: new Map(groups.rows.map((r) => [r.code, { id: r.id, isRequired: r.is_required, sortOrder: r.sort_order }])),
    options: new Map(options.rows.map((r) => [r.code, { id: r.id, group: r.group_code, isDefault: r.is_default }])),
    optionPrices: new Map(oprices.rows.map((r) => [`${r.code}|${r.currency_code}`, num(r.price_delta_minor)])),
    requires: new Set(req.rows.map((r) => `${r.a}|${r.b}`)),
    // Stored with a < b by uuid; normalise to code order like the manifest side.
    excludes: new Set(exc.rows.map((r) => (r.a < r.b ? `${r.a}|${r.b}` : `${r.b}|${r.a}`))),
    assets: new Map(assets.rows.map((r) => [`${r.asset_role}|${r.position}`, r.storage_key])),
  };
}

export async function readSharedGroups(db: Queryable, codes: string[]): Promise<Map<string, SharedGroup>> {
  if (codes.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; code: string; name: string; selection_type: string }>(
    'SELECT id, code, name, selection_type FROM option_groups WHERE code = ANY($1::text[])', [codes]);
  const tr = await db.query<{ code: string; locale: string; name: string }>(
    `SELECT g.code, t.locale, t.name FROM option_group_translations t JOIN option_groups g ON g.id = t.option_group_id
      WHERE g.code = ANY($1::text[])`, [codes]);
  const out = new Map<string, SharedGroup>();
  for (const r of rows) out.set(r.code, { id: r.id, name: r.name, selection: r.selection_type, translations: new Map() });
  for (const t of tr.rows) out.get(t.code)?.translations.set(t.locale, t.name);
  return out;
}

/** Keyed by `${groupCode}/${optionCode}`. */
export async function readSharedOptions(db: Queryable, groupCodes: string[]): Promise<Map<string, SharedOption>> {
  if (groupCodes.length === 0) return new Map();
  const { rows } = await db.query<{ id: string; group_code: string; code: string; name: string; description: string | null; swatch_color: string | null }>(
    `SELECT o.id, g.code AS group_code, o.code, o.name, o.description, o.swatch_color
       FROM options o JOIN option_groups g ON g.id = o.option_group_id WHERE g.code = ANY($1::text[])`, [groupCodes]);
  const tr = await db.query<{ option_id: string; locale: string; name: string; description: string | null }>(
    `SELECT t.option_id, t.locale, t.name, t.description FROM option_translations t
       JOIN options o ON o.id = t.option_id JOIN option_groups g ON g.id = o.option_group_id
      WHERE g.code = ANY($1::text[])`, [groupCodes]);
  const out = new Map<string, SharedOption>();
  const byId = new Map<string, SharedOption>();
  for (const r of rows) {
    const o: SharedOption = { id: r.id, name: r.name, description: r.description, swatch: r.swatch_color, translations: new Map() };
    out.set(`${r.group_code}/${r.code}`, o);
    byId.set(r.id, o);
  }
  for (const t of tr.rows) byId.get(t.option_id)?.translations.set(t.locale, { name: t.name, description: t.description });
  return out;
}

export async function readAttributeDefs(db: Queryable): Promise<Map<string, { label: string; unit: string | null; valueType: string; sortOrder: number }>> {
  const { rows } = await db.query<{ code: string; label: string; unit: string | null; value_type: string; sort_order: number }>(
    'SELECT code, label, unit, value_type, sort_order FROM attribute_definitions');
  return new Map(rows.map((r) => [r.code, { label: r.label, unit: r.unit, valueType: r.value_type, sortOrder: r.sort_order }]));
}

export async function readRoom(db: Queryable, code: string): Promise<CurrentRoom | null> {
  const { rows } = await db.query<{ id: string; code: string; name: string; description: string | null; status: string; sort_order: number; preset: unknown }>(
    'SELECT id, code, name, description, status, sort_order, preset FROM room_scenes WHERE code = $1', [code]);
  const r = rows[0];
  if (!r) return null;
  const tr = await db.query<{ locale: string; name: string; description: string | null }>(
    'SELECT locale, name, description FROM room_scene_translations WHERE room_scene_id = $1', [r.id]);
  const a = await db.query<{ asset_role: string; storage_key: string }>(
    `SELECT ra.asset_role, a.storage_key FROM room_scene_assets ra JOIN assets a ON a.id = ra.asset_id WHERE ra.room_scene_id = $1`, [r.id]);
  return {
    id: r.id, code: r.code, name: r.name, description: r.description, status: r.status, sortOrder: r.sort_order, preset: r.preset,
    translations: new Map(tr.rows.map((t) => [t.locale, { name: t.name, description: t.description }])),
    assets: new Map(a.rows.map((x) => [`${x.asset_role}|0`, x.storage_key])),
  };
}
