import { describe, expect, it, vi } from 'vitest';
import { createAdapters, createLocalEdge, roleTx } from '../../../src/adapters/index.ts';
import { DevMailboxMailer } from '../../../src/adapters/mail/dev-mailbox.ts';
import { InProcessQueue } from '../../../src/adapters/queue/in-process.ts';
import { NoopEdgeTenantStore } from '../../../src/adapters/edge/memory.ts';
import { LocalObjectStore } from '../../../src/adapters/storage/local.ts';
import type { Queryable } from '../../../src/adapters/types.ts';

describe('createAdapters', () => {
  it('returns exactly the adapters the routes use, lazily', () => {
    const adapters = createAdapters({ ADAPTERS: 'local' }, {});
    expect(Object.keys(adapters).sort()).toEqual(['assetSigner', 'edgeTenants', 'identity', 'mailer', 'objectStore', 'queue']);
    // Nothing needing a DB pool is built until used.
    expect(adapters.assetSigner).toBeDefined();
    expect(adapters.objectStore).toBeInstanceOf(LocalObjectStore);
    expect(() => adapters.identity).toThrow('database pool');
  });

  it('aws mode only demands the variables of adapters that are used', () => {
    const adapters = createAdapters({ ADAPTERS: 'aws', AWS_REGION: 'eu-central-1', SQS_QUEUE_URL: 'https://sqs.eu-central-1.amazonaws.com/1/q' });
    expect(adapters.queue).toBeDefined();
    expect(() => adapters.identity).toThrow('COGNITO_CUSTOMER_POOL_ID');
    expect(() => adapters.objectStore).toThrow('S3_ASSETS_BUCKET');
  });

  it('local secrets have dev defaults but are mandatory in production', () => {
    expect(() => createAdapters({ ADAPTERS: 'local', NODE_ENV: 'production' }).assetSigner).toThrow('LOCAL_ASSET_SIGNING_SECRET');
  });

  it('presigned local uploads verify through the local edge', async () => {
    const env = { ADAPTERS: 'local', LOCAL_OBJECTS_DIR: '/tmp/never-written' };
    const put = await createAdapters(env).objectStore.presignPut({ key: 'uploads/alpha/r1', contentType: 'image/png', byteSize: 10, ttlSeconds: 60 });
    const hit = createLocalEdge(env).verifyUpload(put.url.replace('/dev/uploads/', ''));
    expect(hit?.grant).toMatchObject({ key: 'uploads/alpha/r1', contentType: 'image/png', byteSize: 10 });
    expect(createLocalEdge({ ...env, LOCAL_UPLOAD_SIGNING_SECRET: 'x'.repeat(40) }).verifyUpload(put.url.slice(13))).toBeNull();
  });

  it('asset cookies verify through the local edge', async () => {
    const env = { ADAPTERS: 'local' };
    const { cookies } = await createAdapters(env).assetSigner.issueCookies({ host: 'alpha.localhost:5173', tier: 'FULL', ttlSeconds: 60 });
    const jar = Object.fromEntries(cookies.map((c) => [c.name, c.value]));
    expect(createLocalEdge(env).verifyAssetRequest({ host: 'alpha.localhost:5173', path: '/assets/hi/a.glb', cookies: jar })).toBe(true);
  });
});

describe('roleTx', () => {
  it('wraps work in BEGIN / SET LOCAL ROLE / COMMIT and rolls back on error', async () => {
    const log: string[] = [];
    const client = { query: async (sql: string) => (log.push(sql), { rows: [], rowCount: 0 }), release: () => log.push('release') };
    const tx = roleTx({ connect: async () => client } as never, 'idp_local');
    await tx(async (db) => db.query('SELECT 1'));
    await expect(tx(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(log).toEqual(['BEGIN', 'SET LOCAL ROLE idp_local', 'SELECT 1', 'COMMIT', 'release', 'BEGIN', 'SET LOCAL ROLE idp_local', 'ROLLBACK', 'release']);
    expect(() => roleTx({ connect: async () => client } as never, 'x; DROP')).toThrow();
  });
});

describe('DevMailboxMailer', () => {
  it('stores the mail with its envelope in devtools.mailbox', async () => {
    const calls: [string, readonly unknown[]][] = [];
    const db: Queryable = { query: async (text, values = []) => (calls.push([text, values]), { rows: [{ id: 7 }] as never[], rowCount: 1 }) };
    const mailer = new DevMailboxMailer((fn) => fn(db), 'mail.localhost');
    await expect(mailer.send({ to: 'a@b.ch', subject: 'Hi\nthere', html: '<p/>', text: 'body', fromName: 'Alpha', replyTo: 'r@a.ch', resellerId: 'r1' })).resolves.toEqual({ messageId: '7' });
    expect(calls[0]![0]).toContain('INSERT INTO devtools.mailbox (reseller_id, to_address, subject, html, text)');
    expect(calls[0]![1]).toEqual(['r1', 'a@b.ch', 'Hi there', '<p/>', 'From: "Alpha" <no-reply@mail.localhost>\nReply-To: r@a.ch\n\nbody']);
  });
});

describe('InProcessQueue', () => {
  it('delivers a JSON copy on a later tick and isolates handler failures', async () => {
    const received: unknown[] = [];
    const onError = vi.fn();
    const queue = new InProcessQueue((m) => {
      received.push(m);
      if ((m as { fail?: boolean }).fail) throw new Error('handler failed');
    }, onError);
    const msg = { type: 'X', id: 1 };
    await queue.send(msg);
    expect(received).toHaveLength(0);
    await queue.send({ fail: true });
    await queue.drain();
    expect(received).toEqual([{ type: 'X', id: 1 }, { fail: true }]);
    expect(received[0]).not.toBe(msg);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('NoopEdgeTenantStore', () => {
  it('records writes and validates slugs', async () => {
    const store = new NoopEdgeTenantStore();
    await store.put('alpha', 'ACTIVE');
    await store.put('beta', 'SUSPENDED');
    await store.delete('alpha');
    expect([...store.entries]).toEqual([['beta', 'SUSPENDED']]);
    await expect(store.put('-bad-', 'ACTIVE')).rejects.toThrow();
  });
});

describe('createAdapters (aws) CloudFront key source', () => {
  it('needs the key pair id and a key source, preferring the Secrets Manager ARN', () => {
    const base = { ADAPTERS: 'aws', AWS_REGION: 'eu-central-1', CLOUDFRONT_KEY_PAIR_ID: 'K1' };
    expect(() => createAdapters(base).assetSigner).toThrow('CLOUDFRONT_PRIVATE_KEY_SECRET_ARN');
    expect(createAdapters({ ...base, CLOUDFRONT_PRIVATE_KEY_SECRET_ARN: 'arn:aws:secretsmanager:eu-central-1:1:secret:k' }).assetSigner).toBeDefined();
  });
});
