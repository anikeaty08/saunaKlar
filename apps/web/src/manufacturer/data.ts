/**
 * Queries and mutations of the manufacturer admin. Keys all start with `m`,
 * so the persister (which stores only catalogue roots) never keeps them and a
 * sign-out clears them with the rest of the session data.
 */
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../api/client.ts';

export type ResellerSummary = ResponseOf<'mResellers'>['items'][number];
export type ResellerDetail = ResponseOf<'mReseller'>;
export type Assignment = ResponseOf<'mAssignments'>['items'][number];
export type SaunaSummary = ResponseOf<'mSaunas'>['items'][number];
export type SaunaDetail = ResponseOf<'mSauna'>;
export type Analytics = ResponseOf<'mAnalytics'>;
export type AuditEvent = ResponseOf<'mAudit'>['items'][number];

/** Currencies the platform prices in (reference data, migration 0010). */
export const CURRENCIES = ['EUR', 'CHF', 'SEK'] as const;

export const keys = {
  resellers: ['m', 'resellers'] as const,
  reseller: (id: string) => ['m', 'reseller', id] as const,
  assignments: (id: string) => ['m', 'assignments', id] as const,
  saunas: ['m', 'saunas'] as const,
  sauna: (id: string) => ['m', 'sauna', id] as const,
  analytics: (days: number) => ['m', 'analytics', days] as const,
  audit: (resellerId: string, entityType: string) => ['m', 'audit', resellerId, entityType] as const,
};

export const resellersQuery = queryOptions({ queryKey: keys.resellers, queryFn: ({ signal }) => api('mResellers', { signal }), staleTime: 30_000 });
export const saunasQuery = queryOptions({ queryKey: keys.saunas, queryFn: ({ signal }) => api('mSaunas', { signal }), staleTime: 30_000 });

export const useResellers = () => useQuery(resellersQuery);
export const useReseller = (id: string) => useQuery({ queryKey: keys.reseller(id), queryFn: ({ signal }) => api('mReseller', { params: { id }, signal }) });
export const useAssignments = (id: string) => useQuery({ queryKey: keys.assignments(id), queryFn: ({ signal }) => api('mAssignments', { params: { id }, signal }) });
export const useSaunas = () => useQuery(saunasQuery);
export const useSaunaDetail = (id: string) => useQuery({ queryKey: keys.sauna(id), queryFn: ({ signal }) => api('mSauna', { params: { id }, signal }) });
export const useAnalytics = (days: number) =>
  useQuery({ queryKey: keys.analytics(days), queryFn: ({ signal }) => api('mAnalytics', { query: { days }, signal }), placeholderData: prev => prev });

/** Writes a fresh reseller detail into the cache and patches its row in the list. */
export function useStoreReseller() {
  const qc = useQueryClient();
  return (r: ResellerDetail) => {
    qc.setQueryData<ResellerDetail>(keys.reseller(r.id), r);
    qc.setQueryData<ResponseOf<'mResellers'>>(keys.resellers, old => (old ? { items: old.items.map(x => (x.id === r.id ? { ...x, ...pickSummary(r) } : x)) } : old));
  };
}

function pickSummary(r: ResellerDetail): ResellerSummary {
  const { id, slug, name, currency, status, storefrontUrl, saunasAssigned, customers, openRequests, createdAt } = r;
  return { id, slug, name, currency, status, storefrontUrl, saunasAssigned, customers, openRequests, createdAt };
}

/** Toggles a sauna assignment with an optimistic flip; the server answer replaces it. */
export function useToggleAssignment(resellerId: string) {
  const qc = useQueryClient();
  const key = keys.assignments(resellerId);
  return useMutation({
    mutationFn: ({ saunaId, assign }: { saunaId: string; assign: boolean }) =>
      assign ? api('mAssign', { params: { id: resellerId, saunaId } }) : api('mUnassign', { params: { id: resellerId, saunaId } }),
    onMutate: async ({ saunaId, assign }) => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<ResponseOf<'mAssignments'>>(key);
      qc.setQueryData<ResponseOf<'mAssignments'>>(key, old => (old ? { items: old.items.map(a => (a.saunaModelId === saunaId ? { ...a, assigned: assign } : a)) } : old));
      return { prev };
    },
    onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.prev),
    onSuccess: data => {
      qc.setQueryData(key, data);
      void qc.invalidateQueries({ queryKey: keys.reseller(resellerId) });
      void qc.invalidateQueries({ queryKey: keys.resellers });
      void qc.invalidateQueries({ queryKey: keys.saunas });
    },
  });
}

type PriceEdit =
  | { kind: 'model'; currency: string; listPriceMinor: number; maxDiscountBps: number }
  | { kind: 'option'; currency: string; optionId: string; priceDeltaMinor: number };

/** Applies a price edit to a cached sauna detail (used for the optimistic update). */
export function applyPriceEdit(s: SaunaDetail, e: PriceEdit): SaunaDetail {
  if (e.kind === 'model') {
    const row = { currency: e.currency, listPriceMinor: e.listPriceMinor, maxDiscountBps: e.maxDiscountBps };
    const has = s.prices.some(p => p.currency === e.currency);
    return { ...s, prices: has ? s.prices.map(p => (p.currency === e.currency ? row : p)) : [...s.prices, row] };
  }
  return {
    ...s,
    groups: s.groups.map(g => ({
      ...g,
      options: g.options.map(o => {
        if (o.id !== e.optionId) return o;
        const row = { currency: e.currency, priceDeltaMinor: e.priceDeltaMinor };
        const has = o.prices.some(p => p.currency === e.currency);
        return { ...o, prices: has ? o.prices.map(p => (p.currency === e.currency ? row : p)) : [...o.prices, row] };
      }),
    })),
  };
}

/** Saves one price cell; the grid shows the new value at once and rolls back on error. */
export function useSavePrice(saunaId: string) {
  const qc = useQueryClient();
  const key = keys.sauna(saunaId);
  return useMutation({
    mutationFn: (e: PriceEdit) =>
      e.kind === 'model'
        ? api('mPutPrice', { params: { id: saunaId, currency: e.currency }, body: { listPriceMinor: e.listPriceMinor, maxDiscountBps: e.maxDiscountBps } })
        : api('mPutOptionPrice', { params: { id: saunaId, optionId: e.optionId, currency: e.currency }, body: { priceDeltaMinor: e.priceDeltaMinor } }),
    onMutate: async e => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<SaunaDetail>(key);
      if (prev) qc.setQueryData<SaunaDetail>(key, applyPriceEdit(prev, e));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(key, ctx.prev);
    },
    onSuccess: data => {
      qc.setQueryData(key, data);
      qc.setQueryData<ResponseOf<'mSaunas'>>(keys.saunas, old => (old ? { items: old.items.map(s => (s.id === data.id ? { ...s, prices: data.prices } : s)) } : old));
    },
  });
}
