import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalAssetSigner } from '../../src/adapters/assets/local.ts';
import { createLocalServer, type LocalServer } from '../../src/local.ts';

// Smoke test of the CloudFront/S3 emulation. None of these routes touch the database.
const ASSET_SECRET = 'test-local-asset-signing-secret-0123456789abcdef';
let dir: string;
let server: LocalServer;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'saunaklar-local-'));
  server = createLocalServer(
    {
      NODE_ENV: 'test',
      ADAPTERS: 'local',
      LOCAL_OBJECTS_DIR: join(dir, 'objects'),
      LOCAL_ASSET_SIGNING_SECRET: ASSET_SECRET,
      LOG_LEVEL: 'error',
    },
    { startWorker: false, webDist: join(dir, 'no-dist') },
  );
});
afterAll(async () => {
  await server?.close();
  await rm(dir, { recursive: true, force: true });
});

async function lowTierCookie(host: string): Promise<string> {
  const signer = new LocalAssetSigner({ secret: ASSET_SECRET });
  const { cookies } = await signer.issueCookies({ host, tier: 'LOW', ttlSeconds: 300 });
  return cookies.map(c => `${c.name}=${c.value}`).join('; ');
}

describe('local edge', () => {
  it('LOW tier cookies open /assets/lo/* only, and only on their own host', async () => {
    const cookie = await lowTierCookie('alpha.localhost');
    const get = (path: string, host = 'alpha.localhost:8787') => server.app.request(path, { headers: { host, cookie } });

    expect((await get('/assets/hi/model.glb')).status).toBe(403);
    expect((await get('/assets/lo/model.glb')).status).toBe(404); // allowed, object absent
    expect((await get('/assets/lo/model.glb', 'beta.localhost:8787')).status).toBe(403);
    expect((await server.app.request('/assets/lo/model.glb', { headers: { host: 'alpha.localhost' } })).status).toBe(403);
  });

  it('refuses unsigned uploads and accepts a presigned one', async () => {
    const unsigned = await server.app.request('/dev/uploads/not-a-token', {
      method: 'PUT',
      headers: { host: 'alpha.localhost', 'content-type': 'image/png' },
      body: new Uint8Array([1, 2, 3]),
    });
    expect(unsigned.status).toBe(403);

    const store = server.deps.adapters.objectStore;
    const put = await store.presignPut({ key: 'uploads/alpha/abc', contentType: 'image/png', byteSize: 3, ttlSeconds: 60 });
    const wrongType = await server.app.request(put.url, { method: 'PUT', headers: { 'content-type': 'image/gif' }, body: new Uint8Array([1, 2, 3]) });
    expect(wrongType.status).toBe(403);
    const ok = await server.app.request(put.url, { method: 'PUT', headers: put.headers, body: new Uint8Array([1, 2, 3]) });
    expect(ok.status).toBe(200);
    expect([...((await store.get('uploads/alpha/abc')) ?? [])]).toEqual([1, 2, 3]);
  });

  it('serves public media immutably and explains a missing SPA build', async () => {
    await server.deps.adapters.objectStore.put('media/x/thumb.webp', new Uint8Array([9]), 'image/webp');
    const media = await server.app.request('/media/x/thumb.webp', { headers: { host: 'alpha.localhost' } });
    expect(media.status).toBe(200);
    expect(media.headers.get('cache-control')).toContain('immutable');
    expect(media.headers.get('content-type')).toBe('image/webp');

    const spa = await server.app.request('/saunas/nordic', { headers: { host: 'alpha.localhost' } });
    expect(spa.status).toBe(404);
    expect(await spa.text()).toMatch(/Vite dev server/);
  });
});
