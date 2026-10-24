/**
 * Wiring checks that need no SPA page: the server runs against the seeded database, the tenant
 * comes from the Host header, and the catalogue is localised. They run through Chromium.
 */
import { ADMIN, ALPHA, SEED_SHARE_TOKEN, expect, getJson, hostUrl, test } from './fixtures.ts';

interface Tenant { slug: string; currency: string; branding: { displayName: string; primaryColor: string } }
interface Catalog { currency: string; items: { slug: string; name: string }[] }
interface Detail { name: string; description: string | null; groups: { code: string; options: { code: string; name: string }[] }[] }

test.describe('local server smoke', () => {
  test('resolves the tenant from the host, with its branding', async ({ page }) => {
    const { status, body } = await getJson<Tenant>(page, `${ALPHA}/api/tenant`);
    expect(status).toBe(200);
    expect(body).toMatchObject({ slug: 'alpha', currency: 'EUR', branding: { displayName: 'Alpha Spa', primaryColor: '#1f2a24' } });
  });

  test('lists only the visible saunas of the tenant', async ({ page }) => {
    const { body } = await getJson<Catalog>(page, `${ALPHA}/api/catalog`);
    expect(body.items.map(i => i.slug).sort()).toEqual(['espoo-compact', 'kuopio-cube', 'lappi-barrel', 'turku-panorama']);
  });

  test.describe('in French', () => {
    // Chromium derives a navigation's Accept-Language from the context locale (an extra header is ignored).
    test.use({ locale: 'fr-FR' });
    test('localises catalogue texts by Accept-Language', async ({ page }) => {
      const { body } = await getJson<Detail>(page, `${ALPHA}/api/catalog/saunas/espoo-compact`);
      expect(body.description).toContain('Sauna d’intérieur compact');
      const wood = body.groups.find(g => g.code === 'wood')!;
      expect(wood.options.map(o => o.name)).toContain('Épicéa nordique');
    });
  });

  test('serves the seeded share link snapshot', async ({ page }) => {
    const { status, body } = await getJson<{ sauna: { slug: string } }>(page, `${ALPHA}/api/shared/${SEED_SHARE_TOKEN}`);
    expect(status).toBe(200);
    expect(body.sauna.slug).toBe('espoo-compact');
  });

  test('rejects unknown and suspended tenants', async ({ page }) => {
    expect((await getJson(page, hostUrl('nobody', '/api/tenant'))).status).toBe(404);
    expect((await getJson(page, hostUrl('gamma', '/api/tenant'))).status).toBe(404); // gamma is SUSPENDED
  });

  test('answers on the manufacturer admin host', async ({ page }) => {
    const res = await page.goto(`${ADMIN}/api/health`);
    expect(res?.status()).toBe(200);
  });
});
