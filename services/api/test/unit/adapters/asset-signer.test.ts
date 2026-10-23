import { generateKeyPairSync, createVerify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CloudFrontAssetSigner } from '../../../src/adapters/assets/cloudfront.ts';
import { LocalAssetSigner, verifyLocalAssetRequest } from '../../../src/adapters/assets/local.ts';
import { cfBase64, cfBase64Decode, resourceMatches } from '../../../src/adapters/assets/policy.ts';
import type { SignedCookie } from '../../../src/adapters/types.ts';

const SECRET = 'test-asset-secret-0123456789abcdefghijkl';
const signer = new LocalAssetSigner({ secret: SECRET });
const jar = (cookies: SignedCookie[]) => Object.fromEntries(cookies.map((c) => [c.name, c.value]));
const verify = (host: string, path: string, cookies?: Record<string, string>, now?: Date) =>
  verifyLocalAssetRequest(SECRET, { host, path, ...(cookies ? { cookies } : {}), ...(now ? { now } : {}) });

describe('LocalAssetSigner cookies', () => {
  it('issues the three CloudFront cookie names with safe attributes', async () => {
    const { cookies, expiresAt } = await signer.issueCookies({ host: 'alpha.localhost:5173', tier: 'LOW', ttlSeconds: 600 });
    expect(cookies.map((c) => c.name)).toEqual(['CloudFront-Policy', 'CloudFront-Signature', 'CloudFront-Key-Pair-Id']);
    for (const c of cookies) {
      expect(c.attributes).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Lax', path: '/assets', maxAge: 600 });
      expect(c.value).toMatch(/^[A-Za-z0-9\-_~]+$/);
    }
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 590_000);
    const policy = JSON.parse(cfBase64Decode(jar(cookies)['CloudFront-Policy']!).toString());
    expect(policy.Statement[0].Resource).toBe('https://alpha.localhost:5173/assets/lo/*');
  });

  it('LOW opens /assets/lo/* but not /assets/hi/*', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'LOW', ttlSeconds: 600 });
    expect(verify('alpha.localhost', '/assets/lo/abc-123.glb', jar(cookies))).toBe(true);
    expect(verify('alpha.localhost', '/assets/hi/abc-123.glb', jar(cookies))).toBe(false);
  });

  it('FULL opens every asset path', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'FULL', ttlSeconds: 600 });
    expect(verify('alpha.localhost', '/assets/hi/abc.glb', jar(cookies))).toBe(true);
    expect(verify('alpha.localhost', '/assets/lo/abc.glb', jar(cookies))).toBe(true);
  });

  it('cookies for host a do not work on host b (review G2)', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'FULL', ttlSeconds: 600 });
    expect(verify('beta.localhost', '/assets/hi/abc.glb', jar(cookies))).toBe(false);
    expect(verify('alpha.localhost.evil.com', '/assets/hi/abc.glb', jar(cookies))).toBe(false);
  });

  it('expired cookies fail', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'FULL', ttlSeconds: 60 });
    expect(verify('alpha.localhost', '/assets/hi/a.glb', jar(cookies), new Date(Date.now() + 61_000))).toBe(false);
  });

  it('tampered policy or signature fails', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'LOW', ttlSeconds: 600 });
    const c = jar(cookies);
    const policy = JSON.parse(cfBase64Decode(c['CloudFront-Policy']!).toString());
    policy.Statement[0].Resource = 'https://alpha.localhost/assets/*';
    expect(verify('alpha.localhost', '/assets/hi/a.glb', { ...c, 'CloudFront-Policy': cfBase64(JSON.stringify(policy)) })).toBe(false);
    const sig = c['CloudFront-Signature']!;
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    expect(verify('alpha.localhost', '/assets/lo/a.glb', { ...c, 'CloudFront-Signature': flipped })).toBe(false);
    expect(verify('alpha.localhost', '/assets/lo/a.glb', { ...c, 'CloudFront-Key-Pair-Id': 'OTHER' })).toBe(false);
    expect(verifyLocalAssetRequest('another-secret-0123456789abcdefghijkl', { host: 'alpha.localhost', path: '/assets/lo/a.glb', cookies: c })).toBe(false);
  });

  it('rejects traversal out of the low tier and missing cookies', async () => {
    const { cookies } = await signer.issueCookies({ host: 'alpha.localhost', tier: 'LOW', ttlSeconds: 600 });
    expect(verify('alpha.localhost', '/assets/lo/../hi/a.glb', jar(cookies))).toBe(false);
    expect(verify('alpha.localhost', '/assets/lo/%2e%2e/hi/a.glb', jar(cookies))).toBe(false);
    expect(verify('alpha.localhost', '/assets/lo/a.glb', {})).toBe(false);
  });

  it('refuses hosts and TTLs that are not well-formed', async () => {
    await expect(signer.issueCookies({ host: 'a.localhost/*', tier: 'LOW', ttlSeconds: 600 })).rejects.toThrow();
    await expect(signer.issueCookies({ host: 'a.localhost', tier: 'LOW', ttlSeconds: 0 })).rejects.toThrow();
  });
});

describe('LocalAssetSigner signed URLs', () => {
  it('signs exactly one file', async () => {
    const { url } = await signer.signUrl({ host: 'alpha.localhost:5173', path: '/assets/ar/model-1.usdz', ttlSeconds: 300 });
    const u = new URL(url);
    expect(u.protocol).toBe('https:');
    expect([...u.searchParams.keys()]).toEqual(['Policy', 'Signature', 'Key-Pair-Id']);
    const ok = (path: string, host = 'alpha.localhost:5173') => verifyLocalAssetRequest(SECRET, { host, path, query: u.searchParams });
    expect(ok('/assets/ar/model-1.usdz')).toBe(true);
    expect(ok('/assets/ar/model-2.usdz')).toBe(false);
    expect(ok('/assets/ar/model-1.usdz', 'beta.localhost:5173')).toBe(false);
  });
});

describe('policy wildcard matching', () => {
  it('follows CloudFront semantics', () => {
    expect(resourceMatches('https://a.ch/assets/lo/*', 'https://a.ch/assets/lo/x/y.glb')).toBe(true);
    expect(resourceMatches('https://a.ch/assets/lo/*', 'https://a.ch/assets/low/x.glb')).toBe(false);
    expect(resourceMatches('https://a.ch/assets/?.glb', 'https://a.ch/assets/x.glb')).toBe(true);
    expect(resourceMatches('https://a.ch/assets/*', 'https://aXch/assets/x')).toBe(false);
  });
});

describe('CloudFrontAssetSigner', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

  it('signs a host-bound custom policy with RSA', async () => {
    const cf = new CloudFrontAssetSigner({ keyPairId: 'K2ABC', privateKey: async () => pem });
    const { cookies } = await cf.issueCookies({ host: 'alpha.saunas.example.com', tier: 'LOW', ttlSeconds: 600 });
    const c = jar(cookies);
    expect(c['CloudFront-Key-Pair-Id']).toBe('K2ABC');
    const policyJson = cfBase64Decode(c['CloudFront-Policy']!).toString();
    expect(JSON.parse(policyJson).Statement[0].Resource).toBe('https://alpha.saunas.example.com/assets/lo/*');
    const v = createVerify('RSA-SHA1');
    v.update(policyJson);
    expect(v.verify(publicKey, cfBase64Decode(c['CloudFront-Signature']!))).toBe(true);
  });

  it('signs AR URLs for exactly one file', async () => {
    const cf = new CloudFrontAssetSigner({ keyPairId: 'K2ABC', privateKey: pem });
    const { url } = await cf.signUrl({ host: 'alpha.saunas.example.com', path: '/assets/ar/m.glb', ttlSeconds: 300 });
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://alpha.saunas.example.com/assets/ar/m.glb');
    const policy = JSON.parse(cfBase64Decode(u.searchParams.get('Policy')!).toString());
    expect(policy.Statement[0].Resource).toBe('https://alpha.saunas.example.com/assets/ar/m.glb');
    expect(u.searchParams.get('Key-Pair-Id')).toBe('K2ABC');
  });
});
