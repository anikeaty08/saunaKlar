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
 * Mirrors the `reserved_slugs` seed so the SPA does not even ask the API for
 * them; the database stays the authority.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  'www', 'api', 'admin', 'app', 'assets', 'static', 'cdn', 'media', 'img', 'images',
  'mail', 'email', 'smtp', 'imap', 'pop', 'ftp', 'ns1', 'ns2', 'dns', 'mx',
  'auth', 'login', 'account', 'accounts', 'id', 'sso', 'oauth',
  'dev', 'test', 'staging', 'stage', 'prod', 'preview', 'demo', 'beta', 'local', 'localhost',
  'help', 'support', 'status', 'docs', 'blog', 'billing', 'security', 'abuse', 'postmaster', 'webmaster',
  'manufacturer', 'platform', 'root', 'system', 'internal',
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
export function currentHost(): HostKind {
  return parseHost(window.location.host, hostConfig());
}

/** Absolute URL of a storefront, e.g. for the platform page's examples. */
export function storefrontUrl(slug: string, config: HostConfig = hostConfig()): string {
  const { protocol, port } = window.location;
  return `${protocol}//${slug}.${config.platformDomain}${port ? `:${port}` : ''}/`;
}
