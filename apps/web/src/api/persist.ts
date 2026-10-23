/**
 * Local caching of catalogue data (design 11/12): queries under the persisted
 * roots are written to localStorage per tenant host. Keys include the
 * `catalogVersion`, so a price change produces new keys and old entries simply
 * age out. Customer data is never persisted.
 */
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';
import { PERSISTED_ROOTS, queryClient } from './queries.ts';

/** Bump when the cached shapes change incompatibly. */
const BUSTER = 'v1';

function safeStorage(): Storage | undefined {
  try {
    const s = window.localStorage;
    const k = '__sk_probe';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return undefined;
  }
}

export function persistOptions(): Omit<PersistQueryClientOptions, 'queryClient'> | null {
  const storage = safeStorage();
  if (!storage) return null;
  const persister = createSyncStoragePersister({
    storage,
    key: `saunaklar:query:${window.location.host}`,
    throttleTime: 1000,
  });
  return {
    persister,
    maxAge: 7 * 24 * 60 * 60_000,
    buster: BUSTER,
    dehydrateOptions: {
      shouldDehydrateQuery: q => q.state.status === 'success' && PERSISTED_ROOTS.has(String(q.queryKey[0])),
    },
  };
}

export { queryClient };
