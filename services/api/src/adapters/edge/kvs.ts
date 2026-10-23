import '@aws-sdk/signature-v4-crt';
import {
  CloudFrontKeyValueStoreClient,
  ConflictException,
  DeleteKeyCommand,
  DescribeKeyValueStoreCommand,
  PutKeyCommand,
  ResourceNotFoundException,
} from '@aws-sdk/client-cloudfront-keyvaluestore';
import type { EdgeTenantStatus, EdgeTenantStore } from '../types.ts';
import { assertSlug } from './slug.ts';

const MAX_ATTEMPTS = 4;

/**
 * Tenant directory read by the CloudFront viewer-request function: key = slug, value = status.
 * Every write needs the store's current ETag (optimistic concurrency); on a conflict we
 * re-read the ETag and retry.
 */
export class KeyValueStoreEdgeTenantStore implements EdgeTenantStore {
  private readonly client: CloudFrontKeyValueStoreClient;

  constructor(
    private readonly kvsArn: string,
    options: { client?: CloudFrontKeyValueStoreClient } = {},
  ) {
    // KVS is a global service signed with SigV4A (hence the CRT signer import); region is nominal.
    this.client = options.client ?? new CloudFrontKeyValueStoreClient({ region: 'us-east-1' });
  }

  private async etag(): Promise<string> {
    const out = await this.client.send(new DescribeKeyValueStoreCommand({ KvsARN: this.kvsArn }));
    if (!out.ETag) throw new Error('KeyValueStore returned no ETag');
    return out.ETag;
  }

  private async withEtag(op: (etag: string) => Promise<void>): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await op(await this.etag());
      } catch (e) {
        if (!(e instanceof ConflictException) || attempt >= MAX_ATTEMPTS) throw e;
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 50));
      }
    }
  }

  async put(slug: string, status: EdgeTenantStatus): Promise<void> {
    const key = assertSlug(slug);
    await this.withEtag(async (etag) => {
      await this.client.send(new PutKeyCommand({ KvsARN: this.kvsArn, Key: key, Value: status, IfMatch: etag }));
    });
  }

  async delete(slug: string): Promise<void> {
    const key = assertSlug(slug);
    await this.withEtag(async (etag) => {
      try {
        await this.client.send(new DeleteKeyCommand({ KvsARN: this.kvsArn, Key: key, IfMatch: etag }));
      } catch (e) {
        if (!(e instanceof ResourceNotFoundException)) throw e;
      }
    });
  }
}
