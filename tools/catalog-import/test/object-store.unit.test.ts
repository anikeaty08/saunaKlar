import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalObjectStore as ServerObjectStore } from '../../../services/api/src/adapters/storage/local.ts';
import { IMMUTABLE_CACHE, LocalObjectStore, S3ObjectStore, objectStoreFromTarget } from '../src/object-store.ts';

let root: string;
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'catalog-objects-')); });
afterAll(async () => rm(root, { recursive: true, force: true }));

describe('local target', () => {
  it('writes objects the local API server can read back', async () => {
    const store = objectStoreFromTarget('local', { env: { LOCAL_OBJECTS_DIR: root } });
    expect(store).toBeInstanceOf(LocalObjectStore);
    const key = 'assets/hi/catalog/cedar-100/model-glb-high-0123456789ab.glb';
    expect(await store.exists(key)).toBe(false);
    await store.put(key, Buffer.from('glTF-bytes'), 'model/gltf-binary', IMMUTABLE_CACHE);
    expect(await store.exists(key)).toBe(true);

    const server = new ServerObjectStore('assets', { rootDir: root, secret: 'test-upload-secret-0123456789abcdefghijk' });
    expect((await server.get(key))?.toString()).toBe('glTF-bytes');
    expect(await server.head(key)).toEqual({ contentType: 'model/gltf-binary', byteSize: 10, cacheControl: IMMUTABLE_CACHE });
  });

  it('uses <var-dir>/objects when a var dir is given, and the bucket from S3_ASSETS_BUCKET', () => {
    const store = objectStoreFromTarget('local', { varDir: join(root, 'var'), env: { LOCAL_OBJECTS_DIR: '/elsewhere', S3_ASSETS_BUCKET: 'b2' } });
    expect(store.description).toBe(`local ${join(root, 'var', 'objects', 'b2')}`);
  });

  it('defaults to <repo root>/var/objects/assets', () => {
    const store = objectStoreFromTarget('local', { env: {} }) as LocalObjectStore;
    expect(store.files.base).toMatch(/[\\/]var[\\/]objects[\\/]assets$/);
    expect(store.root).toBe(store.files.rootDir);
  });

  it('still parses s3 targets and rejects unknown ones', () => {
    expect(objectStoreFromTarget('s3://saunaklar-assets', { env: { MEDIA_BUCKET: 'saunaklar-media' } })).toBeInstanceOf(S3ObjectStore);
    expect(() => objectStoreFromTarget('ftp://x', { env: {} })).toThrow('unknown --target');
  });
});
