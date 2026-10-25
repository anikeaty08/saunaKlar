/**
 * Wiring checks that need no SPA page: the server runs against the seeded database, the tenant
 * comes from the Host header, and the catalogue is localised. They run through Chromium.
 */
import { ADMIN, ALPHA, SEED_SHARE_TOKEN, expect, getJson, hostUrl, test } from './fixtures.ts';

interface Tenant { slug: string; currency: string; branding: { displayName: string; primaryColor: string } }
interface Catalog { currency: string; items: { slug: string; name: string; assets: { thumbnailUrl: string | null; gallery: string[]; lowGlbUrl: string | null } }[] }
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

  test('serves the seeded images and, with an asset session, the 3D models', async ({ page }) => {
    // Files written by scripts/seed-media.mjs in the global setup.
    const { body } = await getJson<Catalog>(page, `${ALPHA}/api/catalog`);
    const images = body.items.flatMap(i => [i.assets.thumbnailUrl, ...i.assets.gallery]);
    const models = body.items.map(i => i.assets.lowGlbUrl);
    expect(images).not.toContain(null);
    expect(models).not.toContain(null);
    const result = await page.evaluate(async ({ images, models }) => {
      const head = async (url: string) => {
        const res = await fetch(url);
        const bytes = new Uint8Array(await res.arrayBuffer()).slice(0, 4);
        return { url, status: res.status, type: res.headers.get('content-type'), magic: String.fromCharCode(...bytes) };
      };
      const imageResults = await Promise.all(images.map(head));
      const { csrfToken } = await (await fetch('/api/auth/session')).json() as { csrfToken: string };
      const session = await fetch('/api/assets/session', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrfToken }, body: '{}' });
      return { imageResults, session: session.status, modelResults: await Promise.all(models.map(head)) };
    }, { images: images as string[], models: models as string[] });
    for (const r of result.imageResults) expect(r, r.url).toMatchObject({ status: 200, type: 'image/webp', magic: 'RIFF' });
    expect(result.session).toBe(200);
    for (const r of result.modelResults) expect(r, r.url).toMatchObject({ status: 200, type: 'model/gltf-binary', magic: 'glTF' });
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
