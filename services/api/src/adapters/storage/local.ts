import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import type { ObjectHead, ObjectStore, PresignedPut } from '../types.ts';
import { assertObjectKey } from './keys.ts';

export interface LocalUploadGrant {
  bucket: string;
  key: string;
  contentType: string;
  byteSize: number;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

export function signLocalUpload(secret: string, grant: LocalUploadGrant): string {
  const payload = Buffer.from(JSON.stringify(grant)).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

/** Validates a `/dev/uploads/<token>` token; returns the grant or null (bad signature, expired, malformed). */
export function verifyLocalUpload(secret: string, token: string, now = Date.now()): LocalUploadGrant | null {
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LocalUploadGrant;
    if (typeof grant.exp !== 'number' || grant.exp * 1000 <= now) return null;
    if (typeof grant.bucket !== 'string' || typeof grant.contentType !== 'string' || !Number.isInteger(grant.byteSize)) return null;
    assertObjectKey(grant.key);
    return grant;
  } catch {
    return null;
  }
}

interface Meta {
  contentType: string;
  byteSize: number;
  cacheControl?: string;
}

/**
 * Filesystem object store: `<root>/<bucket>/data/<key>` plus `<root>/<bucket>/meta/<key>.json`.
 * Presigned PUTs point at the local server's `/dev/uploads/<token>` route.
 */
export class LocalObjectStore implements ObjectStore {
  private readonly base: string;

  constructor(
    readonly bucket: string,
    private readonly config: { rootDir: string; secret: string; uploadUrlPrefix?: string },
  ) {
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error('Invalid bucket name');
    if (Buffer.byteLength(config.secret) < 32) throw new Error('Local upload signing secret must be at least 32 bytes');
    this.base = resolve(config.rootDir, bucket);
  }

  private path(kind: 'data' | 'meta', key: string): string {
    const root = join(this.base, kind);
    const full = resolve(root, assertObjectKey(key) + (kind === 'meta' ? '.json' : ''));
    if (!full.startsWith(root + sep)) throw new Error('Invalid object key');
    return full;
  }

  async presignPut(input: { key: string; contentType: string; byteSize: number; ttlSeconds: number }): Promise<PresignedPut> {
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    const token = signLocalUpload(this.config.secret, {
      bucket: this.bucket,
      key: assertObjectKey(input.key),
      contentType: input.contentType,
      byteSize: input.byteSize,
      exp: Math.floor(expiresAt.getTime() / 1000),
    });
    return {
      url: `${this.config.uploadUrlPrefix ?? '/dev/uploads/'}${token}`,
      headers: { 'Content-Type': input.contentType },
      expiresAt,
    };
  }

  /** The grant behind a presigned URL token of this store, or null. */
  verifyUpload(token: string): LocalUploadGrant | null {
    const grant = verifyLocalUpload(this.config.secret, token);
    return grant && grant.bucket === this.bucket ? grant : null;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path('data', key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    const meta: Meta = { contentType, byteSize: body.byteLength, ...(cacheControl ? { cacheControl } : {}) };
    await atomicWrite(this.path('data', key), body);
    await atomicWrite(this.path('meta', key), JSON.stringify(meta));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path('data', key), { force: true });
    await rm(this.path('meta', key), { force: true });
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const meta = JSON.parse(await readFile(this.path('meta', key), 'utf8')) as Meta;
      return meta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
}

async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
