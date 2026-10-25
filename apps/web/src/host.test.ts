import { describe, expect, it } from 'vitest';
import { parseHost } from './host.ts';

const local = { platformDomain: 'localhost', adminHost: 'admin.localhost' };
const prod = { platformDomain: 'saunaklar.com', adminHost: 'manufacturer.example.org' };

describe('parseHost (local)', () => {
  it('resolves a storefront from a single subdomain label, ignoring port and case', () => {
    expect(parseHost('alpha-spa.localhost:5173', local)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('Alpha-Spa.LOCALHOST', local)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('a.localhost', local)).toEqual({ kind: 'storefront', slug: 'a' });
    expect(parseHost(`${'a'.repeat(32)}.localhost`, local)).toEqual({ kind: 'storefront', slug: 'a'.repeat(32) });
  });

  it('resolves the manufacturer admin host before the storefront rule', () => {
    expect(parseHost('admin.localhost:5173', local)).toEqual({ kind: 'manufacturer' });
  });

  it('serves the platform page on the bare domain and www', () => {
    expect(parseHost('localhost:5173', local)).toEqual({ kind: 'platform', reason: 'root' });
    expect(parseHost('www.localhost', local)).toEqual({ kind: 'platform', reason: 'root' });
  });

  it('rejects reserved slugs', () => {
    expect(parseHost('api.localhost', local)).toEqual({ kind: 'platform', reason: 'reserved-slug', attempted: 'api' });
    expect(parseHost('status.localhost:5173', local)).toMatchObject({ kind: 'platform', reason: 'reserved-slug' });
  });

  it('rejects malformed slugs, nested subdomains and foreign hosts', () => {
    for (const h of ['-bad.localhost', 'bad-.localhost', 'under_score.localhost', `${'a'.repeat(33)}.localhost`,
      'x.alpha.localhost', '127.0.0.1:5173', 'evil-localhost', '', '[::1]:5173']) {
      expect(parseHost(h, local), h).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
    }
  });
});

describe('parseHost (production)', () => {
  it('uses the configured platform domain and admin host', () => {
    expect(parseHost('alpha-spa.saunaklar.com', prod)).toEqual({ kind: 'storefront', slug: 'alpha-spa' });
    expect(parseHost('manufacturer.example.org', prod)).toEqual({ kind: 'manufacturer' });
    expect(parseHost('saunaklar.com', prod)).toEqual({ kind: 'platform', reason: 'root' });
    expect(parseHost('admin.localhost', prod)).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
    expect(parseHost('alpha-spa.saunaklar.com.evil.io', prod)).toMatchObject({ kind: 'platform', reason: 'unknown-host' });
  });

  it('treats `admin` as reserved when the admin panel lives on another domain', () => {
    expect(parseHost('admin.saunaklar.com', prod)).toMatchObject({ kind: 'platform', reason: 'reserved-slug' });
  });
});
