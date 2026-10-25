import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bucketFromEnv, defaultObjectsDir, findRepoRoot, LocalObjectFiles, objectsDirFromEnv } from '../src/index.ts';

const REPO = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
let root: string;

beforeAll(async () => { root = await mkdtemp(join(tmpdir(), 'saunaklar-objects-')); });
afterAll(async () => rm(root, { recursive: true, force: true }));

describe('LocalObjectFiles', () => {
  it('writes <root>/<bucket>/data/<key> and meta/<key>.json, the layout the local server reads', async () => {
    const files = new LocalObjectFiles(root, 'assets');
    const key = 'media/catalog/espoo/thumb-abc123.webp';
    await files.put(key, Buffer.from('RIFF....WEBP'), 'image/webp', 'public, max-age=31536000, immutable');
    expect((await readFile(join(root, 'assets', 'data', key))).toString()).toBe('RIFF....WEBP');
    expect(JSON.parse(await readFile(join(root, 'assets', 'meta', `${key}.json`), 'utf8')))
      .toEqual({ contentType: 'image/webp', byteSize: 12, cacheControl: 'public, max-age=31536000, immutable' });
    expect(await files.head(key)).toEqual({ contentType: 'image/webp', byteSize: 12, cacheControl: 'public, max-age=31536000, immutable' });
    expect(await files.exists(key)).toBe(true);
    await files.delete(key);
    expect(await files.exists(key)).toBe(false);
    expect(await files.get(key)).toBeNull();
  });

  it('omits cacheControl from the meta when none is given', async () => {
    const files = new LocalObjectFiles(root, 'assets');
    await files.put('assets/lo/x.glb', new Uint8Array([1, 2, 3]), 'model/gltf-binary');
    expect(await files.head('assets/lo/x.glb')).toEqual({ contentType: 'model/gltf-binary', byteSize: 3 });
  });

  it('counts a data file without its meta file as missing', async () => {
    const files = new LocalObjectFiles(root, 'half');
    await mkdir(join(root, 'half', 'data', 'media'), { recursive: true });
    await writeFile(join(root, 'half', 'data', 'media', 'a.webp'), 'x');
    expect(await files.exists('media/a.webp')).toBe(false);
  });

  it('keeps buckets apart', async () => {
    await new LocalObjectFiles(root, 'one').put('media/k', Buffer.from('1'), 'text/plain');
    expect(await new LocalObjectFiles(root, 'two').exists('media/k')).toBe(false);
  });

  it('rejects keys that could escape the root, and bad bucket names', async () => {
    const files = new LocalObjectFiles(root, 'assets');
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'a/b/', 'a\\b', 'a b']) {
      await expect(files.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid object key');
      expect(() => files.path('data', key)).toThrow('Invalid object key');
    }
    for (const bucket of ['', 'A', '../x', 'a/b']) expect(() => new LocalObjectFiles(root, bucket)).toThrow('Invalid bucket name');
  });
});

describe('default location', () => {
  it('is <repo root>/var/objects from any workspace directory', () => {
    expect(findRepoRoot(join(REPO, 'services', 'api', 'src'))).toBe(REPO);
    for (const dir of [REPO, join(REPO, 'services', 'api'), join(REPO, 'tools', 'catalog-import'), join(REPO, 'scripts')]) {
      expect(defaultObjectsDir(dir)).toBe(join(REPO, 'var', 'objects'));
    }
  });

  it('falls back to <from>/var/objects outside a repository', async () => {
    expect(findRepoRoot(root)).toBeNull();
    expect(defaultObjectsDir(root)).toBe(join(root, 'var', 'objects'));
  });

  it('honours LOCAL_OBJECTS_DIR and S3_ASSETS_BUCKET', () => {
    expect(objectsDirFromEnv({ LOCAL_OBJECTS_DIR: root }, REPO)).toBe(root);
    expect(objectsDirFromEnv({ LOCAL_OBJECTS_DIR: '' }, join(REPO, 'services', 'api'))).toBe(join(REPO, 'var', 'objects'));
    expect(bucketFromEnv({})).toBe('assets');
    expect(bucketFromEnv({ S3_ASSETS_BUCKET: 'saunaklar-assets-dev' })).toBe('saunaklar-assets-dev');
    const files = LocalObjectFiles.fromEnv({ LOCAL_OBJECTS_DIR: root, S3_ASSETS_BUCKET: 'b1' });
    expect(files.base).toBe(join(root, 'b1'));
  });
});
