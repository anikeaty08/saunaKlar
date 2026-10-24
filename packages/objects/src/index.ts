/**
 * The local object store's on-disk layout, in one place. The local API server reads it, and the
 * catalog import CLI and the dev media seed (scripts/seed-media.mjs) write it:
 *
 *   <root>/<bucket>/data/<key>          the object's bytes
 *   <root>/<bucket>/meta/<key>.json     { contentType, byteSize, cacheControl? }
 *
 * root defaults to `<repo root>/var/objects` (LOCAL_OBJECTS_DIR overrides it) and bucket to
 * `assets` (S3_ASSETS_BUCKET overrides it), whichever directory the process starts in.
 *
 * Only erasable TypeScript here: plain `node` loads this file directly (type stripping).
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';

export interface ObjectMeta {
  contentType: string;
  byteSize: number;
  cacheControl?: string;
}

export const DEFAULT_BUCKET = 'assets';

/** Object keys: relative, safe characters, no empty/dot segments (they map onto file paths locally). */
export function assertObjectKey(key: string): string {
  if (
    key.length === 0 ||
    key.length > 512 ||
    !/^[A-Za-z0-9._\-/]+$/.test(key) ||
    key.startsWith('/') ||
    key.endsWith('/') ||
    key.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')
  ) {
    throw new Error('Invalid object key');
  }
  return key;
}

export function assertBucketName(bucket: string): string {
  if (!/^[a-z0-9][a-z0-9.-]{1,62}$/.test(bucket)) throw new Error('Invalid bucket name');
  return bucket;
}

/** The monorepo root (the first package.json with `workspaces` at or above `from`), or null. */
export function findRepoRoot(from: string = process.cwd()): string | null {
  let dir = resolve(from);
  for (;;) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        if ((JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: unknown }).workspaces) return dir;
      } catch {
        /* unreadable package.json: keep walking */
      }
    }
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** `<repo root>/var/objects`, so every workspace and script shares one store; `<from>/var/objects` outside a repo. */
export function defaultObjectsDir(from: string = process.cwd()): string {
  return join(findRepoRoot(from) ?? resolve(from), 'var', 'objects');
}

type Env = Record<string, string | undefined>;

/** The store's root directory: LOCAL_OBJECTS_DIR, else `<repo root>/var/objects`. */
export function objectsDirFromEnv(env: Env = process.env, from?: string): string {
  return resolve(env.LOCAL_OBJECTS_DIR || defaultObjectsDir(from));
}

/** The store's bucket: S3_ASSETS_BUCKET, else `assets`. */
export function bucketFromEnv(env: Env = process.env): string {
  return assertBucketName(env.S3_ASSETS_BUCKET || DEFAULT_BUCKET);
}

/** Filesystem object store for one bucket. */
export class LocalObjectFiles {
  readonly rootDir: string;
  readonly bucket: string;
  /** `<root>/<bucket>`. */
  readonly base: string;

  constructor(rootDir: string, bucket: string = DEFAULT_BUCKET) {
    this.rootDir = resolve(rootDir);
    this.bucket = assertBucketName(bucket);
    this.base = join(this.rootDir, bucket);
  }

  /** Store configured from LOCAL_OBJECTS_DIR and S3_ASSETS_BUCKET, with the repo-root default. */
  static fromEnv(env: Env = process.env, from?: string): LocalObjectFiles {
    return new LocalObjectFiles(objectsDirFromEnv(env, from), bucketFromEnv(env));
  }

  get description(): string {
    return `local ${this.base}`;
  }

  /** Absolute path of a key's data or meta file; throws on an invalid key. */
  path(kind: 'data' | 'meta', key: string): string {
    const root = join(this.base, kind);
    const full = resolve(root, assertObjectKey(key) + (kind === 'meta' ? '.json' : ''));
    if (!full.startsWith(root + sep)) throw new Error('Invalid object key');
    return full;
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.path('data', key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async head(key: string): Promise<ObjectMeta | null> {
    try {
      return JSON.parse(await readFile(this.path('meta', key), 'utf8')) as ObjectMeta;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  /** True when both the data and the meta file exist (a half-written object counts as missing). */
  async exists(key: string): Promise<boolean> {
    const isFile = (p: string) => stat(p).then((s) => s.isFile(), () => false);
    return (await isFile(this.path('data', key))) && (await isFile(this.path('meta', key)));
  }

  /** Writes data, then meta, each atomically (temp file + rename). */
  async put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    const meta: ObjectMeta = { contentType, byteSize: body.byteLength, ...(cacheControl ? { cacheControl } : {}) };
    await atomicWrite(this.path('data', key), body);
    await atomicWrite(this.path('meta', key), JSON.stringify(meta));
  }

  async delete(key: string): Promise<void> {
    await rm(this.path('data', key), { force: true });
    await rm(this.path('meta', key), { force: true });
  }
}

async function atomicWrite(file: string, data: Uint8Array | string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
