/**
 * Reseller health for the manufacturer overview: reseller-level counts only, never customer data.
 */
export interface HealthReseller {
  id: string;
  name: string;
  status: 'ACTIVE' | 'SUSPENDED';
  saunasAssigned: number;
  saunasVisible: number;
  openRequests: number;
}
export interface HealthActivity {
  resellerId: string;
  requests: number;
  acceptedRequests: number;
}

export type HealthRow<R extends HealthReseller> = R & { requests: number; acceptedRequests: number };

/** Resellers joined with their activity in the period (0 when they had none). */
export function healthRows<R extends HealthReseller>(resellers: readonly R[], activity: readonly HealthActivity[]): HealthRow<R>[] {
  const by = new Map(activity.map(a => [a.resellerId, a]));
  return resellers.map(r => ({ ...r, requests: by.get(r.id)?.requests ?? 0, acceptedRequests: by.get(r.id)?.acceptedRequests ?? 0 }));
}

export type AttentionReason = 'NO_SAUNAS' | 'NO_VISIBLE_SAUNAS';
export interface AttentionItem { id: string; name: string; reason: AttentionReason }

/**
 * Active resellers whose storefront sells nothing: no sauna assigned (the manufacturer's to fix),
 * or saunas assigned but all hidden by the reseller. Suspended resellers are offline anyway.
 */
export function attentionItems(resellers: readonly HealthReseller[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const r of resellers) {
    if (r.status !== 'ACTIVE') continue;
    if (r.saunasAssigned === 0) out.push({ id: r.id, name: r.name, reason: 'NO_SAUNAS' });
    else if (r.saunasVisible === 0) out.push({ id: r.id, name: r.name, reason: 'NO_VISIBLE_SAUNAS' });
  }
  return out.sort((a, b) => (a.reason === b.reason ? a.name.localeCompare(b.name) : a.reason === 'NO_SAUNAS' ? -1 : 1));
}

export function statusCounts(resellers: readonly HealthReseller[]): { active: number; suspended: number } {
  let active = 0;
  for (const r of resellers) if (r.status === 'ACTIVE') active++;
  return { active, suspended: resellers.length - active };
}
