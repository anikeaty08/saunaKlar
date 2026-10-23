import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalObjectStore, signLocalUpload, verifyLocalUpload } from '../../../src/adapters/storage/local.ts';

const SECRET = 'test-upload-secret-0123456789abcdefghijk';
let root: string;
let store: LocalObjectStore;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'saunaklar-objects-'));
  store = new LocalObjectStore('assets', { rootDir: root, secret: SECRET });
});
afterAll(async () => rm(root, { recursive: true, force: true }));

describe('LocalObjectStore', () => {
  it('puts, heads, gets and deletes objects', async () => {
    const key = 'branding/alpha/r1/logo.webp';
    expect(await store.get(key)).toBeNull();
    expect(await store.head(key)).toBeNull();
    await store.put(key, Buffer.from('hello'), 'image/webp', 'public, max-age=31536000, immutable');
    expect((await store.get(key))?.toString()).toBe('hello');
    expect(await store.head(key)).toEqual({ contentType: 'image/webp', byteSize: 5, cacheControl: 'public, max-age=31536000, immutable' });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    await expect(store.delete(key)).resolves.toBeUndefined();
  });

  it('rejects keys that could escape the root', async () => {
    for (const key of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'a/b/', 'a\\b', 'a b']) {
      await expect(store.put(key, Buffer.from('x'), 'text/plain')).rejects.toThrow('Invalid object key');
    }
  });

  it('presigns a /dev/uploads URL whose token verifies to the exact grant', async () => {
    const put = await store.presignPut({ key: 'uploads/alpha/abc', contentType: 'image/png', byteSize: 1234, ttlSeconds: 300 });
    expect(put.url).toMatch(/^\/dev\/uploads\/[\w-]+\.[\w-]+$/);
    expect(put.headers).toEqual({ 'Content-Type': 'image/png' });
    const token = put.url.slice('/dev/uploads/'.length);
    const grant = verifyLocalUpload(SECRET, token);
    expect(grant).toMatchObject({ bucket: 'assets', key: 'uploads/alpha/abc', contentType: 'image/png', byteSize: 1234 });
    expect(store.verifyUpload(token)).toEqual(grant);
    expect(new LocalObjectStore('other', { rootDir: root, secret: SECRET }).verifyUpload(token)).toBeNull();
  });

  it('rejects tampered, foreign and expired upload tokens', () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signLocalUpload(SECRET, { bucket: 'assets', key: 'uploads/a/b', contentType: 'image/png', byteSize: 10, exp });
    const [payload, mac] = token.split('.') as [string, string];
    const forged = Buffer.from(JSON.stringify({ bucket: 'assets', key: 'uploads/a/b', contentType: 'image/png', byteSize: 99999999, exp })).toString('base64url');
    expect(verifyLocalUpload(SECRET, `${forged}.${mac}`)).toBeNull();
    expect(verifyLocalUpload('another-secret-0123456789abcdefghijklmn', token)).toBeNull();
    expect(verifyLocalUpload(SECRET, `${payload}.${mac}.x`)).toBeNull();
    expect(verifyLocalUpload(SECRET, 'garbage')).toBeNull();
    expect(verifyLocalUpload(SECRET, token, (exp + 1) * 1000)).toBeNull();
    const evil = signLocalUpload(SECRET, { bucket: 'assets', key: '../../etc/x', contentType: 'image/png', byteSize: 1, exp });
    expect(verifyLocalUpload(SECRET, evil)).toBeNull();
  });
});
