import { createHmac, timingSafeEqual } from 'node:crypto';
import { LocalObjectFiles } from '@saunaklar/objects';
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

/**
 * Filesystem object store: `<root>/<bucket>/data/<key>` plus `<root>/<bucket>/meta/<key>.json`
 * (layout shared with the import CLI and the media seed, in @saunaklar/objects).
 * Presigned PUTs point at the local server's `/dev/uploads/<token>` route.
 */
export class LocalObjectStore implements ObjectStore {
  private readonly files: LocalObjectFiles;

  constructor(
    readonly bucket: string,
    private readonly config: { rootDir: string; secret: string; uploadUrlPrefix?: string },
  ) {
    if (Buffer.byteLength(config.secret) < 32) throw new Error('Local upload signing secret must be at least 32 bytes');
    this.files = new LocalObjectFiles(config.rootDir, bucket);
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

  get(key: string): Promise<Buffer | null> {
    return this.files.get(key);
  }

  put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    return this.files.put(key, body, contentType, cacheControl);
  }

  delete(key: string): Promise<void> {
    return this.files.delete(key);
  }

  async head(key: string): Promise<ObjectHead | null> {
    return this.files.head(key);
  }
}
