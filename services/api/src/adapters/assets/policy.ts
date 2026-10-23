import type { AssetTier, SignedCookie } from '../types.ts';

/** Hosts look like `alpha.example.com` or `alpha.localhost:5173`; nothing else may reach a policy. */
const HOST_RE = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/;

export function assertHost(host: string): string {
  const h = host.toLowerCase();
  if (!HOST_RE.test(h)) throw new Error('Invalid host for asset policy');
  return h;
}

/** Asset paths are `/assets/...` with safe characters only (no traversal, query or wildcard). */
export function assertAssetPath(path: string): string {
  if (!/^\/assets\/[A-Za-z0-9._~\-/]+$/.test(path) || /(^|\/)\.\.?(\/|$)/.test(path) || path.includes('//')) {
    throw new Error('Invalid asset path');
  }
  return path;
}

export const tierResource = (host: string, tier: AssetTier): string =>
  `https://${assertHost(host)}/assets/${tier === 'LOW' ? 'lo/*' : '*'}`;

export interface CustomPolicy {
  Statement: [{ Resource: string; Condition: { DateLessThan: { 'AWS:EpochTime': number } } }];
}

export const buildPolicy = (resource: string, expiresAt: Date): CustomPolicy => ({
  Statement: [{ Resource: resource, Condition: { DateLessThan: { 'AWS:EpochTime': Math.floor(expiresAt.getTime() / 1000) } } }],
});

/** CloudFront's URL/cookie-safe base64: `+`→`-`, `=`→`_`, `/`→`~`. */
export const cfBase64 = (data: Buffer | string): string =>
  Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/=/g, '_').replace(/\//g, '~');

export const cfBase64Decode = (value: string): Buffer =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '=').replace(/~/g, '/'), 'base64');

/** CloudFront wildcard match: `*` any run of characters, `?` exactly one. */
export function resourceMatches(pattern: string, url: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${re}$`).test(url);
}

export function cookieList(
  values: Record<SignedCookie['name'], string>,
  expiresAt: Date,
  ttlSeconds: number,
  secure: boolean,
): SignedCookie[] {
  const attributes = { path: '/assets', httpOnly: true as const, secure, sameSite: 'Lax' as const, maxAge: ttlSeconds, expires: expiresAt };
  return (['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id'] as const).map((name) => ({
    name,
    value: values[name],
    attributes: { ...attributes },
  }));
}

export function assertTtl(ttlSeconds: number): void {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 24 * 3600) throw new Error('Invalid TTL');
}
