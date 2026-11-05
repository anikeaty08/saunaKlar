import type { RequestStatus } from '@saunaklar/shared';

const DAY = 86_400_000;

/** A quote counts as "expiring soon" this many days before its valid-until. */
export const EXPIRY_SOON_DAYS = 3;

export interface InboxSource {
  id: string;
  status: RequestStatus;
  createdAt: string;
  updatedAt: string;
  quoteValidUntil?: string | null;
}

export type InboxReason = 'NEW' | 'IN_REVIEW' | 'QUOTE_EXPIRING' | 'QUOTE_EXPIRED';
export type InboxItem<T extends InboxSource> = T & { reason: InboxReason };

/**
 * The reseller's to-do list: quotes about to lapse (soonest first; already lapsed ones too, as
 * they need a new quote or a decision), then new requests (oldest first: they have waited
 * longest), then requests in review (least recently touched first). Other statuses and quotes
 * with time left are left out.
 */
export function buildInbox<T extends InboxSource>(requests: readonly T[], now: Date, soonDays = EXPIRY_SOON_DAYS): InboxItem<T>[] {
  const seen = new Set<string>();
  const quotes: InboxItem<T>[] = [];
  const fresh: InboxItem<T>[] = [];
  const review: InboxItem<T>[] = [];
  for (const r of requests) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (r.status === 'SUBMITTED') fresh.push({ ...r, reason: 'NEW' });
    else if (r.status === 'IN_REVIEW') review.push({ ...r, reason: 'IN_REVIEW' });
    else if (r.status === 'QUOTED' && r.quoteValidUntil) {
      const left = new Date(r.quoteValidUntil).getTime() - now.getTime();
      if (left <= 0) quotes.push({ ...r, reason: 'QUOTE_EXPIRED' });
      else if (left <= soonDays * DAY) quotes.push({ ...r, reason: 'QUOTE_EXPIRING' });
    }
  }
  const by = (k: (x: InboxItem<T>) => string) => (a: InboxItem<T>, b: InboxItem<T>) => k(a).localeCompare(k(b));
  quotes.sort(by(x => x.quoteValidUntil!));
  fresh.sort(by(x => x.createdAt));
  review.sort(by(x => x.updatedAt));
  return [...quotes, ...fresh, ...review];
}

/** Requests that are still with the reseller or the customer (not accepted, not ended). */
export const OPEN_STATUSES: readonly RequestStatus[] = ['SUBMITTED', 'IN_REVIEW', 'QUOTED'];

export const openCount = (byStatus: Partial<Record<string, number>>): number => OPEN_STATUSES.reduce((n, s) => n + (byStatus[s] ?? 0), 0);
