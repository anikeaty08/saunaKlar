/**
 * Upload target. Keys are content-addressed (`catalog/{slug}/{role}-{sha12}.{ext}`), so objects are
 * immutable: an existing key is never rewritten and is served with a one-year immutable cache.
 */
import { mkdir, stat, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export interface ObjectStore {
  readonly description: string;
  /** Returns true when the object already existed (and was left untouched). */
  exists(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void>;
}

/**
 * Local filesystem store with the same layout as the API's LocalObjectStore
 * (services/api/src/adapters/storage/local.ts), so the local edge serves what we write:
 * `<root>/<bucket>/data/<key>` plus `<root>/<bucket>/meta/<key>.json` ({contentType, byteSize, cacheControl}).
 * Default root is `var/objects`, bucket `assets`.
 */
export class LocalObjectStore implements ObjectStore {
  readonly base: string;
  constructor(root: string, bucket = 'assets') {
    if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error(`invalid bucket directory name "${bucket}"`);
    this.base = resolve(root, bucket);
  }
  get description(): string { return `local ${this.base}`; }
  private path(kind: 'data' | 'meta', key: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9/._-]{0,510}$/.test(key) || key.includes('..') || key.includes('//')) throw new Error(`invalid object key ${key}`);
    return join(this.base, kind, kind === 'meta' ? `${key}.json` : key);
  }
  async exists(key: string): Promise<boolean> {
    return stat(this.path('data', key)).then((s) => s.isFile(), () => false);
  }
  async put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    await atomicWrite(this.path('data', key), bytes);
    await atomicWrite(this.path('meta', key), JSON.stringify({ contentType, byteSize: bytes.byteLength, cacheControl }));
  }
}

async function atomicWrite(p: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, p);
}

/** S3 store for `--target s3://bucket[/prefix]`. Uses the default AWS credential chain. */
export class S3ObjectStore implements ObjectStore {
  private clientPromise: Promise<import('@aws-sdk/client-s3').S3Client> | null = null;
  constructor(readonly bucket: string, readonly prefix = '', readonly region?: string) {}
  get description(): string { return `s3://${this.bucket}${this.prefix ? `/${this.prefix}` : ''}`; }
  private fullKey(key: string): string { return this.prefix ? `${this.prefix.replace(/\/+$/, '')}/${key}` : key; }
  private async client() {
    this.clientPromise ??= import('@aws-sdk/client-s3').then((m) => new m.S3Client(this.region ? { region: this.region } : {}));
    return this.clientPromise;
  }
  async exists(key: string): Promise<boolean> {
    const { HeadObjectCommand } = await import('@aws-sdk/client-s3');
    try {
      await (await this.client()).send(new HeadObjectCommand({ Bucket: this.bucket, Key: this.fullKey(key) }));
      return true;
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404 || (e as Error).name === 'NotFound') return false;
      throw e;
    }
  }
  async put(key: string, bytes: Uint8Array, contentType: string, cacheControl: string): Promise<void> {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const { createHash } = await import('node:crypto');
    await (await this.client()).send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.fullKey(key),
      Body: bytes,
      ContentType: contentType,
      CacheControl: cacheControl,
      ChecksumSHA256: createHash('sha256').update(bytes).digest('base64'),
      ServerSideEncryption: 'AES256',
    }));
  }
}

/** Parses `--target`: `local` (default), `local:<bucket-dir>` or `s3://bucket[/prefix]`. */
export function objectStoreFromTarget(target: string, opts: { varDir: string; bucket?: string | undefined }): ObjectStore {
  if (target.startsWith('s3://')) {
    const rest = target.slice(5);
    const slash = rest.indexOf('/');
    const bucket = slash === -1 ? rest : rest.slice(0, slash);
    const prefix = slash === -1 ? '' : rest.slice(slash + 1);
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`invalid S3 bucket name in "${target}"`);
    return new S3ObjectStore(bucket, prefix, process.env.AWS_REGION);
  }
  if (target === 'local' || target.startsWith('local:')) {
    const bucket = target.startsWith('local:') ? target.slice(6) : (opts.bucket ?? 'assets');
    return new LocalObjectStore(join(opts.varDir, 'objects'), bucket);
  }
  throw new Error(`unknown --target "${target}" (use local, local:<bucket> or s3://bucket)`);
}
