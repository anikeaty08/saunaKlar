import { matchPath } from 'react-router';
import { pages, type PageName } from './pages.ts';
import { prefetchCatalog, prefetchSauna, queryClient } from '../api/queries.ts';
import { prefersSaveData } from '../motion/preferences.ts';

const table: { pattern: string; page: PageName; data?: (params: Record<string, string | undefined>) => Promise<void> }[] = [
  { pattern: '/', page: 'home', data: () => prefetchCatalog(queryClient) },
  { pattern: '/saunas', page: 'saunas', data: () => prefetchCatalog(queryClient) },
  { pattern: '/saunas/:slug', page: 'sauna', data: p => prefetchSauna(queryClient, p.slug!) },
  { pattern: '/saunas/:slug/configure', page: 'configure', data: p => prefetchSauna(queryClient, p.slug!) },
  { pattern: '/showroom', page: 'showroom', data: () => prefetchCatalog(queryClient) },
  { pattern: '/guide', page: 'guide' },
  { pattern: '/how-it-works', page: 'how' },
  { pattern: '/about', page: 'about' },
  { pattern: '/faq', page: 'faq' },
  { pattern: '/contact', page: 'contact' },
  { pattern: '/legal/:doc', page: 'legal' },
  { pattern: '/account/*', page: 'account' },
  { pattern: '/account', page: 'account' },
];

const AUTH = /^\/account\/(login|signup|verify|forgot|reset)$/;
const done = new Set<string>();

/** Warms the route chunk and its data. Cheap to call repeatedly; skipped with data saver. */
export function prefetchPath(href: string): void {
  if (prefersSaveData()) return;
  const path = href.split(/[?#]/)[0] || '/';
  if (done.has(path)) return;
  done.add(path);
  if (AUTH.test(path)) {
    void pages.auth().catch(() => done.delete(path));
    return;
  }
  for (const r of table) {
    const m = matchPath(r.pattern, path);
    if (!m) continue;
    void pages[r.page]().catch(() => done.delete(path));
    void r.data?.(m.params).catch(() => undefined);
    return;
  }
}
