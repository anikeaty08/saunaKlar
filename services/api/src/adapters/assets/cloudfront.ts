import { getSignedCookies, getSignedUrl } from '@aws-sdk/cloudfront-signer';
import type { AssetSigner, AssetTier, SignedCookie } from '../types.ts';
import { assertAssetPath, assertHost, assertTtl, buildPolicy, cookieList, tierResource } from './policy.ts';

export interface CloudFrontAssetSignerConfig {
  keyPairId: string;
  /** PEM, or a loader (e.g. from Secrets Manager) called once and cached. */
  privateKey: string | (() => Promise<string>);
}

/** CloudFront signed cookies/URLs with a custom policy bound to the reseller host (review G2). */
export class CloudFrontAssetSigner implements AssetSigner {
  private key: Promise<string> | undefined;

  constructor(private readonly config: CloudFrontAssetSignerConfig) {}

  private privateKey(): Promise<string> {
    const source = this.config.privateKey;
    this.key ??= typeof source === 'string' ? Promise.resolve(source) : source();
    // A failed load is retried on the next call instead of being cached forever.
    this.key.catch(() => (this.key = undefined));
    return this.key;
  }

  async issueCookies(input: { host: string; tier: AssetTier; ttlSeconds: number }): Promise<{ cookies: SignedCookie[]; expiresAt: Date }> {
    assertTtl(input.ttlSeconds);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const signed = getSignedCookies({
      keyPairId: this.config.keyPairId,
      privateKey: await this.privateKey(),
      policy: JSON.stringify(buildPolicy(tierResource(input.host, input.tier), expiresAt)),
    });
    const policy = signed['CloudFront-Policy'];
    if (!policy) throw new Error('CloudFront signer returned no policy');
    const cookies = cookieList(
      { 'CloudFront-Policy': policy, 'CloudFront-Signature': signed['CloudFront-Signature'], 'CloudFront-Key-Pair-Id': signed['CloudFront-Key-Pair-Id'] },
      expiresAt,
      input.ttlSeconds,
      true,
    );
    return { cookies, expiresAt };
  }

  async signUrl(input: { host: string; path: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: Date }> {
    assertTtl(input.ttlSeconds);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const url = `https://${assertHost(input.host)}${assertAssetPath(input.path)}`;
    const signed = getSignedUrl({
      url,
      keyPairId: this.config.keyPairId,
      privateKey: await this.privateKey(),
      policy: JSON.stringify(buildPolicy(url, expiresAt)),
    });
    return { url: signed, expiresAt };
  }
}
