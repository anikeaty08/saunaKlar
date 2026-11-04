/**
 * Which app does this host serve? The tenant comes only from the Host header
 * (design 5.1), so the SPA makes the same decision as the API, using the
 * shared parser from `@saunaklar/shared`:
 *
 *   {slug}.<platform-domain>  → reseller storefront
 *   <admin-host>              → manufacturer admin
 *   <platform-domain>, www.   → platform landing page
 *
 * Anything else (an IP, a nested subdomain, an invalid or reserved slug) is
 * answered by the platform page, which explains that no storefront lives there.
 */
import { parseHost as parseSharedHost, normaliseHost, type HostConfig } from '@saunaklar/shared';

export type { HostConfig };

export type HostKind =
  | { kind: 'storefront'; slug: string }
  | { kind: 'manufacturer' }
  | { kind: 'platform'; reason: 'root' | 'unknown-host' | 'reserved-slug'; attempted?: string };

/**
 * Exactly the `reserved_slugs` seed (packages/db/migrations/0010_reference_data.sql) so the SPA does not even ask the API for
 * them; the database stays the authority.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'api', 'admin', 'app', 'assets', 'static', 'cdn', 'mail', 'smtp',
  'help', 'support', 'status', 'docs', 'blog', 'dev', 'staging', 'test',
]);

export function parseHost(host: string, config: HostConfig): HostKind {
  const parsed = parseSharedHost(host, config);
  switch (parsed.kind) {
    case 'manufacturer':
      return parsed;
    case 'platform':
      return { kind: 'platform', reason: 'root' };
    case 'storefront':
      return RESERVED_SLUGS.has(parsed.slug)
        ? { kind: 'platform', reason: 'reserved-slug', attempted: parsed.slug }
        : parsed;
    default: {
      const attempted = normaliseHost(host) ?? undefined;
      return attempted ? { kind: 'platform', reason: 'unknown-host', attempted } : { kind: 'platform', reason: 'unknown-host' };
    }
  }
}

export function hostConfig(): HostConfig {
  return {
    platformDomain: import.meta.env.VITE_PLATFORM_DOMAIN || 'localhost',
    adminHost: import.meta.env.VITE_ADMIN_HOST || 'admin.localhost',
  };
}

/** The current window's host, parsed once per page load. */
let cached: HostKind | undefined;

export function currentHost(): HostKind {
  return (cached ??= readHost());
}

function readHost(): HostKind {
  if (import.meta.env.VITE_PREVIEW === '1') return previewHost();
  // Local testing: browsers that do not resolve *.localhost can still open a
  // shop with http://localhost:5173/?shop=nordic (or ?app=admin, ?app=platform).
  // The choice is kept for the tab, so links and reloads stay in that shop.
  if (import.meta.env.DEV && window.location.hostname === 'localhost') {
    let search = window.location.search;
    try {
      if (/[?&](shop|app)=/.test(search)) sessionStorage.setItem('dev-host', search);
      else search = sessionStorage.getItem('dev-host') ?? '';
    } catch { /* storage blocked: query only */ }
    if (/[?&](shop|app)=/.test(search)) return previewHost(search);
  }
  return parseHost(window.location.host, hostConfig());
}

/**
 * The static preview build has no subdomains: `?app=admin` opens the
 * manufacturer admin, `?app=platform` the platform page, and `?shop=<slug>`
 * a storefront (the first example shop by default).
 */
function previewHost(search = window.location.search): HostKind {
  const q = new URLSearchParams(search);
  if (q.get('app') === 'admin') return { kind: 'manufacturer' };
  if (q.get('app') === 'platform') return { kind: 'platform', reason: 'root' };
  return { kind: 'storefront', slug: q.get('shop') || 'nordic' };
}

/** Absolute URL of a storefront, e.g. for the platform page's examples. */
export function storefrontUrl(slug: string, config: HostConfig = hostConfig()): string {
  if (import.meta.env.VITE_PREVIEW === '1') return `${window.location.pathname}?shop=${slug}#/`;
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${config.platformDomain}${port ? `:${port}` : ''}/`;
}
