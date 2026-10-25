/**
 * Upload target. Storage keys are content-addressed full object keys
 * (`assets/{lo|hi}/catalog/...` or `media/catalog/...`), so objects are immutable: an existing key
 * is never rewritten, and everything is served with a one-year immutable cache.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { bucketFromEnv, LocalObjectFiles, objectsDirFromEnv } from '@saunaklar/objects';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export interface ObjectStore {
  readonly description: string;
  /** True when the object already exists (it is then left untouched). */
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void>;
}

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]{0,510}$/;
function assertKey(key: string): string {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error(`invalid object key ${key}`);
  return key;
}

/**
 * Local store, in the layout the local API server reads (shared via @saunaklar/objects):
 * `<root>/<bucket>/data/<key>` plus `<root>/<bucket>/meta/<key>.json` with the content type,
 * size and cache control. An object counts as present only when both files exist.
 */
export class LocalObjectStore implements ObjectStore {
  readonly files: LocalObjectFiles;
  constructor(root: string, bucket?: string) { this.files = new LocalObjectFiles(root, bucket); }
  get root(): string { return this.files.rootDir; }
  get description(): string { return this.files.description; }
  exists(key: string): Promise<boolean> { return this.files.exists(assertKey(key)); }
  put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    return this.files.put(assertKey(key), bytes, contentType, cacheControl);
  }
}

/**
 * S3: `assets/*` keys go to the private assets bucket, `media/*` keys to the public media bucket.
 * The object key in the bucket is the storage key itself. Default AWS credential chain.
 */
export class S3ObjectStore implements ObjectStore {
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null;
  readonly assetsBucket: string;
  readonly mediaBucket: string | null;
  readonly region: string | undefined;
  constructor(assetsBucket: string, mediaBucket: string | null, region?: string) {
    this.assetsBucket = assetsBucket;
    this.mediaBucket = mediaBucket;
    this.region = region;
  }
  get description(): string { return `s3://${this.assetsBucket} (assets/*)${this.mediaBucket ? `, s3://${this.mediaBucket} (media/*)` : ''}`; }
  bucketFor(key: string): string {
    if (key.startsWith('assets/')) return this.assetsBucket;
    if (key.startsWith('media/')) {
      if (!this.mediaBucket) throw new Error(`no media bucket for ${key}: pass --media-bucket or set MEDIA_BUCKET`);
      return this.mediaBucket;
    }
    throw new Error(`object key ${key} has neither an assets/ nor a media/ prefix`);
  }
  private async client() {
    this.clientPromise ??= import('@aws-sdk/client-s3').then((m) => new m.S3Client(this.region ? { region: this.region } : {}));
    return this.clientPromise;
  }
  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      await (await this.client()).send(new HeadObjectCommand({ Bucket: this.bucketFor(key), Key: assertKey(key) }));
      return true;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NotFound') return false;
      throw e;
    }
  }
  async put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    await (await this.client()).send(new PutObjectCommand({
      Bucket: this.bucketFor(key),
      Key: assertKey(key),
      Body: bytes,
      ContentType: contentType,
      CacheControl: cacheControl,
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
    }));
  }
}

const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/**
 * Parses `--target`: `local` (default) or `s3://<assets-bucket>`. The local root is
 * `<varDir>/objects` when a var dir is given, else $LOCAL_OBJECTS_DIR, else `<repo root>/var/objects`;
 * the bucket folder is $S3_ASSETS_BUCKET or `assets`, the same as the local API server.
 */
export function objectStoreFromTarget(
  target: string,
  opts: { varDir?: string | undefined; mediaBucket?: string | undefined; env?: Record<string, string | undefined> } = {},
): ObjectStore {
  const env = opts.env ?? process.env;
  if (target.startsWith('s3://')) {
    const bucket = target.slice(5).replace(/\/+$/, '');
    if (!BUCKET_RE.test(bucket)) throw new Error(`invalid S3 bucket name in "${target}"`);
    const media = opts.mediaBucket ?? env.MEDIA_BUCKET ?? null;
    if (media !== null && !BUCKET_RE.test(media)) throw new Error(`invalid media bucket name "${media}"`);
    return new S3ObjectStore(bucket, media, env.AWS_REGION);
  }
  if (target === 'local') {
    return new LocalObjectStore(opts.varDir ? join(opts.varDir, 'objects') : objectsDirFromEnv(env), bucketFromEnv(env));
  }
  throw new Error(`unknown --target "${target}" (use local or s3://<assets-bucket>)`);
}
