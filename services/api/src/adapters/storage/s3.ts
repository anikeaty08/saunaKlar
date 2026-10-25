import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectHead, ObjectStore, PresignedPut } from '../types.ts';
import { assertObjectKey } from './keys.ts';

const isNotFound = (e: unknown) =>
  e instanceof S3ServiceException && (e.name === 'NoSuchKey' || e.name === 'NotFound' || e.$metadata.httpStatusCode === 404);

/** One instance per bucket (uploads, public assets, protected assets). */
export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;

  constructor(
    readonly bucket: string,
    options: { region?: string; client?: S3Client } = {},
  ) {
    this.client = options.client ?? new S3Client(options.region ? { region: options.region } : {});
  }

  async presignPut(input: { key: string; contentType: string; byteSize: number; ttlSeconds: number }): Promise<PresignedPut> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: assertObjectKey(input.key),
      ContentType: input.contentType,
      ContentLength: input.byteSize,
    });
    // Signing both headers makes S3 reject a PUT with any other type or size.
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.ttlSeconds,
      signableHeaders: new Set(['content-type', 'content-length']),
    });
    return {
      url,
      headers: { 'Content-Type': input.contentType },
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000),
    };
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const out = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: assertObjectKey(key) }));
      if (!out.Body) return null;
      return Buffer.from(await out.Body.transformToByteArray());
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: assertObjectKey(key), Body: body, ContentType: contentType, CacheControl: cacheControl }),
    );
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: assertObjectKey(key) }));
  }

  async head(key: string): Promise<ObjectHead | null> {
    try {
      const out = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: assertObjectKey(key) }));
      return {
        contentType: out.ContentType ?? 'application/octet-stream',
        byteSize: out.ContentLength ?? 0,
        ...(out.CacheControl ? { cacheControl: out.CacheControl } : {}),
      };
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }
}
