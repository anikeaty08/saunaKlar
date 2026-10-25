/**
 * Apply: one transaction per sauna (and per room) as role catalog_admin. Every write is an
 * idempotent upsert by natural key that only touches rows whose values differ, followed by
 * deletes of model-level rows the manifest no longer lists. Shared entities (option groups,
 * options, attribute definitions, and their translations) are created/updated but never deleted, and reseller assignments
 * are never touched: if a removal conflicts with a reseller, the database rejects the transaction
 * and the error is reported with the reseller slug.
 */
import type { Catalog, DesiredRoom, DesiredSauna } from './catalog.ts';
import type { PlannedAsset } from './plan.ts';
import type { Queryable } from './state.ts';

/** Runs `fn` in one transaction as catalog_admin (see `@saunaklar/db` withTx). */
export type TxRunner = <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;

const nullIfEmpty = (s: string | null | undefined): string | null => (s ? s : null);

async function one<T>(db: Queryable, sql: string, values: unknown[]): Promise<T> {
  const { rows } = await db.query<T>(sql, values);
  if (!rows[0]) throw new Error(`expected a row from: ${sql.split('\n')[0]}`);
  return rows[0];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The manufacturer that owns imported saunas and rooms. catalog_admin cannot read `manufacturers`,
 * so: an explicit `--manufacturer <uuid>` wins; otherwise the owner connection (when available)
 * looks it up by name or picks the only one; otherwise the manufacturer of the existing catalog.
 */
export async function resolveManufacturer(catalogDb: Queryable, owner: Queryable | null, name?: string): Promise<string> {
  if (name && UUID_RE.test(name)) return name;
  if (owner) {
    try {
      const { rows } = await owner.query<{ id: string; name: string }>('SELECT id, name FROM manufacturers ORDER BY name');
      if (name) {
        const m = rows.find((r) => r.name === name);
        if (!m) throw new Error(`manufacturer "${name}" not found (have: ${rows.map((r) => r.name).join(', ') || 'none'})`);
        return m.id;
      }
      if (rows.length === 1) return rows[0]!.id;
      if (rows.length === 0) throw new Error('no manufacturer in the database; run the seed first');
      throw new Error(`several manufacturers exist (${rows.map((r) => r.name).join(', ')}); pass --manufacturer <name or uuid>`);
    } catch (e) {
      if ((e as { code?: string }).code !== '42501') throw e; // not "permission denied": a real answer
    }
  }
  const { rows } = await catalogDb.query<{ manufacturer_id: string }>(
    'SELECT DISTINCT manufacturer_id FROM sauna_models UNION SELECT DISTINCT manufacturer_id FROM room_scenes');
  if (rows.length === 1) return rows[0]!.manufacturer_id;
  throw new Error('cannot determine the manufacturer; pass --manufacturer <uuid>');
}

export async function applyAttributes(db: Queryable, catalog: Catalog): Promise<void> {
  for (const a of catalog.attributes) {
    await db.query(
      `INSERT INTO attribute_definitions AS t (code, label, unit, value_type, sort_order) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, unit = EXCLUDED.unit, value_type = EXCLUDED.value_type, sort_order = EXCLUDED.sort_order
       WHERE (t.label, t.unit, t.value_type, t.sort_order) IS DISTINCT FROM (EXCLUDED.label, EXCLUDED.unit, EXCLUDED.value_type, EXCLUDED.sort_order)`,
      [a.code, a.label, a.unit, a.valueType, a.sortOrder]);
  }
}

async function upsertAssets(db: Queryable, assets: PlannedAsset[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const a of assets) {
    await db.query(
      `INSERT INTO assets (owner_reseller_id, storage_key, content_type, byte_size, sha256) VALUES (NULL, $1, $2, $3, $4)
       ON CONFLICT (storage_key) DO NOTHING`, [a.key, a.contentType, a.byteSize, a.sha256]);
    const r = await one<{ id: string; owner_reseller_id: string | null }>(db, 'SELECT id, owner_reseller_id FROM assets WHERE storage_key = $1', [a.key]);
    if (r.owner_reseller_id !== null) throw new Error(`storage key ${a.key} belongs to a reseller asset`);
    ids.set(a.key, r.id);
  }
  return ids;
}

export async function applySauna(db: Queryable, manufacturerId: string, s: DesiredSauna, assets: PlannedAsset[]): Promise<string> {
  await db.query(
    `INSERT INTO sauna_models AS t (manufacturer_id, sku, slug, status, name, description, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (sku) DO UPDATE SET slug = EXCLUDED.slug, status = EXCLUDED.status, name = EXCLUDED.name,
       description = EXCLUDED.description, sort_order = EXCLUDED.sort_order
     WHERE (t.slug, t.status, t.name, t.description, t.sort_order)
       IS DISTINCT FROM (EXCLUDED.slug, EXCLUDED.status, EXCLUDED.name, EXCLUDED.description, EXCLUDED.sort_order)`,
    [manufacturerId, s.sku, s.slug, s.status, s.name, nullIfEmpty(s.description), s.sortOrder]);
  const { id } = await one<{ id: string }>(db, 'SELECT id FROM sauna_models WHERE sku = $1', [s.sku]);

  // Translations
  const locales = Object.keys(s.translations);
  for (const [locale, t] of Object.entries(s.translations)) {
    await db.query(
      `INSERT INTO sauna_model_translations AS t (sauna_model_id, locale, name, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sauna_model_id, locale) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       WHERE (t.name, t.description) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)`,
      [id, locale, t.name, nullIfEmpty(t.description)]);
  }
  await db.query('DELETE FROM sauna_model_translations WHERE sauna_model_id = $1 AND locale <> ALL($2::text[])', [id, locales]);

  // Attributes
  for (const a of s.attributes) {
    await db.query(
      `INSERT INTO sauna_model_attributes AS t (sauna_model_id, attribute_code, value_number, value_text, value_bool) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sauna_model_id, attribute_code) DO UPDATE SET value_number = EXCLUDED.value_number, value_text = EXCLUDED.value_text, value_bool = EXCLUDED.value_bool
       WHERE (t.value_number, t.value_text, t.value_bool) IS DISTINCT FROM (EXCLUDED.value_number, EXCLUDED.value_text, EXCLUDED.value_bool)`,
      [id, a.code, a.number, a.text, a.bool]);
  }
  await db.query('DELETE FROM sauna_model_attributes WHERE sauna_model_id = $1 AND attribute_code <> ALL($2::text[])', [id, s.attributes.map((a) => a.code)]);

  // Model prices (stale currencies are removed after the option prices below)
  for (const p of s.prices) {
    await db.query(
      `INSERT INTO sauna_model_prices AS t (sauna_model_id, currency_code, list_price_minor, max_discount_bps) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sauna_model_id, currency_code) DO UPDATE SET list_price_minor = EXCLUDED.list_price_minor, max_discount_bps = EXCLUDED.max_discount_bps
       WHERE (t.list_price_minor, t.max_discount_bps) IS DISTINCT FROM (EXCLUDED.list_price_minor, EXCLUDED.max_discount_bps)`,
      [id, p.currency, p.listPriceMinor, p.maxDiscountBps]);
  }

  // Shared option groups / options, then the model's links to them
  const optionIds = new Map<string, { id: string; groupId: string }>();
  const groupIds: string[] = [];
  for (const g of s.groups) {
    await db.query(
      `INSERT INTO option_groups AS t (code, name, selection_type, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, selection_type = EXCLUDED.selection_type
       WHERE (t.name, t.selection_type) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.selection_type)`,
      [g.code, g.name, g.selection, g.sortOrder]);
    const { id: groupId } = await one<{ id: string }>(db, 'SELECT id FROM option_groups WHERE code = $1', [g.code]);
    groupIds.push(groupId);
    for (const [locale, t] of Object.entries(g.translations)) {
      await db.query(
        `INSERT INTO option_group_translations AS t (option_group_id, locale, name) VALUES ($1, $2, $3)
         ON CONFLICT (option_group_id, locale) DO UPDATE SET name = EXCLUDED.name WHERE t.name IS DISTINCT FROM EXCLUDED.name`,
        [groupId, locale, t.name]);
    }

    for (const o of g.options) {
      await db.query(
        `INSERT INTO options AS t (option_group_id, code, name, description, swatch_color, sort_order) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (option_group_id, code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, swatch_color = EXCLUDED.swatch_color
         WHERE (t.name, t.description, t.swatch_color) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description, EXCLUDED.swatch_color)`,
        [groupId, o.code, o.name, nullIfEmpty(o.description), o.swatch, o.sortOrder]);
      const { id: optionId } = await one<{ id: string }>(db, 'SELECT id FROM options WHERE option_group_id = $1 AND code = $2', [groupId, o.code]);
      optionIds.set(o.code, { id: optionId, groupId });
      for (const [locale, t] of Object.entries(o.translations)) {
        await db.query(
          `INSERT INTO option_translations AS t (option_id, locale, name, description) VALUES ($1, $2, $3, $4)
           ON CONFLICT (option_id, locale) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
           WHERE (t.name, t.description) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)`,
          [optionId, locale, t.name, nullIfEmpty(t.description)]);
      }
    }

    await db.query(
      `INSERT INTO sauna_model_option_groups AS t (sauna_model_id, option_group_id, is_required, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sauna_model_id, option_group_id) DO UPDATE SET is_required = EXCLUDED.is_required, sort_order = EXCLUDED.sort_order
       WHERE (t.is_required, t.sort_order) IS DISTINCT FROM (EXCLUDED.is_required, EXCLUDED.sort_order)`,
      [id, groupId, g.isRequired, g.sortOrder]);
  }

  const allOptionIds = [...optionIds.values()].map((o) => o.id);
  const defaultIds = s.groups.flatMap((g) => g.options.filter((o) => o.isDefault).map((o) => optionIds.get(o.code)!.id));

  // Stale rules, option prices, model options and model groups go first, so that a moved default
  // or a removed option never collides with the new rows.
  await db.query('DELETE FROM option_requires WHERE sauna_model_id = $1 AND (option_id <> ALL($2::uuid[]) OR required_option_id <> ALL($2::uuid[]))', [id, allOptionIds]);
  await db.query('DELETE FROM option_excludes WHERE sauna_model_id = $1 AND (option_a_id <> ALL($2::uuid[]) OR option_b_id <> ALL($2::uuid[]))', [id, allOptionIds]);
  await db.query(
    'DELETE FROM sauna_model_option_prices WHERE sauna_model_id = $1 AND (option_id <> ALL($2::uuid[]) OR currency_code <> ALL($3::text[]))',
    [id, allOptionIds, s.prices.map((p) => p.currency)]);
  await db.query('DELETE FROM sauna_model_options WHERE sauna_model_id = $1 AND option_id <> ALL($2::uuid[])', [id, allOptionIds]);
  await db.query('DELETE FROM sauna_model_option_groups WHERE sauna_model_id = $1 AND option_group_id <> ALL($2::uuid[])', [id, groupIds]);
  await db.query('UPDATE sauna_model_options SET is_default = false WHERE sauna_model_id = $1 AND is_default AND option_id <> ALL($2::uuid[])', [id, defaultIds]);

  for (const g of s.groups) {
    for (const o of g.options) {
      const { id: optionId, groupId } = optionIds.get(o.code)!;
      await db.query(
        `INSERT INTO sauna_model_options AS t (sauna_model_id, option_id, option_group_id, is_default) VALUES ($1, $2, $3, $4)
         ON CONFLICT (sauna_model_id, option_id) DO UPDATE SET is_default = EXCLUDED.is_default WHERE t.is_default IS DISTINCT FROM EXCLUDED.is_default`,
        [id, optionId, groupId, o.isDefault]);
    }
  }
  for (const p of s.optionPrices) {
    await db.query(
      `INSERT INTO sauna_model_option_prices AS t (sauna_model_id, option_id, currency_code, price_delta_minor) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sauna_model_id, option_id, currency_code) DO UPDATE SET price_delta_minor = EXCLUDED.price_delta_minor
       WHERE t.price_delta_minor IS DISTINCT FROM EXCLUDED.price_delta_minor`,
      [id, optionIds.get(p.option)!.id, p.currency, p.deltaMinor]);
  }

  // Rules
  const reqPairs = s.requires.map(([a, b]) => [optionIds.get(a)!.id, optionIds.get(b)!.id] as const);
  await db.query(
    `DELETE FROM option_requires r WHERE r.sauna_model_id = $1
       AND NOT EXISTS (SELECT 1 FROM unnest($2::uuid[], $3::uuid[]) AS d(o, q) WHERE d.o = r.option_id AND d.q = r.required_option_id)`,
    [id, reqPairs.map((p) => p[0]), reqPairs.map((p) => p[1])]);
  for (const [a, b] of reqPairs) {
    await db.query('INSERT INTO option_requires (sauna_model_id, option_id, required_option_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, a, b]);
  }
  const exPairs = s.excludes.map(([a, b]) => {
    const x = optionIds.get(a)!.id, y = optionIds.get(b)!.id;
    return x < y ? [x, y] as const : [y, x] as const;
  });
  await db.query(
    `DELETE FROM option_excludes x WHERE x.sauna_model_id = $1
       AND NOT EXISTS (SELECT 1 FROM unnest($2::uuid[], $3::uuid[]) AS d(a, b) WHERE d.a = x.option_a_id AND d.b = x.option_b_id)`,
    [id, exPairs.map((p) => p[0]), exPairs.map((p) => p[1])]);
  for (const [a, b] of exPairs) {
    await db.query('INSERT INTO option_excludes (sauna_model_id, option_a_id, option_b_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [id, a, b]);
  }

  // Stale currencies (after their option prices are gone)
  await db.query('DELETE FROM sauna_model_prices WHERE sauna_model_id = $1 AND currency_code <> ALL($2::text[])', [id, s.prices.map((p) => p.currency)]);

  // Asset links
  const assetIds = await upsertAssets(db, assets);
  for (const a of assets) {
    await db.query(
      `INSERT INTO sauna_model_assets AS t (sauna_model_id, asset_role, position, asset_id) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sauna_model_id, asset_role, position) DO UPDATE SET asset_id = EXCLUDED.asset_id WHERE t.asset_id IS DISTINCT FROM EXCLUDED.asset_id`,
      [id, a.role, a.position, assetIds.get(a.key)]);
  }
  await db.query(
    `DELETE FROM sauna_model_assets x WHERE x.sauna_model_id = $1
       AND NOT EXISTS (SELECT 1 FROM unnest($2::text[], $3::int[]) AS d(r, p) WHERE d.r = x.asset_role AND d.p = x.position)`,
    [id, assets.map((a) => a.role), assets.map((a) => a.position)]);
  return id;
}

export async function applyRoom(db: Queryable, manufacturerId: string, r: DesiredRoom, assets: PlannedAsset[]): Promise<string> {
  await db.query(
    `INSERT INTO room_scenes AS t (manufacturer_id, code, name, description, status, sort_order, preset) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, status = EXCLUDED.status,
       sort_order = EXCLUDED.sort_order, preset = EXCLUDED.preset
     WHERE (t.name, t.description, t.status, t.sort_order, t.preset)
       IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description, EXCLUDED.status, EXCLUDED.sort_order, EXCLUDED.preset)`,
    [manufacturerId, r.code, r.name, nullIfEmpty(r.description), r.status, r.sortOrder, JSON.stringify(r.preset)]);
  const { id } = await one<{ id: string }>(db, 'SELECT id FROM room_scenes WHERE code = $1', [r.code]);
  for (const [locale, t] of Object.entries(r.translations)) {
    await db.query(
      `INSERT INTO room_scene_translations AS t (room_scene_id, locale, name, description) VALUES ($1, $2, $3, $4)
       ON CONFLICT (room_scene_id, locale) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description
       WHERE (t.name, t.description) IS DISTINCT FROM (EXCLUDED.name, EXCLUDED.description)`,
      [id, locale, t.name, nullIfEmpty(t.description)]);
  }
  await db.query('DELETE FROM room_scene_translations WHERE room_scene_id = $1 AND locale <> ALL($2::text[])', [id, Object.keys(r.translations)]);
  const assetIds = await upsertAssets(db, assets);
  for (const a of assets) {
    await db.query(
      `INSERT INTO room_scene_assets AS t (room_scene_id, asset_role, asset_id) VALUES ($1, $2, $3)
       ON CONFLICT (room_scene_id, asset_role) DO UPDATE SET asset_id = EXCLUDED.asset_id WHERE t.asset_id IS DISTINCT FROM EXCLUDED.asset_id`,
      [id, a.role, assetIds.get(a.key)]);
  }
  await db.query('DELETE FROM room_scene_assets WHERE room_scene_id = $1 AND asset_role <> ALL($2::text[])', [id, assets.map((a) => a.role)]);
  return id;
}

export async function bumpCatalogVersions(db: Queryable): Promise<void> {
  await db.query('SELECT bump_all_catalog_versions()');
}

/** Turns a database error into a readable message (trigger messages, FK violations by name). */
export function describeDbError(e: unknown): string {
  const err = e as { message?: string; code?: string; detail?: string; constraint?: string; table?: string; hint?: string };
  const parts = [err.message ?? String(e)];
  if (err.code === '23503' && err.table === 'configuration_selections') {
    parts.push('an option being removed is used by saved customer configurations');
  } else if (err.constraint) parts.push(`constraint ${err.constraint}${err.table ? ` on ${err.table}` : ''}`);
  if (err.detail) parts.push(err.detail);
  if (err.hint) parts.push(err.hint);
  return parts.join(' — ');
}
