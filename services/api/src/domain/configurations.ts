import { calculatePrice, type PriceBreakdown } from '@saunaklar/pricing';
import { defaultSelection, validate } from '@saunaklar/rules';
import type { AppLocale, Configuration, ConfigurationSummary, Placement, PriceBreakdownDto, PriceSnapshotDto, RequestStatus } from '@saunaklar/shared';
import type { Db, TenantInfo } from '../context.ts';
import { ApiError } from '../lib/problem.ts';
import { assetUrl, loadModel, type LoadedModel } from './catalog.ts';

/**
 * Configuration lifecycle (design 9.1): draft → (room placement) → locked.
 * Locking writes the price snapshot in the same transaction; the database
 * then refuses any further change (rule 6).
 */

export interface ConfigRow {
  id: string;
  reseller_id: string;
  sauna_model_id: string;
  customer_id: string | null;
  created_by_staff_id: string | null;
  name: string | null;
  source_configuration_id: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type Owner = { customerId: string } | { staff: true };

const iso = (d: Date) => d.toISOString();

export function toBreakdownDto(p: PriceBreakdown, currency: string): PriceBreakdownDto {
  return {
    currency,
    listPriceMinor: p.listPriceMinor,
    optionsTotalMinor: p.optionsTotalMinor,
    subtotalMinor: p.subtotalMinor,
    discountSource: p.discountSource,
    discountType: p.discountType,
    discountValue: p.discountValue,
    discountMinor: p.discountMinor,
    finalPriceMinor: p.finalPriceMinor,
    lines: p.lines,
  };
}

export function livePrice(model: LoadedModel, selections: readonly string[]): PriceBreakdown {
  return calculatePrice({
    listPriceMinor: model.pricing.listPriceMinor,
    maxDiscountBps: model.pricing.maxDiscountBps,
    perSaunaDiscount: model.pricing.perSaunaDiscount,
    defaultDiscount: model.pricing.defaultDiscount,
    options: selections.map(id => {
      const price = model.pricing.optionPrices.get(id);
      if (price === undefined) throw new ApiError('OPTION_RULES_VIOLATED', `Option ${id} is not available for this sauna.`);
      return { optionId: id, priceDeltaMinor: price };
    }),
  });
}

/** Loads a configuration the caller may see: customers only their own, staff any of the tenant. */
export async function getConfigRow(db: Db, id: string, owner: Owner): Promise<ConfigRow> {
  const { rows } = await db.query<ConfigRow>('select * from configurations where id = $1', [id]);
  const row = rows[0];
  if (!row || ('customerId' in owner && row.customer_id !== owner.customerId)) throw new ApiError('NOT_FOUND', 'Configuration not found.');
  return row;
}

export async function getSelections(db: Db, configurationId: string): Promise<string[]> {
  const { rows } = await db.query<{ option_id: string }>('select option_id from configuration_selections where configuration_id = $1 order by created_at, option_id', [configurationId]);
  return rows.map(r => r.option_id);
}

async function getPlacement(db: Db, configurationId: string): Promise<Placement | null> {
  const { rows } = await db.query<{ room_scene_id: string; position_x_mm: number; position_z_mm: number; rotation_deg: string }>(
    'select room_scene_id, position_x_mm, position_z_mm, rotation_deg from configuration_room_placements where configuration_id = $1', [configurationId]);
  const r = rows[0];
  return r ? { roomSceneId: r.room_scene_id, positionXMm: r.position_x_mm, positionZMm: r.position_z_mm, rotationDeg: Number(r.rotation_deg) } : null;
}

export async function getSnapshot(db: Db, configurationId: string): Promise<PriceSnapshotDto | null> {
  const { rows } = await db.query<{ currency_code: string; list_price_minor: string; options_total_minor: string; discount_amount_minor: string; final_price_minor: string; discount_source: 'SAUNA' | 'DEFAULT' | 'NONE'; discount_type: 'PERCENT' | 'FIXED' | null; discount_value: string | null; price_valid_until: Date; computed_at: Date }>(
    'select * from configuration_price_snapshots where configuration_id = $1', [configurationId]);
  const s = rows[0];
  if (!s) return null;
  const lines = await db.query<{ option_id: string; price_delta_minor: string }>(
    'select option_id, price_delta_minor from configuration_price_snapshot_lines where configuration_id = $1 order by option_id', [configurationId]);
  const list = Number(s.list_price_minor);
  const options = Number(s.options_total_minor);
  return {
    currency: s.currency_code.trim(),
    listPriceMinor: list,
    optionsTotalMinor: options,
    subtotalMinor: list + options,
    discountSource: s.discount_source,
    discountType: s.discount_type,
    discountValue: s.discount_value === null ? null : Number(s.discount_value),
    discountMinor: Number(s.discount_amount_minor),
    finalPriceMinor: Number(s.final_price_minor),
    lines: lines.rows.map(l => ({ optionId: l.option_id, priceDeltaMinor: Number(l.price_delta_minor) })),
    computedAt: iso(s.computed_at),
    priceValidUntil: iso(s.price_valid_until),
  };
}

export async function toConfigurationDto(db: Db, tenant: TenantInfo, locale: AppLocale, row: ConfigRow): Promise<Configuration> {
  const model = await loadModel(db, tenant, locale, { id: row.sauna_model_id }, true);
  if (!model) throw new ApiError('SAUNA_NOT_OFFERED', 'This sauna is no longer offered.');
  const [selections, placement, snapshot, request] = await Promise.all([
    getSelections(db, row.id),
    getPlacement(db, row.id),
    row.locked_at ? getSnapshot(db, row.id) : Promise.resolve(null),
    db.query<{ id: string; status_code: RequestStatus }>('select id, status_code from configuration_requests where configuration_id = $1', [row.id]),
  ]);
  let breakdown: PriceBreakdownDto;
  if (snapshot) {
    const { computedAt: _computedAt, priceValidUntil: _validUntil, ...frozen } = snapshot;
    breakdown = frozen;
  } else {
    breakdown = toBreakdownDto(livePrice(model, selections), tenant.currency);
  }
  const req = request.rows[0];
  return {
    id: row.id,
    name: row.name ?? model.detail.name,
    sauna: { id: model.detail.id, slug: model.detail.slug, name: model.detail.name, thumbnailUrl: model.detail.assets.thumbnailUrl },
    selections,
    placement,
    locked: row.locked_at !== null,
    lockedAt: row.locked_at ? iso(row.locked_at) : null,
    price: breakdown,
    snapshot,
    owner: row.customer_id ? 'CUSTOMER' : 'STAFF',
    customerId: row.customer_id,
    sourceConfigurationId: row.source_configuration_id,
    request: req ? { id: req.id, status: req.status_code } : null,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

/** Normalises and validates a requested selection; a draft may be incomplete but never contradictory. */
function checkSelection(model: LoadedModel, selection: readonly string[], complete: boolean): string[] {
  const unique = [...new Set(selection)];
  const issues = validate(model.rules, unique).issues.filter(i => complete || i.code !== 'REQUIRED_GROUP_EMPTY');
  if (issues.length) {
    throw new ApiError('OPTION_RULES_VIOLATED', issues.map(i => i.message).join(' '), {
      errors: Object.fromEntries(issues.map((i, n) => [`selections.${n}`, [i.message]])),
      meta: { issues },
    });
  }
  return unique;
}

export async function createConfiguration(
  db: Db, tenant: TenantInfo, locale: AppLocale,
  input: { saunaModelId: string; name?: string | undefined; selections?: string[] | undefined; customerId: string | null; staffId: string | null; sourceId?: string | null },
): Promise<ConfigRow> {
  // Customers may only start from visible saunas; staff may prepare hidden ones, and a
  // clone (own configuration or a claimed share link) keeps the model it was made with.
  const includeHidden = (input.staffId !== null && input.customerId === null) || Boolean(input.sourceId);
  const model = await loadModel(db, tenant, locale, { id: input.saunaModelId }, includeHidden);
  if (!model) throw new ApiError('SAUNA_NOT_OFFERED', 'This sauna is not offered here.');
  const selection = checkSelection(model, input.selections ?? defaultSelection(model.rules), false);
  const { rows } = await db.query<ConfigRow>(
    `insert into configurations (reseller_id, sauna_model_id, customer_id, created_by_staff_id, name, source_configuration_id)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [tenant.id, model.detail.id, input.customerId, input.staffId, input.name ?? model.detail.name, input.sourceId ?? null]);
  const row = rows[0]!;
  await writeSelections(db, row, selection);
  return row;
}

async function writeSelections(db: Db, row: ConfigRow, selection: readonly string[]): Promise<void> {
  await db.query('delete from configuration_selections where configuration_id = $1', [row.id]);
  if (selection.length) {
    await db.query(
      `insert into configuration_selections (configuration_id, sauna_model_id, option_id)
       select $1, $2, unnest($3::uuid[])`,
      [row.id, row.sauna_model_id, selection]);
  }
  await db.query('update configurations set updated_at = now() where id = $1', [row.id]);
}

export async function replaceSelections(db: Db, tenant: TenantInfo, locale: AppLocale, row: ConfigRow, selection: readonly string[]): Promise<void> {
  if (row.locked_at) throw new ApiError('CONFIGURATION_LOCKED', 'This configuration is locked. Clone it to make changes.');
  // Serialises concurrent edits of the same configuration.
  await db.query('select 1 from configurations where id = $1 for update', [row.id]);
  const model = await loadModel(db, tenant, locale, { id: row.sauna_model_id }, true);
  if (!model) throw new ApiError('SAUNA_NOT_OFFERED');
  await writeSelections(db, row, checkSelection(model, selection, false));
}

export async function replacePlacement(db: Db, tenant: TenantInfo, row: ConfigRow, placement: Placement | null): Promise<void> {
  if (row.locked_at) throw new ApiError('CONFIGURATION_LOCKED', 'This configuration is locked. Clone it to make changes.');
  if (!placement) {
    await db.query('delete from configuration_room_placements where configuration_id = $1', [row.id]);
    return;
  }
  const rotation = ((placement.rotationDeg % 360) + 360) % 360;
  await db.query(
    `insert into configuration_room_placements (configuration_id, reseller_id, room_scene_id, position_x_mm, position_z_mm, rotation_deg)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (configuration_id) do update set room_scene_id = excluded.room_scene_id, position_x_mm = excluded.position_x_mm,
       position_z_mm = excluded.position_z_mm, rotation_deg = excluded.rotation_deg, updated_at = now()`,
    [row.id, tenant.id, placement.roomSceneId, placement.positionXMm, placement.positionZMm, Math.round(rotation * 100) / 100]);
}

/**
 * Locks a configuration: validates the complete selection, freezes the
 * price (review G4: with a validity date) and sets `locked_at`, all in the
 * caller's transaction. Idempotent: an already locked configuration is left
 * as it is, so a retried share/request call is safe.
 */
export async function lockConfiguration(db: Db, tenant: TenantInfo, locale: AppLocale, row: ConfigRow, validDays: number): Promise<ConfigRow> {
  await db.query('select 1 from configurations where id = $1 for update', [row.id]);
  const fresh = (await db.query<ConfigRow>('select * from configurations where id = $1', [row.id])).rows[0]!;
  if (fresh.locked_at) return fresh;
  const model = await loadModel(db, tenant, locale, { id: fresh.sauna_model_id }, true);
  if (!model) throw new ApiError('SAUNA_NOT_OFFERED');
  const selection = checkSelection(model, await getSelections(db, fresh.id), true);
  const p = livePrice(model, selection);
  await db.query(
    `insert into configuration_price_snapshots (configuration_id, currency_code, list_price_minor, options_total_minor,
       discount_amount_minor, final_price_minor, discount_source, discount_type, discount_value, max_discount_bps, price_valid_until)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now() + make_interval(days => $11))`,
    [fresh.id, tenant.currency, p.listPriceMinor, p.optionsTotalMinor, p.discountMinor, p.finalPriceMinor, p.discountSource, p.discountType, p.discountValue, model.pricing.maxDiscountBps, validDays]);
  if (p.lines.length) {
    await db.query(
      `insert into configuration_price_snapshot_lines (configuration_id, option_id, price_delta_minor)
       select $1, x.option_id, x.price from unnest($2::uuid[], $3::bigint[]) as x(option_id, price)`,
      [fresh.id, p.lines.map(l => l.optionId), p.lines.map(l => l.priceDeltaMinor)]);
  }
  const { rows } = await db.query<ConfigRow>('update configurations set locked_at = now() where id = $1 returning *', [fresh.id]);
  return rows[0]!;
}

/** New draft from any configuration (locked or not) with the same model, selections and placement. */
export async function cloneConfiguration(db: Db, tenant: TenantInfo, locale: AppLocale, source: ConfigRow, owner: { customerId: string | null; staffId: string | null }): Promise<ConfigRow> {
  const selections = await getSelections(db, source.id);
  const row = await createConfiguration(db, tenant, locale, {
    saunaModelId: source.sauna_model_id,
    name: source.name ?? undefined,
    selections,
    customerId: owner.customerId,
    staffId: owner.staffId,
    sourceId: source.id,
  });
  const placement = await getPlacement(db, source.id);
  if (placement) await replacePlacement(db, tenant, row, placement);
  return row;
}

export async function listConfigurationSummaries(db: Db, tenant: TenantInfo, locale: AppLocale, filter: { customerId?: string }, cursor: { at: string; id: string } | null, limit: number): Promise<(ConfigurationSummary & { _at: string })[]> {
  const params: unknown[] = [tenant.id, locale, limit + 1];
  let where = 'c.reseller_id = $1';
  if (filter.customerId) {
    params.push(filter.customerId);
    where += ` and c.customer_id = $${params.length}`;
  }
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where += ` and (c.updated_at, c.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  const { rows } = await db.query<{ id: string; name: string | null; locked_at: Date | null; customer_id: string | null; created_at: Date; updated_at: Date; model_id: string; slug: string; model_name: string; thumb: string | null; final_price_minor: string | null; request_id: string | null; status_code: RequestStatus | null }>(
    `select c.id, c.name, c.locked_at, c.customer_id, c.created_at, c.updated_at,
            m.id as model_id, m.slug, coalesce(t.name, m.name) as model_name,
            (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id where x.sauna_model_id = m.id and x.asset_role = 'MODEL_THUMBNAIL' order by x.position limit 1) as thumb,
            s.final_price_minor, r.id as request_id, r.status_code
       from configurations c
       join sauna_models m on m.id = c.sauna_model_id
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
       left join configuration_price_snapshots s on s.configuration_id = c.id
       left join configuration_requests r on r.configuration_id = c.id
      where ${where}
      order by c.updated_at desc, c.id desc
      limit $3`,
    params);
  // Drafts have no snapshot: price them live (one model load per distinct model).
  const models = new Map<string, LoadedModel | null>();
  const out: (ConfigurationSummary & { _at: string })[] = [];
  for (const r of rows) {
    let final = r.final_price_minor === null ? null : Number(r.final_price_minor);
    if (final === null) {
      if (!models.has(r.model_id)) models.set(r.model_id, await loadModel(db, tenant, locale, { id: r.model_id }, true));
      const model = models.get(r.model_id);
      final = model ? livePrice(model, await getSelections(db, r.id)).finalPriceMinor : 0;
    }
    out.push({
      id: r.id,
      name: r.name ?? r.model_name,
      sauna: { id: r.model_id, slug: r.slug, name: r.model_name, thumbnailUrl: assetUrl(r.thumb) },
      locked: r.locked_at !== null,
      lockedAt: r.locked_at ? iso(r.locked_at) : null,
      owner: r.customer_id ? 'CUSTOMER' : 'STAFF',
      request: r.request_id ? { id: r.request_id, status: r.status_code! } : null,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      finalPriceMinor: final,
      currency: tenant.currency,
      _at: iso(r.updated_at),
    });
  }
  return out;
}
