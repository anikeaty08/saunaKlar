/**
 * TanStack Query hooks for the storefront. Catalogue queries are keyed by the
 * tenant's `catalogVersion`, so a version bump naturally invalidates them, and
 * a 409 STALE_CATALOG_VERSION (review C1) refetches the tenant and retries.
 */
import { QueryClient, queryOptions, useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query';
import { api, isApiError } from './client.ts';
import type { Tenant } from './types.ts';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        if (isApiError(err) && (err.status >= 400 && err.status < 500)) return false;
        return count < 2;
      },
    },
  },
});

/** Persisted to localStorage by `persist.ts`; only these key roots are stored. */
export const PERSISTED_ROOTS = new Set(['tenant', 'catalog', 'sauna', 'rooms']);

export const tenantQuery = queryOptions({
  queryKey: ['tenant'] as const,
  queryFn: ({ signal }) => api('tenant', { signal }),
  staleTime: 60_000,
});

/**
 * Runs a versioned catalogue request. On a 409 the tenant is refetched (it
 * holds the current version) and the request is retried once with it.
 */
async function versioned<T>(qc: QueryClient, run: (v: number) => Promise<T>): Promise<T> {
  const tenant = await qc.ensureQueryData(tenantQuery);
  try {
    return await run(tenant.catalogVersion);
  } catch (e) {
    if (!isApiError(e, 'STALE_CATALOG_VERSION')) throw e;
    const fresh = await qc.fetchQuery({ ...tenantQuery, staleTime: 0 });
    return run(fresh.catalogVersion);
  }
}

export const catalogQuery = (qc: QueryClient, version: number | undefined) =>
  queryOptions({
    queryKey: ['catalog', version ?? 0] as const,
    queryFn: ({ signal }) => versioned(qc, v => api('catalog', { query: { v }, signal })),
    staleTime: Infinity,
    enabled: version !== undefined,
  });

export const saunaQuery = (qc: QueryClient, version: number | undefined, slug: string) =>
  queryOptions({
    queryKey: ['sauna', version ?? 0, slug] as const,
    queryFn: ({ signal }) => versioned(qc, v => api('sauna', { params: { slug }, query: { v }, signal })),
    staleTime: Infinity,
    enabled: version !== undefined,
  });

export const roomsQuery = (qc: QueryClient, version: number | undefined) =>
  queryOptions({
    queryKey: ['rooms', version ?? 0] as const,
    queryFn: ({ signal }) => versioned(qc, v => api('rooms', { query: { v }, signal })),
    staleTime: Infinity,
    enabled: version !== undefined,
  });

export const sessionQuery = queryOptions({
  queryKey: ['session'] as const,
  queryFn: ({ signal }) => api('session', { signal }),
  staleTime: 5 * 60_000,
});

// ---- hooks --------------------------------------------------------------------------------

export function useTenant() {
  return useQuery(tenantQuery);
}

/** For components inside the storefront shell, which only renders once the tenant loaded. */
export function useTenantData(): Tenant {
  return useSuspenseQuery(tenantQuery).data;
}

export function useCatalog() {
  const qc = useQueryClient();
  const tenant = useTenant().data;
  return useQuery(catalogQuery(qc, tenant?.catalogVersion));
}

export function useSauna(slug: string) {
  const qc = useQueryClient();
  const tenant = useTenant().data;
  return useQuery(saunaQuery(qc, tenant?.catalogVersion, slug));
}

export function useRooms() {
  const qc = useQueryClient();
  const tenant = useTenant().data;
  return useQuery(roomsQuery(qc, tenant?.catalogVersion));
}

export function useSession() {
  return useQuery(sessionQuery);
}

/** Prefetch for link hover/focus: route data is ready by the time the chunk is. */
export async function prefetchSauna(qc: QueryClient, slug: string): Promise<void> {
  const tenant = qc.getQueryData(tenantQuery.queryKey);
  if (!tenant) return;
  await qc.prefetchQuery(saunaQuery(qc, tenant.catalogVersion, slug));
}

export async function prefetchCatalog(qc: QueryClient): Promise<void> {
  const tenant = qc.getQueryData(tenantQuery.queryKey);
  if (!tenant) return;
  await qc.prefetchQuery(catalogQuery(qc, tenant.catalogVersion));
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('logout'),
    onSettled: async () => {
      qc.removeQueries({ predicate: q => !PERSISTED_ROOTS.has(String(q.queryKey[0])) });
      await qc.invalidateQueries({ queryKey: sessionQuery.queryKey });
    },
  });
}
