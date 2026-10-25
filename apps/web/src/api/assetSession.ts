import { useEffect, useState } from 'react';
import { api } from './client.ts';
import { useSession } from './queries.ts';

/**
 * Signed CloudFront cookies for `/assets/lo|hi/*` (design 10.4). The API sets
 * them on POST /api/assets/session: LOW for visitors, FULL for customers and
 * share-link viewers. Issued once per principal, renewed a minute before they
 * expire, re-issued after sign-in/out and after a 403 on a model.
 */
interface Issued {
  key: string;
  promise: Promise<void>;
  expiresAt: number;
  timer?: number;
}

let issued: Issued | null = null;
const RENEW_MS = 60_000;

export function ensureAssetSession(key: string, shareToken?: string): Promise<void> {
  const fullKey = `${key}|${shareToken ?? ''}`;
  if (issued && issued.key === fullKey && (issued.expiresAt === 0 || issued.expiresAt - Date.now() > RENEW_MS)) return issued.promise;
  if (issued?.timer) window.clearTimeout(issued.timer);
  const entry: Issued = { key: fullKey, expiresAt: 0, promise: Promise.resolve() };
  entry.promise = api('assetSession', { body: shareToken ? { shareToken } : {} })
    .then(r => {
      entry.expiresAt = Date.parse(r.expiresAt);
      const wait = Math.max(5_000, entry.expiresAt - Date.now() - RENEW_MS);
      entry.timer = window.setTimeout(() => {
        if (issued === entry) void ensureAssetSession(key, shareToken);
      }, wait);
    })
    .catch(() => {
      // Models may still be public (e.g. local dev); let the loader try, and retry next time.
      if (issued === entry) issued = null;
    });
  issued = entry;
  return entry.promise;
}

/** Forget the cookies so the next load asks again (after a 403). */
export function invalidateAssetSession(): void {
  if (issued?.timer) window.clearTimeout(issued.timer);
  issued = null;
}

/** True once the asset cookies for the current principal are in place. */
export function useAssetSession(enabled: boolean, shareToken?: string): boolean {
  const session = useSession();
  const s = session.data;
  const key = !s ? '' : s.kind === 'customer' ? `c:${s.customer.id}` : s.kind === 'staff' ? `s:${s.staff.id}` : 'anon';
  const [readyKey, setReadyKey] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let live = true;
    void ensureAssetSession(key, shareToken).then(() => live && setReadyKey(key));
    return () => {
      live = false;
    };
  }, [enabled, key, shareToken]);
  return readyKey === key && key !== '';
}
