import type { PoolClient } from 'pg';
import { templates } from '../adapters/mail/templates.ts';
import type { EdgeTenantStatus } from '../adapters/types.ts';
import {
  customerRecipients,
  loadBrand,
  loadCustomer,
  loadResellerAdminEmails,
  paths,
  payloadString,
  payloadUuid,
  requestReference,
  requirePayloadUuid,
  sendBranded,
} from './mail-context.ts';
import { PermanentError, type HandlerContext, type HandlerOutcome, type OutboxHandler } from './types.ts';

/** One handler per outbox event type (design 14). Unknown types are dead-lettered by the drain. */

interface RequestRow {
  id: string;
  reseller_id: string;
  customer_id: string;
  status_code: string;
  message: string | null;
  sauna_name: string;
  price_minor: string | null;
  currency_code: string | null;
}

async function loadRequest(db: PoolClient, requestId: string): Promise<RequestRow> {
  const { rows } = await db.query<RequestRow>(
    `SELECT cr.id, cr.reseller_id, cr.customer_id, cr.status_code, cr.message,
            m.name AS sauna_name,
            s.final_price_minor::text AS price_minor, s.currency_code
       FROM configuration_requests cr
       JOIN configurations c ON c.id = cr.configuration_id
       JOIN sauna_models m ON m.id = c.sauna_model_id
       LEFT JOIN configuration_price_snapshots s ON s.configuration_id = c.id
      WHERE cr.id = $1`,
    [requestId],
  );
  const r = rows[0];
  if (!r) throw new PermanentError('request not found');
  return r;
}

const merge = (a: HandlerOutcome, b: HandlerOutcome): HandlerOutcome => ({ sent: a.sent + b.sent, skipped: a.skipped + b.skipped });

/** Customer confirmation + notification to every active admin of the reseller. */
export const requestSubmitted: OutboxHandler = async ctx => {
  const req = await loadRequest(ctx.db, requirePayloadUuid(ctx.row.payload, 'requestId', 'request_id'));
  const brand = await loadBrand(ctx, req.reseller_id);
  const customer = await loadCustomer(ctx.db, req.customer_id, req.reseller_id);
  const reference = requestReference(req.id);
  const price = { amountMinor: Number(req.price_minor ?? 0), currency: req.currency_code ?? 'EUR' };
  const locale = customer?.locale ?? 'en';

  const toCustomer = await sendBranded(
    ctx,
    brand,
    customerRecipients(customer),
    templates.requestSubmittedCustomer(brand.brand, {
      firstName: customer?.firstName ?? null,
      reference,
      saunaName: req.sauna_name,
      price,
      requestUrl: brand.origin + paths.customerRequest(req.id),
    }, locale),
  );
  const staffMail = templates.requestSubmittedStaff(brand.brand, {
    reference,
    customerName: customer?.status === 'ANONYMISED' ? 'A former customer' : customer?.firstName || 'A customer',
    saunaName: req.sauna_name,
    price,
    message: req.message,
    adminUrl: brand.origin + paths.adminRequest(req.id),
  });
  const toStaff = await sendBranded(ctx, brand, await loadResellerAdminEmails(ctx.db, req.reseller_id), staffMail);
  return merge(toCustomer, toStaff);
};

/** Customer e-mail with the new status and the optional staff note. */
export const requestStatusChanged: OutboxHandler = async ctx => {
  const { payload } = ctx.row;
  const req = await loadRequest(ctx.db, requirePayloadUuid(payload, 'requestId', 'request_id'));
  const historyId = payloadString(payload, 'historyId', 'history_id');
  const toStatus = payloadString(payload, 'toStatus', 'to_status', 'status');
  const { rows } = await ctx.db.query<{ to_status: string; note: string | null }>(
    `SELECT h.to_status, h.note
       FROM request_status_history h
      WHERE h.request_id = $1
        AND ($2::bigint IS NULL OR h.id = $2::bigint)
        AND ($3::text IS NULL OR h.to_status = $3)
      ORDER BY h.id DESC
      LIMIT 1`,
    [req.id, historyId && /^\d+$/.test(historyId) ? historyId : null, toStatus],
  );
  const change = rows[0];
  if (!change) throw new PermanentError('status history entry not found');
  // A QUOTED transition is announced by the QUOTE_ADDED mail, which carries the amount.
  if (change.to_status === 'QUOTED') return { sent: 0, skipped: 1 };

  const brand = await loadBrand(ctx, req.reseller_id);
  const customer = await loadCustomer(ctx.db, req.customer_id, req.reseller_id);
  return sendBranded(
    ctx,
    brand,
    customerRecipients(customer),
    templates.requestStatusChanged(brand.brand, {
      firstName: customer?.firstName ?? null,
      reference: requestReference(req.id),
      status: change.to_status,
      note: change.note,
      requestUrl: brand.origin + paths.customerRequest(req.id),
    }, customer?.locale),
  );
};

/** Customer e-mail with the quoted amount and validity. */
export const quoteAdded: OutboxHandler = async ctx => {
  const { payload } = ctx.row;
  const req = await loadRequest(ctx.db, requirePayloadUuid(payload, 'requestId', 'request_id'));
  const quoteId = payloadUuid(payload, 'quoteId', 'quote_id');
  const { rows } = await ctx.db.query<{ amount_minor: string; currency_code: string; valid_until: Date; note: string | null; superseded: boolean }>(
    `SELECT amount_minor::text, currency_code, valid_until, note, superseded_at IS NOT NULL AS superseded
       FROM request_quotes
      WHERE request_id = $1 AND ($2::uuid IS NULL AND superseded_at IS NULL OR id = $2::uuid)
      ORDER BY created_at DESC
      LIMIT 1`,
    [req.id, quoteId],
  );
  const quote = rows[0];
  if (!quote) throw new PermanentError('quote not found');
  // Already replaced by a newer quote: that one has its own event; do not announce a stale amount.
  if (quote.superseded) return { sent: 0, skipped: 1 };

  const brand = await loadBrand(ctx, req.reseller_id);
  const customer = await loadCustomer(ctx.db, req.customer_id, req.reseller_id);
  return sendBranded(
    ctx,
    brand,
    customerRecipients(customer),
    templates.quoteAdded(brand.brand, {
      firstName: customer?.firstName ?? null,
      reference: requestReference(req.id),
      amount: { amountMinor: Number(quote.amount_minor), currency: quote.currency_code.trim() },
      validUntil: quote.valid_until,
      note: quote.note,
      requestUrl: brand.origin + paths.customerRequest(req.id),
    }, customer?.locale),
  );
};

/**
 * Mirrors a reseller's slug and status into the edge tenant store. The current row
 * wins over the payload, so out-of-order events still converge on the latest state.
 */
export const tenantSync: OutboxHandler = async (ctx: HandlerContext) => {
  const { payload } = ctx.row;
  const resellerId = payloadUuid(payload, 'resellerId', 'reseller_id') ?? ctx.row.resellerId;
  let slug = payloadString(payload, 'slug', 'newSlug', 'new_slug');
  let status = payloadString(payload, 'status', 'newStatus', 'new_status');
  if (resellerId) {
    const { rows } = await ctx.db.query<{ slug: string; status: string }>('SELECT slug, status FROM resellers WHERE id = $1', [resellerId]);
    if (rows[0]) ({ slug, status } = rows[0]);
  }
  if (!slug || (status !== 'ACTIVE' && status !== 'SUSPENDED')) throw new PermanentError('payload lacks slug or status');
  await ctx.edge.put(slug, status as EdgeTenantStatus);
  let removed = 0;
  const oldSlug = payloadString(payload, 'oldSlug', 'old_slug', 'previousSlug', 'previous_slug');
  if (oldSlug && oldSlug !== slug) {
    await ctx.edge.delete(oldSlug);
    removed = 1;
  }
  ctx.log.info('outbox.tenant_synced', { resellerId, status, removedOldSlug: removed === 1 });
  return { sent: 1 + removed, skipped: 0 };
};

export const outboxHandlers: Readonly<Record<string, OutboxHandler>> = Object.freeze({
  REQUEST_SUBMITTED: requestSubmitted,
  REQUEST_STATUS_CHANGED: requestStatusChanged,
  QUOTE_ADDED: quoteAdded,
  TENANT_SYNC: tenantSync,
});
