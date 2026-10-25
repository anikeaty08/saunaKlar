import type { PoolClient } from 'pg';
import type { MailBrand, RenderedMail } from '../adapters/mail/templates.ts';
import { PermanentError, type HandlerContext } from './types.ts';

/** Reseller branding for worker mails (design 5.2): brand name, colour, support Reply-To. */
export interface ResellerMailBrand {
  resellerId: string;
  slug: string;
  origin: string;
  brand: MailBrand;
}

export async function loadBrand(ctx: HandlerContext, resellerId: string): Promise<ResellerMailBrand> {
  const { rows } = await ctx.db.query<{
    slug: string;
    name: string;
    display_name: string | null;
    primary_color: string | null;
    support_email: string | null;
    legal_name: string | null;
    legal_address: string | null;
  }>(
    `SELECT r.slug, r.name, b.display_name, b.primary_color, b.support_email, b.legal_name, b.legal_address
       FROM resellers r
       LEFT JOIN reseller_branding b ON b.reseller_id = r.id
      WHERE r.id = $1`,
    [resellerId],
  );
  const r = rows[0];
  if (!r) throw new PermanentError('reseller not found');
  const origin = ctx.links(r.slug);
  return {
    resellerId,
    slug: r.slug,
    origin,
    brand: {
      brandName: r.display_name?.trim() || r.name,
      storefrontUrl: origin,
      ...(r.primary_color ? { primaryColor: r.primary_color } : {}),
      ...(r.support_email ? { supportEmail: r.support_email } : {}),
      ...(r.legal_name ? { legalName: r.legal_name } : {}),
      ...(r.legal_address ? { legalAddress: r.legal_address } : {}),
    },
  };
}

/** Customer fields the worker may read (column grants, review C3). */
export interface MailCustomer {
  id: string;
  email: string;
  firstName: string | null;
  locale: string;
  status: 'PENDING' | 'ACTIVE' | 'ANONYMISED';
}

export async function loadCustomer(db: PoolClient, customerId: string, resellerId: string): Promise<MailCustomer | null> {
  const { rows } = await db.query<{ id: string; email: string; first_name: string | null; locale: string; status: MailCustomer['status'] }>(
    'SELECT id, email, first_name, locale, status FROM customers WHERE id = $1 AND reseller_id = $2',
    [customerId, resellerId],
  );
  const c = rows[0];
  return c ? { id: c.id, email: c.email, firstName: c.first_name, locale: c.locale, status: c.status } : null;
}

/** E-mail addresses of every ACTIVE owner/admin of the reseller. */
export async function loadResellerAdminEmails(db: PoolClient, resellerId: string): Promise<string[]> {
  const { rows } = await db.query<{ email: string }>(
    `SELECT su.email
       FROM reseller_admins ra
       JOIN staff_users su ON su.id = ra.staff_user_id
      WHERE ra.reseller_id = $1 AND su.status = 'ACTIVE'
      ORDER BY su.id`,
    [resellerId],
  );
  return rows.map(r => r.email);
}

export async function suppressedSet(db: PoolClient, emails: readonly string[]): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const { rows } = await db.query<{ email_lower: string }>(
    'SELECT email_lower FROM email_suppressions WHERE email_lower = ANY($1::text[])',
    [emails.map(e => e.toLowerCase())],
  );
  return new Set(rows.map(r => r.email_lower));
}

/**
 * Sends one rendered mail per recipient, skipping suppressed addresses (design 14).
 * Returns counts only; addresses never reach the logs.
 */
export async function sendBranded(
  ctx: HandlerContext,
  brand: ResellerMailBrand,
  recipients: readonly string[],
  mail: RenderedMail,
): Promise<{ sent: number; skipped: number }> {
  const unique = [...new Map(recipients.map(e => [e.toLowerCase(), e])).values()];
  const suppressed = await suppressedSet(ctx.db, unique);
  let sent = 0;
  let skipped = 0;
  for (const to of unique) {
    if (suppressed.has(to.toLowerCase())) {
      skipped++;
      continue;
    }
    await ctx.mailer.send({
      to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      resellerId: brand.resellerId,
      fromName: brand.brand.brandName,
      ...(brand.brand.supportEmail ? { replyTo: brand.brand.supportEmail } : {}),
    });
    sent++;
  }
  if (skipped > 0) ctx.log.info('outbox.recipients_suppressed', { skipped });
  return { sent, skipped };
}

/** Customer recipients: none for anonymised (erased) accounts. */
export function customerRecipients(customer: MailCustomer | null): string[] {
  return customer && customer.status !== 'ANONYMISED' ? [customer.email] : [];
}

/** Short human reference for a request, e.g. `REQ-3F2A9C01`. */
export const requestReference = (requestId: string): string => `REQ-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

/** Storefront paths of the SPA (apps/web router). */
export const paths = {
  customerRequest: (requestId: string) => `/account/requests/${encodeURIComponent(requestId)}`,
  adminRequest: (requestId: string) => `/admin/requests/${encodeURIComponent(requestId)}`,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads a uuid from the payload under any of the given keys (camelCase or snake_case). */
export function payloadUuid(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && UUID.test(v)) return v.toLowerCase();
  }
  return null;
}

export function payloadString(payload: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = payload[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

export function requirePayloadUuid(payload: Record<string, unknown>, ...keys: string[]): string {
  const v = payloadUuid(payload, ...keys);
  if (!v) throw new PermanentError(`payload lacks ${keys[0]}`);
  return v;
}
