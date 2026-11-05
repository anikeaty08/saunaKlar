import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.ts';

const prod = {
  NODE_ENV: 'production', APP_SECRET: 'x'.repeat(40), ORIGIN_SECRET: 'o'.repeat(20), PUBLIC_SCHEME: 'https',
  PLATFORM_DOMAIN: 'saunas.example.com', ADMIN_HOST: 'admin.saunas.example.com', ADAPTERS: 'aws',
};

describe('loadConfig in production', () => {
  it('accepts a complete config', () => {
    expect(loadConfig(prod).NODE_ENV).toBe('production');
  });
  it.each([
    ['APP_SECRET', { APP_SECRET: 'short-secret-1234567' }],
    ['PUBLIC_SCHEME', { PUBLIC_SCHEME: 'http' }],
    ['PLATFORM_DOMAIN', { PLATFORM_DOMAIN: 'localhost' }],
    ['API_DATABASE_URL', { ADAPTERS: 'local' }],
    ['ORIGIN_SECRET', { ORIGIN_SECRET: '' }],
  ])('rejects bad %s', (name, over) => {
    expect(() => loadConfig({ ...prod, ...over })).toThrow(name);
  });
});
