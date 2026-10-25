/**
 * Host → tenant parsing (design 5.1). The tenant comes ONLY from the Host
 * header, validated against the slug pattern, never from a parameter.
 */

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export type HostKind =
  | { kind: 'storefront'; slug: string }
  | { kind: 'manufacturer' }
  | { kind: 'platform' }
  | { kind: 'unknown' };

export interface HostConfig {
  /** e.g. `saunas.example.com`, or `localhost` in development. */
  platformDomain: string;
  /** Host of the manufacturer admin, e.g. `admin.example-admin.com` or `admin.localhost`. */
  adminHost: string;
}

/** Lower-cases and strips the port. Returns null for anything that is not a plain hostname. */
export function normaliseHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase().replace(/:\d{1,5}$/, '');
  if (!/^[a-z0-9.-]{1,253}$/.test(host) || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  return host;
}

export function parseHost(raw: string | null | undefined, cfg: HostConfig): HostKind {
  const host = normaliseHost(raw);
  if (!host) return { kind: 'unknown' };
  const admin = normaliseHost(cfg.adminHost);
  const domain = normaliseHost(cfg.platformDomain);
  if (host === admin) return { kind: 'manufacturer' };
  if (!domain) return { kind: 'unknown' };
  if (host === domain || host === `www.${domain}`) return { kind: 'platform' };
  const suffix = `.${domain}`;
  if (!host.endsWith(suffix)) return { kind: 'unknown' };
  const slug = host.slice(0, -suffix.length);
  // Exactly one label: `a.b.domain` is not a tenant.
  if (!SLUG_PATTERN.test(slug)) return { kind: 'unknown' };
  return { kind: 'storefront', slug };
}

export function storefrontHost(slug: string, cfg: HostConfig): string {
  return `${slug}.${cfg.platformDomain}`;
}
