import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AssetSigner, AssetTier, SignedCookie } from '../types.ts';
import {
  assertAssetPath,
  assertHost,
  assertTtl,
  buildPolicy,
  cfBase64,
  cfBase64Decode,
  cookieList,
  resourceMatches,
  tierResource,
} from './policy.ts';

export const LOCAL_KEY_PAIR_ID = 'LOCALDEVKEY';

export interface LocalAssetSignerConfig {
  /** HMAC secret shared with the local edge emulator (>= 32 bytes). */
  secret: string;
  /** Scheme of URLs returned by signUrl; the policy itself always says https. */
  urlScheme?: 'http' | 'https';
  /** `Secure` attribute on cookies; browsers accept it on http://*.localhost. */
  secureCookies?: boolean;
}

const sign = (secret: string, policyB64: string): string => cfBase64(createHmac('sha256', secret).update(policyB64).digest());

/**
 * Same cookie/URL shapes as CloudFront, signed with HMAC-SHA256 instead of RSA, so the
 * browser and the API behave identically locally and the local edge can enforce them.
 */
export class LocalAssetSigner implements AssetSigner {
  constructor(private readonly config: LocalAssetSignerConfig) {
    if (Buffer.byteLength(config.secret) < 32) throw new Error('Local asset signing secret must be at least 32 bytes');
  }

  async issueCookies(input: { host: string; tier: AssetTier; ttlSeconds: number }): Promise<{ cookies: SignedCookie[]; expiresAt: Date }> {
    assertTtl(input.ttlSeconds);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const policy = cfBase64(JSON.stringify(buildPolicy(tierResource(input.host, input.tier), expiresAt)));
    const cookies = cookieList(
      { 'CloudFront-Policy': policy, 'CloudFront-Signature': sign(this.config.secret, policy), 'CloudFront-Key-Pair-Id': LOCAL_KEY_PAIR_ID },
      expiresAt,
      input.ttlSeconds,
      this.config.secureCookies ?? true,
    );
    return { cookies, expiresAt };
  }

  async signUrl(input: { host: string; path: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: Date }> {
    assertTtl(input.ttlSeconds);
    const host = assertHost(input.host);
    const path = assertAssetPath(input.path);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const policy = cfBase64(JSON.stringify(buildPolicy(`https://${host}${path}`, expiresAt)));
    const query = new URLSearchParams({ Policy: policy, Signature: sign(this.config.secret, policy), 'Key-Pair-Id': LOCAL_KEY_PAIR_ID });
    return { url: `${this.config.urlScheme ?? 'https'}://${host}${path}?${query.toString()}`, expiresAt };
  }
}

export interface LocalAssetRequest {
  host: string;
  /** Request path without the query string, e.g. `/assets/hi/abc.glb`. */
  path: string;
  cookies?: Record<string, string | undefined>;
  query?: URLSearchParams | Record<string, string | undefined>;
  now?: Date;
}

/**
 * The local edge's check, mirroring CloudFront: a signed URL (query) or signed cookies must
 * carry a valid signature, an unexpired policy, and a Resource matching `https://{host}{path}`.
 */
export function verifyLocalAssetRequest(secret: string, req: LocalAssetRequest): boolean {
  const q = req.query instanceof URLSearchParams ? Object.fromEntries(req.query) : (req.query ?? {});
  const fromQuery = q.Policy !== undefined || q.Signature !== undefined;
  const policyB64 = fromQuery ? q.Policy : req.cookies?.['CloudFront-Policy'];
  const signature = fromQuery ? q.Signature : req.cookies?.['CloudFront-Signature'];
  const keyPairId = fromQuery ? q['Key-Pair-Id'] : req.cookies?.['CloudFront-Key-Pair-Id'];
  if (!policyB64 || !signature || keyPairId !== LOCAL_KEY_PAIR_ID) return false;

  const expected = Buffer.from(sign(secret, policyB64));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;

  let host: string;
  let path: string;
  try {
    host = assertHost(req.host);
    path = assertAssetPath(req.path);
  } catch {
    return false;
  }

  try {
    const policy = JSON.parse(cfBase64Decode(policyB64).toString('utf8')) as {
      Statement?: { Resource?: unknown; Condition?: { DateLessThan?: { 'AWS:EpochTime'?: unknown } } }[];
    };
    const statement = policy.Statement?.[0];
    const resource = statement?.Resource;
    const epoch = statement?.Condition?.DateLessThan?.['AWS:EpochTime'];
    if (typeof resource !== 'string' || typeof epoch !== 'number') return false;
    const now = Math.floor((req.now ?? new Date()).getTime() / 1000);
    if (now >= epoch) return false;
    return resourceMatches(resource, `https://${host}${path}`);
  } catch {
    return false;
  }
}
