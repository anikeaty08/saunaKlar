import {
  CUSTOMER_TRANSITIONS, STAFF_TRANSITIONS,
  type AdminRequestDto, type AppLocale, type Quote, type RequestDto, type RequestStatus, type RequestSummary,
} from '@saunaklar/shared';
import type { Db, TenantInfo } from '../context.ts';
import { ApiError } from '../lib/problem.ts';
import { getConfigRow, getSnapshot, lockConfiguration, type ConfigRow } from './configurations.ts';

/**
 * Request workflow (design 9.4). Status changes are plain UPDATEs; the
 * database checks them against `request_status_transitions` for the actor
 * set in the transaction (app.actor_*), writes the history row and queues
 * the e-mail in the outbox. This module adds the business rules the table
 * cannot express (quotes required for QUOTED, quote expiry on accept).
 */

interface RequestRow {
  id: string;
  customer_id: string;
  configuration_id: string;
  status_code: RequestStatus;
  message: string | null;
  created_at: Date;
  updated_at: Date;
}

const iso = (d: Date) => d.toISOString();

export async function submitRequest(db: Db, tenant: TenantInfo, locale: AppLocale, config: ConfigRow, customerId: string, message: string | undefined, validDays: number): Promise<string> {
  if (config.customer_id !== customerId) throw new ApiError('NOT_FOUND', 'Configuration not found.');
  const existing = await db.query<{ id: string }>('select id from configuration_requests where configuration_id = $1', [config.id]);
  if (existing.rows[0]) return existing.rows[0].id; // idempotent retry (design 13)
  // lockConfiguration holds the configuration row lock until commit, so a concurrent submit
  // waits there and then finds the request the first one created (no unique violation).
  await lockConfiguration(db, tenant, locale, config, validDays);
  const raced = await db.query<{ id: string }>('select id from configuration_requests where configuration_id = $1', [config.id]);
  if (raced.rows[0]) return raced.rows[0].id;
  const { rows } = await db.query<{ id: string }>(
    `insert into configuration_requests (reseller_id, customer_id, configuration_id, message) values ($1, $2, $3, $4) returning id`,
    [tenant.id, customerId, config.id, message?.trim() || null]);
  return rows[0]!.id;
}

/** `lock`: take the row lock first, so the status checks below see the state the write will apply to. */
async function getRequestRow(db: Db, id: string, customerId?: string, lock = false): Promise<RequestRow> {
  const { rows } = await db.query<RequestRow>(`select * from configuration_requests where id = $1${lock ? ' for update' : ''}`, [id]);
  const row = rows[0];
  if (!row || (customerId && row.customer_id !== customerId)) throw new ApiError('NOT_FOUND', 'Request not found.');
  return row;
}

function quoteDto(q: { id: string; amount_minor: string; currency_code: string; valid_until: Date; note: string | null; created_at: Date; superseded_at: Date | null }): Quote {
  return { id: q.id, amountMinor: Number(q.amount_minor), currency: q.currency_code.trim(), validUntil: iso(q.valid_until), note: q.note, createdAt: iso(q.created_at), supersededAt: q.superseded_at ? iso(q.superseded_at) : null };
}

async function loadQuotes(db: Db, requestId: string): Promise<Quote[]> {
  const { rows } = await db.query<Parameters<typeof quoteDto>[0]>('select * from request_quotes where request_id = $1 order by created_at desc', [requestId]);
  return rows.map(quoteDto);
}

export async function buildRequestDto(db: Db, tenant: TenantInfo, locale: AppLocale, id: string, customerId?: string): Promise<RequestDto> {
  const row = await getRequestRow(db, id, customerId);
  const [config, snapshot, history, quotes, selections] = await Promise.all([
    db.query<{ id: string; name: string | null; model_id: string; slug: string; model_name: string }>(
      `select c.id, c.name, m.id as model_id, m.slug, coalesce(t.name, m.name) as model_name
         from configurations c join sauna_models m on m.id = c.sauna_model_id
         left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
        where c.id = $1`, [row.configuration_id, locale]),
    getSnapshot(db, row.configuration_id),
    db.query<{ from_status: RequestStatus | null; to_status: RequestStatus; changed_by_staff_id: string | null; changed_by_customer_id: string | null; staff_name: string | null; note: string | null; changed_at: Date }>(
      `select h.from_status, h.to_status, h.changed_by_staff_id, h.changed_by_customer_id, s.display_name as staff_name, h.note, h.changed_at
         from request_status_history h left join staff_users s on s.id = h.changed_by_staff_id
        where h.request_id = $1 order by h.id`, [row.id]),
    loadQuotes(db, row.id),
    db.query<{ option_id: string; group_name: string; option_name: string; price_delta_minor: string }>(
      `select l.option_id, coalesce(gt.name, g.name) as group_name, coalesce(ot.name, o.name) as option_name, l.price_delta_minor
         from configuration_price_snapshot_lines l
         join options o on o.id = l.option_id
         join option_groups g on g.id = o.option_group_id
         left join option_translations ot on ot.option_id = o.id and ot.locale = $2
         left join option_group_translations gt on gt.option_group_id = g.id and gt.locale = $2
        where l.configuration_id = $1 order by g.sort_order, o.sort_order`, [row.configuration_id, locale]),
  ]);
  const c = config.rows[0];
  if (!c || !snapshot) throw new Error(`request ${row.id} has no locked configuration`);
  return {
    id: row.id,
    status: row.status_code,
    message: row.message,
    configuration: {
      id: c.id,
      name: c.name ?? c.model_name,
      sauna: { id: c.model_id, slug: c.slug, name: c.model_name },
      selections: selections.rows.map(s => ({ optionId: s.option_id, groupName: s.group_name, optionName: s.option_name, priceDeltaMinor: Number(s.price_delta_minor) })),
    },
    snapshot,
    activeQuote: quotes.find(q => !q.supersededAt) ?? null,
    history: history.rows.map(h => ({
      fromStatus: h.from_status,
      toStatus: h.to_status,
      actor: h.changed_by_staff_id ? 'STAFF' : h.changed_by_customer_id ? 'CUSTOMER' : 'SYSTEM',
      // Staff names are shown to customers only as the reseller's team, never personally.
      actorName: h.changed_by_staff_id ? (customerId ? null : h.staff_name) : null,
      note: h.note,
      at: iso(h.changed_at),
    })),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function buildAdminRequestDto(db: Db, tenant: TenantInfo, locale: AppLocale, id: string): Promise<AdminRequestDto> {
  const base = await buildRequestDto(db, tenant, locale, id);
  const row = await getRequestRow(db, id);
  const [customer, notes, quotes] = await Promise.all([
    db.query<{ id: string; email: string; first_name: string; last_name: string; phone: string | null }>('select id, email, first_name, last_name, phone from customers where id = $1', [row.customer_id]),
    db.query<{ id: string; body: string; author: string; created_at: Date }>(
      `select n.id, n.body, coalesce(s.display_name, 'Team') as author, n.created_at
         from request_notes n left join staff_users s on s.id = n.author_staff_id
        where n.request_id = $1 order by n.created_at`, [id]),
    loadQuotes(db, id),
  ]);
  const cu = customer.rows[0]!;
  return {
    ...base,
    customer: { id: cu.id, email: cu.email, firstName: cu.first_name, lastName: cu.last_name, phone: cu.phone },
    notes: notes.rows.map(n => ({ id: n.id, body: n.body, authorName: n.author, createdAt: iso(n.created_at) })),
    quotes,
    allowedTransitions: STAFF_TRANSITIONS[row.status_code].filter(s => s !== 'QUOTED'),
  };
}

/** Staff status change. QUOTED is reached only through `putQuote`, so a quote always exists. */
export async function staffTransition(db: Db, id: string, to: RequestStatus, note: string | undefined): Promise<void> {
  const row = await getRequestRow(db, id, undefined, true);
  if (to === 'QUOTED') throw new ApiError('QUOTE_MISSING', 'Add a quote to move the request to QUOTED.');
  if (!STAFF_TRANSITIONS[row.status_code].includes(to)) throw new ApiError('INVALID_TRANSITION', `Cannot change ${row.status_code} to ${to}.`);
  await setStatus(db, id, to, note);
}

async function setStatus(db: Db, id: string, to: RequestStatus, note: string | undefined): Promise<void> {
  // The history trigger reads the note from this transaction-local setting.
  await db.query(`select set_config('app.status_note', $1, true)`, [note?.trim() ?? '']);
  // Only status_code is writable for app_tenant; updated_at is maintained by the set_updated_at trigger.
  await db.query('update configuration_requests set status_code = $2 where id = $1', [id, to]);
}

/** `quoteId` (accept only): the quote the customer saw; a different active quote means staff re-quoted meanwhile. */
export async function customerTransition(db: Db, id: string, customerId: string, to: 'ACCEPTED' | 'CANCELLED', now: Date, quoteId?: string): Promise<void> {
  // Serialised with putQuote: an accept never applies to a quote that replaced the one checked here.
  const row = await getRequestRow(db, id, customerId, true);
  if (!CUSTOMER_TRANSITIONS[row.status_code].includes(to)) throw new ApiError('INVALID_TRANSITION', `Cannot change ${row.status_code} to ${to}.`);
  if (to === 'ACCEPTED') {
    const active = (await loadQuotes(db, id)).find(q => !q.supersededAt);
    if (!active) throw new ApiError('QUOTE_MISSING');
    if (quoteId && active.id !== quoteId) {
      throw new ApiError('CONFLICT', 'The quote changed, please review the new one.', { meta: { activeQuoteId: active.id } });
    }
    if (new Date(active.validUntil) <= now) throw new ApiError('QUOTE_EXPIRED', 'This quote has expired. Ask for a new one.');
  }
  await setStatus(db, id, to, undefined);
}

/**
 * Adds a quote (review G8: the database supersedes the previous quote, it is
 * never overwritten) and moves the request to QUOTED. The database accepts a
 * quote only while the request is IN_REVIEW, so SUBMITTED and QUOTED pass
 * through IN_REVIEW first and the history shows the real sequence.
 */
export async function putQuote(db: Db, tenant: TenantInfo, id: string, staffId: string, input: { amountMinor: number; validUntil: string; note?: string | undefined }, now: Date): Promise<void> {
  // Lock before the status check: a customer accepting concurrently must not end up with a
  // superseded quote behind an ACCEPTED request.
  const row = await getRequestRow(db, id, undefined, true);
  if (!['SUBMITTED', 'IN_REVIEW', 'QUOTED'].includes(row.status_code)) throw new ApiError('INVALID_TRANSITION', `A ${row.status_code} request cannot be quoted.`);
  if (new Date(input.validUntil) <= now) throw new ApiError('VALIDATION_FAILED', 'The quote must be valid in the future.', { errors: { validUntil: ['Must be in the future.'] } });
  if (row.status_code !== 'IN_REVIEW') await setStatus(db, id, 'IN_REVIEW', row.status_code === 'QUOTED' ? 'Revised quote' : undefined);
  await db.query(
    `insert into request_quotes (request_id, reseller_id, amount_minor, currency_code, valid_until, note, created_by_staff_id)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, tenant.id, input.amountMinor, tenant.currency, input.validUntil, input.note?.trim() || null, staffId]);
  await setStatus(db, id, 'QUOTED', input.note);
}

export async function addNote(db: Db, tenant: TenantInfo, id: string, staffId: string, body: string): Promise<void> {
  await getRequestRow(db, id);
  await db.query('insert into request_notes (request_id, reseller_id, author_staff_id, body) values ($1, $2, $3, $4)', [id, tenant.id, staffId, body.trim()]);
}

export async function listRequestSummaries(
  db: Db, tenant: TenantInfo, locale: AppLocale,
  filter: { customerId?: string; status?: RequestStatus; q?: string },
  cursor: { at: string; id: string } | null, limit: number,
): Promise<(RequestSummary & { customerName: string; customerEmail: string; _at: string })[]> {
  const params: unknown[] = [tenant.id, locale, limit + 1];
  const where = ['r.reseller_id = $1'];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (filter.customerId) add('r.customer_id = ?', filter.customerId);
  if (filter.status) add('r.status_code = ?', filter.status);
  if (filter.q) add(`(cu.email ilike ? or (cu.first_name || ' ' || cu.last_name) ilike $${params.length + 1} or c.name ilike $${params.length + 1})`, `%${filter.q.replace(/[\\%_]/g, m => `\\${m}`)}%`);
  if (cursor) {
    params.push(cursor.at, cursor.id);
    where.push(`(r.created_at, r.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
  }
  const { rows } = await db.query<{ id: string; status_code: RequestStatus; model_name: string; config_name: string | null; final_price_minor: string; currency_code: string; created_at: Date; updated_at: Date; first_name: string; last_name: string; email: string }>(
    `select r.id, r.status_code, coalesce(t.name, m.name) as model_name, c.name as config_name, s.final_price_minor, s.currency_code,
            r.created_at, r.updated_at, cu.first_name, cu.last_name, cu.email
       from configuration_requests r
       join configurations c on c.id = r.configuration_id
       join sauna_models m on m.id = c.sauna_model_id
       left join sauna_model_translations t on t.sauna_model_id = m.id and t.locale = $2
       join configuration_price_snapshots s on s.configuration_id = c.id
       join customers cu on cu.id = r.customer_id
      where ${where.join(' and ')}
      order by r.created_at desc, r.id desc
      limit $3`,
    params);
  return rows.map(r => ({
    id: r.id,
    status: r.status_code,
    saunaName: r.model_name,
    configurationName: r.config_name ?? r.model_name,
    finalPriceMinor: Number(r.final_price_minor),
    currency: r.currency_code.trim(),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    customerName: `${r.first_name} ${r.last_name}`.trim(),
    customerEmail: r.email,
    _at: iso(r.created_at),
  }));
}

export { getConfigRow };
