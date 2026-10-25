import type { Pool } from 'pg';
import type { Logger } from '../lib/log.ts';
import { workerTx } from './tx.ts';

/**
 * SES bounce and complaint feedback (design 14): SES publishes to SNS, SNS delivers
 * to an SQS queue the worker consumes. Supports the SNS envelope and raw message
 * delivery, and both SES formats: identity notifications (`notificationType`) and
 * configuration-set event publishing (`eventType`).
 */

export type SuppressionReason = 'BOUNCE' | 'COMPLAINT';

export interface Suppression {
  email: string;
  reason: SuppressionReason;
}

export type SesFeedback =
  | { kind: 'suppress'; suppressions: Suppression[]; feedbackType: string }
  | { kind: 'ignore'; feedbackType: string }
  | { kind: 'not_ses' };

interface SesRecipient {
  emailAddress?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Unwraps an SQS body: an SNS envelope (`Type: Notification`) or the SES JSON itself. */
export function unwrapSnsBody(body: string): Record<string, unknown> | null {
  const outer = parseJson(body);
  if (!isObject(outer)) return null;
  if (outer.Type === 'Notification' && typeof outer.Message === 'string') {
    const inner = parseJson(outer.Message);
    return isObject(inner) ? inner : null;
  }
  return outer;
}

/** True when an SQS body looks like SES feedback (enveloped or raw). */
export function isSesNotification(body: string): boolean {
  const msg = unwrapSnsBody(body);
  return !!msg && (typeof msg.notificationType === 'string' || typeof msg.eventType === 'string') && isObject(msg.mail);
}

function addresses(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  return list
    .map(r => (isObject(r) ? (r as SesRecipient).emailAddress : undefined))
    .filter((e): e is string => typeof e === 'string')
    .map(normaliseAddress)
    .filter((e): e is string => e !== null);
}

/** `"Name" <a@b.c>` → `a@b.c`, lower-cased; null when not an address. */
export function normaliseAddress(raw: string): string | null {
  const m = /<([^<>]+)>\s*$/.exec(raw);
  const addr = (m ? m[1]! : raw).trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+$/.test(addr) && addr.length <= 254 ? addr : null;
}

/** Classifies one SQS message body. Pure; never throws. */
export function parseSesFeedback(body: string): SesFeedback {
  const msg = unwrapSnsBody(body);
  if (!msg || !isObject(msg.mail)) return { kind: 'not_ses' };
  const type = typeof msg.notificationType === 'string' ? msg.notificationType : msg.eventType;
  if (typeof type !== 'string') return { kind: 'not_ses' };

  if (type === 'Bounce' && isObject(msg.bounce)) {
    // Only permanent bounces suppress; transient and undetermined ones are retried by SES.
    if (msg.bounce.bounceType !== 'Permanent') return { kind: 'ignore', feedbackType: `Bounce/${String(msg.bounce.bounceType)}` };
    const list = addresses(msg.bounce.bouncedRecipients).map(email => ({ email, reason: 'BOUNCE' as const }));
    return list.length ? { kind: 'suppress', suppressions: dedupe(list), feedbackType: 'Bounce/Permanent' } : { kind: 'ignore', feedbackType: 'Bounce/Permanent' };
  }
  if (type === 'Complaint' && isObject(msg.complaint)) {
    // A "not-spam" feedback report is the recipient retracting a complaint.
    if (msg.complaint.complaintFeedbackType === 'not-spam') return { kind: 'ignore', feedbackType: 'Complaint/not-spam' };
    const list = addresses(msg.complaint.complainedRecipients).map(email => ({ email, reason: 'COMPLAINT' as const }));
    return list.length ? { kind: 'suppress', suppressions: dedupe(list), feedbackType: 'Complaint' } : { kind: 'ignore', feedbackType: 'Complaint' };
  }
  return { kind: 'ignore', feedbackType: type };
}

function dedupe(list: Suppression[]): Suppression[] {
  const seen = new Map<string, Suppression>();
  for (const s of list) if (!seen.has(s.email)) seen.set(s.email, s);
  return [...seen.values()];
}

/**
 * Writes suppressions. An existing entry is kept (a MANUAL suppression or the
 * first reason stays), except that a complaint upgrades a bounce.
 */
export async function upsertSuppressions(pool: Pool, suppressions: readonly Suppression[]): Promise<number> {
  if (suppressions.length === 0) return 0;
  return workerTx(pool, async db => {
    const { rowCount } = await db.query(
      `INSERT INTO email_suppressions (email_lower, reason)
       SELECT e, r FROM unnest($1::text[], $2::text[]) AS t(e, r)
       ON CONFLICT (email_lower) DO UPDATE SET reason = EXCLUDED.reason
        WHERE email_suppressions.reason = 'BOUNCE' AND EXCLUDED.reason = 'COMPLAINT'`,
      [suppressions.map(s => s.email.toLowerCase()), suppressions.map(s => s.reason)],
    );
    return rowCount ?? 0;
  });
}

/** Handles one SQS body carrying SES feedback. Throws only on database errors (SQS retries). */
export async function handleSesMessage(body: string, deps: { pool: Pool; log: Logger }): Promise<SesFeedback> {
  const feedback = parseSesFeedback(body);
  if (feedback.kind === 'suppress') {
    const written = await upsertSuppressions(deps.pool, feedback.suppressions);
    deps.log.info('ses.suppressed', { feedbackType: feedback.feedbackType, recipients: feedback.suppressions.length, written });
  } else if (feedback.kind === 'ignore') {
    deps.log.info('ses.ignored', { feedbackType: feedback.feedbackType });
  } else {
    deps.log.warn('ses.unrecognised_message');
  }
  return feedback;
}
