import { calculatePrice, type Discount } from '@saunaklar/pricing';
import type { ModelRules } from '@saunaklar/rules';
import type { AppLocale, Attribute, CatalogItem, OptionGroupDto, Room, SaunaDetail } from '@saunaklar/shared';
import type { Db, TenantInfo } from '../context.ts';

/**
 * Catalog reads for one tenant, run inside a tenant transaction (RLS already
 * limits rows to the current reseller). All prices are in the reseller's
 * currency; names fall back from the requested locale to the base text.
 */

export const assetUrl = (storageKey: string | null | undefined): string | null => (storageKey ? `/${storageKey}` : null);

const num = (v: string | number | null): number => (v === null ? 0 : Number(v));

function discountOf(type: string | null, value: string | number | null): Discount | null {
  return type ? { type: type as Discount['type'], value: num(value) } : null;
}

interface ModelRow {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_visible: boolean;
  list_price_minor: string;
  max_discount_bps: number;
  sauna_type: string | null;
  sauna_value: string | null;
  default_type: string | null;
  default_value: string | null;
}

const MODEL_SQL = `
  select m.id, m.slug, m.sku,
         coalesce(t.name, m.name) as name,
         coalesce(t.description, m.description) as description,
         rs.sort_order, rs.is_visible,
         p.list_price_minor, p.max_discount_bps,
         d.discount_type as sauna_type, d.discount_value as sauna_value,
         dd.discount_type as default_type, dd.discount_value as default_value
    from reseller_saunas rs
    join sauna_models m on m.id = rs.sauna_model_id and m.status = 'ACTIVE'
    join sauna_model_prices p on p.sauna_model_id = m.id and p.currency_code = $2
    left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $3
    left join reseller_sauna_discounts d on d.reseller_id = rs.reseller_id and d.sauna_model_id = m.id
    left join reseller_default_discounts dd on dd.reseller_id = rs.reseller_id
   where rs.reseller_id = $1`;

async function loadAttributes(db: Db, modelIds: string[], locale: AppLocale): Promise<Map<string, Attribute[]>> {
  const out = new Map<string, Attribute[]>();
  if (!modelIds.length) return out;
  const { rows } = await db.query<{ sauna_model_id: string; code: string; label: string; unit: string | null; value_type: string; value_number: string | null; value_text: string | null; value_bool: boolean | null }>(
    `select a.sauna_model_id, d.code, coalesce(t.label, d.label) as label, d.unit, d.value_type,
            a.value_number, a.value_text, a.value_bool
       from sauna_model_attributes a
       join attribute_definitions d on d.code = a.attribute_code
       left join attribute_definition_translations t on t.attribute_code = d.code and t.locale = $2
      where a.sauna_model_id = any($1::uuid[])
      order by d.sort_order, d.code`,
    [modelIds, locale]);
  for (const r of rows) {
    const value = r.value_type === 'NUMBER' ? Number(r.value_number) : r.value_type === 'BOOLEAN' ? Boolean(r.value_bool) : (r.value_text ?? '');
    const list = out.get(r.sauna_model_id) ?? [];
    list.push({ code: r.code, label: r.label, unit: r.unit, value });
    out.set(r.sauna_model_id, list);
  }
  return out;
}

type AssetMap = Map<string, { role: string; key: string; position: number }[]>;

async function loadModelAssets(db: Db, modelIds: string[]): Promise<AssetMap> {
  const out: AssetMap = new Map();
  if (!modelIds.length) return out;
  const { rows } = await db.query<{ sauna_model_id: string; asset_role: string; storage_key: string; position: number }>(
    `select sma.sauna_model_id, sma.asset_role, a.storage_key, sma.position
       from sauna_model_assets sma join assets a on a.id = sma.asset_id
      where sma.sauna_model_id = any($1::uuid[])
      order by sma.position`,
    [modelIds]);
  for (const r of rows) {
    const list = out.get(r.sauna_model_id) ?? [];
    list.push({ role: r.asset_role, key: r.storage_key, position: r.position });
    out.set(r.sauna_model_id, list);
  }
  return out;
}

function assetsDto(list: { role: string; key: string }[] = []): CatalogItem['assets'] {
  const first = (role: string) => assetUrl(list.find(a => a.role === role)?.key);
  return {
    thumbnailUrl: first('MODEL_THUMBNAIL'),
    gallery: list.filter(a => a.role === 'MODEL_GALLERY').map(a => assetUrl(a.key)!),
    lowGlbUrl: first('MODEL_GLB_LOW'),
    highGlbUrl: first('MODEL_GLB_HIGH'),
    hasAr: list.some(a => a.role === 'MODEL_AR_GLB' || a.role === 'MODEL_AR_USDZ'),
  };
}

function itemOf(row: ModelRow, attributes: Attribute[], assets: CatalogItem['assets']): CatalogItem {
  const perSauna = discountOf(row.sauna_type, row.sauna_value);
  const price = calculatePrice({
    listPriceMinor: num(row.list_price_minor),
    maxDiscountBps: row.max_discount_bps,
    options: [],
    perSaunaDiscount: perSauna,
    defaultDiscount: discountOf(row.default_type, row.default_value),
  });
  return {
    id: row.id,
    slug: row.slug,
    sku: row.sku,
    name: row.name,
    description: row.description,
    attributes,
    assets,
    listPriceMinor: price.listPriceMinor,
    priceFromMinor: price.finalPriceMinor,
    discount: price.discountType ? { type: price.discountType, value: price.discountValue! } : null,
    sortOrder: row.sort_order,
  };
}

export async function listCatalog(db: Db, tenant: TenantInfo, locale: AppLocale): Promise<CatalogItem[]> {
  const { rows } = await db.query<ModelRow>(`${MODEL_SQL} and rs.is_visible order by rs.sort_order, name`, [tenant.id, tenant.currency, locale]);
  const ids = rows.map(r => r.id);
  const [attrs, assets] = await Promise.all([loadAttributes(db, ids, locale), loadModelAssets(db, ids)]);
  return rows.map(r => itemOf(r, attrs.get(r.id) ?? [], assetsDto(assets.get(r.id))));
}

export interface ModelPricing {
  listPriceMinor: number;
  maxDiscountBps: number;
  perSaunaDiscount: Discount | null;
  defaultDiscount: Discount | null;
  optionPrices: Map<string, number>;
}

export interface LoadedModel {
  detail: SaunaDetail;
  rules: ModelRules;
  pricing: ModelPricing;
  isVisible: boolean;
}

/**
 * Full model for the configurator: groups, options with prices in the
 * reseller currency, rules, and the pricing inputs. `includeHidden` lets
 * staff and existing configurations load a model the reseller has hidden.
 */
export async function loadModel(db: Db, tenant: TenantInfo, locale: AppLocale, by: { slug: string } | { id: string }, includeHidden = false): Promise<LoadedModel | null> {
  const filter = 'slug' in by ? 'and m.slug = $4' : 'and m.id = $4';
  const { rows } = await db.query<ModelRow>(`${MODEL_SQL} ${filter}`, [tenant.id, tenant.currency, locale, 'slug' in by ? by.slug : by.id]);
  const row = rows[0];
  if (!row || (!row.is_visible && !includeHidden)) return null;

  const [attrs, assets, groups, rules] = await Promise.all([
    loadAttributes(db, [row.id], locale),
    loadModelAssets(db, [row.id]),
    db.query<{ group_id: string; group_code: string; group_name: string; selection_type: 'SINGLE' | 'MULTI'; is_required: boolean; option_id: string; option_code: string; option_name: string; option_description: string | null; swatch_color: string | null; is_default: boolean; price_delta_minor: string | null; thumb_key: string | null; glb_key: string | null }>(
      `select g.id as group_id, g.code as group_code, coalesce(gt.name, g.name) as group_name, g.selection_type, smg.is_required,
              o.id as option_id, o.code as option_code, coalesce(ot.name, o.name) as option_name,
              coalesce(ot.description, o.description) as option_description, o.swatch_color, smo.is_default,
              op.price_delta_minor,
              (select a.storage_key from option_assets oa join assets a on a.id = oa.asset_id where oa.option_id = o.id and oa.asset_role = 'OPTION_THUMBNAIL') as thumb_key,
              (select a.storage_key from option_assets oa join assets a on a.id = oa.asset_id where oa.option_id = o.id and oa.asset_role = 'OPTION_GLB') as glb_key
         from sauna_model_option_groups smg
         join option_groups g on g.id = smg.option_group_id
         left join option_group_translations gt on gt.option_group_id = g.id and gt.locale = $3
         join sauna_model_options smo on smo.sauna_model_id = smg.sauna_model_id and smo.option_group_id = g.id
         join options o on o.id = smo.option_id
         left join option_translations ot on ot.option_id = o.id and ot.locale = $3
         left join sauna_model_option_prices op on op.sauna_model_id = smo.sauna_model_id and op.option_id = o.id and op.currency_code = $2
        where smg.sauna_model_id = $1
        order by smg.sort_order, g.sort_order, g.code, o.sort_order, o.code`,
      [row.id, tenant.currency, locale]),
    Promise.all([
      db.query<{ option_id: string; required_option_id: string }>('select option_id, required_option_id from option_requires where sauna_model_id = $1', [row.id]),
      db.query<{ option_a_id: string; option_b_id: string }>('select option_a_id, option_b_id from option_excludes where sauna_model_id = $1', [row.id]),
    ]),
  ]);

  const groupMap = new Map<string, OptionGroupDto>();
  const optionPrices = new Map<string, number>();
  for (const g of groups.rows) {
    let group = groupMap.get(g.group_id);
    if (!group) {
      group = { id: g.group_id, code: g.group_code, name: g.group_name, selectionType: g.selection_type, required: g.is_required, options: [] };
      groupMap.set(g.group_id, group);
    }
    // The assignment trigger guarantees a price per currency (review C4); a
    // missing one would be a data bug, so it is surfaced rather than priced at 0.
    if (g.price_delta_minor === null) throw new Error(`option ${g.option_code} of model ${row.slug} has no ${tenant.currency} price`);
    const delta = num(g.price_delta_minor);
    optionPrices.set(g.option_id, delta);
    group.options.push({
      id: g.option_id,
      code: g.option_code,
      name: g.option_name,
      description: g.option_description,
      swatchColor: g.swatch_color?.trim() ?? null,
      thumbnailUrl: assetUrl(g.thumb_key),
      glbUrl: assetUrl(g.glb_key),
      priceDeltaMinor: delta,
      isDefault: g.is_default,
    });
  }
  const groupList = [...groupMap.values()];
  const [requires, excludes] = rules;
  const ruleSet = {
    requires: requires.rows.map(r => ({ optionId: r.option_id, requiredOptionId: r.required_option_id })),
    excludes: excludes.rows.map(r => ({ optionAId: r.option_a_id, optionBId: r.option_b_id })),
  };
  const item = itemOf(row, attrs.get(row.id) ?? [], assetsDto(assets.get(row.id)));
  return {
    detail: { ...item, groups: groupList, rules: ruleSet, maxDiscountBps: row.max_discount_bps },
    rules: {
      groups: groupList.map(g => ({ id: g.id, code: g.code, selectionType: g.selectionType, required: g.required, options: g.options.map(o => ({ id: o.id, code: o.code, isDefault: o.isDefault })) })),
      ...ruleSet,
    },
    pricing: {
      listPriceMinor: num(row.list_price_minor),
      maxDiscountBps: row.max_discount_bps,
      perSaunaDiscount: discountOf(row.sauna_type, row.sauna_value),
      defaultDiscount: discountOf(row.default_type, row.default_value),
      optionPrices,
    },
    isVisible: row.is_visible,
  };
}

export async function listRooms(db: Db, tenant: TenantInfo, locale: AppLocale): Promise<Room[]> {
  const { rows } = await db.query<{ id: string; code: string; name: string; description: string | null; preset: Room['preset']; thumb: string | null; low: string | null; high: string | null }>(
    `select r.id, r.code, coalesce(t.name, r.name) as name, coalesce(t.description, r.description) as description, r.preset,
            (select a.storage_key from room_scene_assets x join assets a on a.id = x.asset_id where x.room_scene_id = r.id and x.asset_role = 'ROOM_THUMBNAIL') as thumb,
            (select a.storage_key from room_scene_assets x join assets a on a.id = x.asset_id where x.room_scene_id = r.id and x.asset_role = 'ROOM_GLB_LOW') as low,
            (select a.storage_key from room_scene_assets x join assets a on a.id = x.asset_id where x.room_scene_id = r.id and x.asset_role = 'ROOM_GLB_HIGH') as high
       from reseller_room_scenes rr
       join room_scenes r on r.id = rr.room_scene_id and r.status = 'ACTIVE'
       left join room_scene_translations t on t.room_scene_id = r.id and t.locale = $2
      where rr.reseller_id = $1
      order by rr.sort_order, r.sort_order, name`,
    [tenant.id, locale]);
  return rows.map(r => ({ id: r.id, code: r.code, name: r.name, description: r.description, preset: r.preset ?? null, thumbnailUrl: assetUrl(r.thumb), lowGlbUrl: assetUrl(r.low), highGlbUrl: assetUrl(r.high) }));
}
