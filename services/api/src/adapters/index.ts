/**
 * Adapter wiring. `createAdapters(env, {pool, log})` returns
 * `{ identity, mailer, assetSigner, objectStore, edgeTenants, queue }`;
 * `createLocalEdge(env)` gives the local server its CloudFront/S3 emulation checks. `ADAPTERS=local` uses Postgres (`idp`, `devtools`), the filesystem and HMAC
 * signing; `ADAPTERS=aws` uses Cognito, SES, S3, CloudFront and SQS. Adapters are created
 * lazily, so a Lambda only needs the variables of the adapters it actually touches.
 *
 * Environment (also in services/api/.env.example):
 *   ADAPTERS                      local | aws (default local)
 *   AWS_REGION                    region for Cognito, SES, S3, SQS (aws)
 *   STAFF_MFA                     REQUIRED | OPTIONAL TOTP policy for the staff pool (local IdP; default REQUIRED)
 *   TOTP_ISSUER                   issuer shown in authenticator apps (default Saunaklar)
 *   MAIL_FROM_DOMAIN              platform mail domain; From is always no-reply@<domain> (default mail.localhost)
 *   MAIL_DEFAULT_FROM_NAME        From display name when no brand is given (default Saunaklar)
 *   S3_ASSETS_BUCKET              asset bucket: staging uploads/, public branding/ (required on aws; local default assets)
 *   local only:
 *   LOCAL_IDP_JWT_SECRET          HS256 key of the local IdP (>= 32 bytes; dev default)
 *   LOCAL_ASSET_SIGNING_SECRET    HMAC key of local asset cookies/URLs (>= 32 bytes; dev default)
 *   LOCAL_UPLOAD_SIGNING_SECRET   HMAC key of /dev/uploads tokens (>= 32 bytes; dev default)
 *   LOCAL_OBJECTS_DIR             object store root (default <repo>/var/objects)
 *   LOCAL_ASSET_URL_SCHEME        scheme of signed AR URLs locally (default http)
 *   COOKIE_SECURE                 Secure attribute on local asset cookies (default true)
 *   aws only:
 *   COGNITO_CUSTOMER_POOL_ID, COGNITO_CUSTOMER_CLIENT_ID   customer user pool and its public app client
 *   COGNITO_STAFF_POOL_ID, COGNITO_STAFF_CLIENT_ID         staff user pool (MFA required) and app client
 *   SES_CONFIGURATION_SET         SES v2 configuration set (event publishing for bounces/complaints)
 *   CLOUDFRONT_KEY_PAIR_ID        public key id of the CloudFront key group
 *   CLOUDFRONT_PRIVATE_KEY_SECRET_ARN  Secrets Manager secret holding the signing PEM (what infra sets)
 *   CLOUDFRONT_PRIVATE_KEY        alternative: the PEM inline (literal `\n` allowed), for ad-hoc runs
 *   EDGE_TENANT_KVS_ARN           CloudFront KeyValueStore ARN of the tenant directory
 *   SQS_QUEUE_URL                 notification queue
 */
import { bucketFromEnv, objectsDirFromEnv } from '@saunaklar/objects';
import type { Pool as PgPool } from 'pg';
import { CloudFrontAssetSigner } from './assets/cloudfront.ts';
import { LocalAssetSigner, verifyLocalAssetRequest, type LocalAssetRequest } from './assets/local.ts';
import { KeyValueStoreEdgeTenantStore } from './edge/kvs.ts';
import { NoopEdgeTenantStore } from './edge/memory.ts';
import { CognitoIdentityProvider } from './idp/cognito.ts';
import { LocalIdentityProvider } from './idp/local.ts';
import { DevMailboxMailer } from './mail/dev-mailbox.ts';
import { SesMailer } from './mail/ses.ts';
import { InProcessQueue, type QueueHandler } from './queue/in-process.ts';
import { SqsQueue } from './queue/sqs.ts';
import { LocalObjectStore, type LocalUploadGrant } from './storage/local.ts';
import { S3ObjectStore } from './storage/s3.ts';
import { loadSecretString } from './secrets.ts';
import type { AssetSigner, EdgeTenantStore, IdentityProvider, Mailer, ObjectStore, Queryable, Queue, TxRunner } from './types.ts';

export * from './types.ts';
export { AdapterError, IdpError, isAdapterError } from './errors.ts';

type Env = Record<string, string | undefined>;

/** Exactly the adapters the routes use. */
export interface Adapters {
  readonly identity: IdentityProvider;
  readonly mailer: Mailer;
  readonly assetSigner: AssetSigner;
  /**
   * The asset bucket. Browsers PUT to staging keys `uploads/<slug>/<random>` (never served by
   * the edge); processed branding goes to `branding/<slug>/<random>/<name>`.
   */
  readonly objectStore: ObjectStore;
  readonly edgeTenants: EdgeTenantStore;
  readonly queue: Queue;
}

/** Hooks the local server uses to emulate CloudFront and S3 presigned PUTs (ADAPTERS=local). */
export interface LocalEdge {
  verifyAssetRequest(req: LocalAssetRequest): boolean;
  /** Resolves a `/dev/uploads/<token>` token to its grant and the store to write into, or null. */
  verifyUpload(token: string): { grant: LocalUploadGrant; store: LocalObjectStore } | null;
}

interface MinimalLogger {
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
}

export interface AdapterDeps {
  /** Pool of the API login (`sauna_api`); local adapters run as role `idp_local` on it. */
  pool?: Pick<PgPool, 'connect'>;
  log?: MinimalLogger;
  /** Receives messages of the in-process queue (local). */
  onQueueMessage?: QueueHandler;
}

const DEV_SECRETS = {
  LOCAL_IDP_JWT_SECRET: 'dev-only-local-idp-jwt-secret-0123456789abcdef',
  LOCAL_ASSET_SIGNING_SECRET: 'dev-only-local-asset-signing-secret-0123456789',
  LOCAL_UPLOAD_SIGNING_SECRET: 'dev-only-local-upload-signing-secret-012345678',
} as const;

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

/** Transaction runner with `SET LOCAL ROLE`, for the local IdP and dev mailbox. */
export function roleTx(pool: Pick<PgPool, 'connect'>, role: string): TxRunner {
  if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error('Invalid role name');
  return async <T>(fn: (db: Queryable) => Promise<T>): Promise<T> => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SET LOCAL ROLE ${role}`);
      const result = await fn(client as unknown as Queryable);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  };
}

/** Memoised lazy getter. */
function lazy<T>(make: () => T): () => T {
  let value: T | undefined;
  let made = false;
  return () => {
    if (!made) {
      value = make();
      made = true;
    }
    return value as T;
  };
}

export function createAdapters(env: Env = process.env, deps: AdapterDeps = {}): Adapters {
  const kind = env.ADAPTERS === 'aws' ? 'aws' : 'local';
  return kind === 'aws' ? createAwsAdapters(env) : createLocalAdapters(env, deps);
}

function localSecret(env: Env, name: keyof typeof DEV_SECRETS): string {
  const value = env[name];
  if (value) return value;
  if (env.NODE_ENV === 'production') throw new Error(`Missing environment variable ${name}`);
  return DEV_SECRETS[name];
}

function localObjectStore(env: Env): LocalObjectStore {
  return new LocalObjectStore(bucketFromEnv(env), {
    rootDir: objectsDirFromEnv(env),
    secret: localSecret(env, 'LOCAL_UPLOAD_SIGNING_SECRET'),
  });
}

/** Verification hooks for the local edge emulator, configured from the same variables. */
export function createLocalEdge(env: Env = process.env): LocalEdge {
  const assetSecret = localSecret(env, 'LOCAL_ASSET_SIGNING_SECRET');
  const store = localObjectStore(env);
  return {
    verifyAssetRequest: (req) => verifyLocalAssetRequest(assetSecret, req),
    verifyUpload(token) {
      const grant = store.verifyUpload(token);
      return grant ? { grant, store } : null;
    },
  };
}

function createLocalAdapters(env: Env, deps: AdapterDeps): Adapters {
  const tx = lazy(() => {
    if (!deps.pool) throw new Error('Local adapters need a database pool');
    return roleTx(deps.pool, 'idp_local');
  });
  const mailer = lazy(() => new DevMailboxMailer(tx(), env.MAIL_FROM_DOMAIN || 'mail.localhost'));
  const identity = lazy(
    () =>
      new LocalIdentityProvider({
        tx: tx(),
        mailer: mailer(),
        jwtSecret: localSecret(env, 'LOCAL_IDP_JWT_SECRET'),
        staffMfa: env.STAFF_MFA === 'OPTIONAL' ? 'OPTIONAL' : 'REQUIRED',
        totpIssuer: env.TOTP_ISSUER || 'Saunaklar',
      }),
  );
  const assetSigner = lazy(
    () =>
      new LocalAssetSigner({
        secret: localSecret(env, 'LOCAL_ASSET_SIGNING_SECRET'),
        urlScheme: env.LOCAL_ASSET_URL_SCHEME === 'https' ? 'https' : 'http',
        secureCookies: env.COOKIE_SECURE !== '0' && env.COOKIE_SECURE !== 'false',
      }),
  );
  const objectStore = lazy(() => localObjectStore(env));
  const edgeTenants = lazy(() => new NoopEdgeTenantStore());
  const queue = lazy(
    () =>
      new InProcessQueue(
        deps.onQueueMessage ?? (() => deps.log?.warn('queue message dropped: no handler')),
        (e) => deps.log?.error('queue handler failed', { error: e instanceof Error ? e.message : String(e) }),
      ),
  );
  return {
    get identity() {
      return identity();
    },
    get mailer() {
      return mailer();
    },
    get assetSigner() {
      return assetSigner();
    },
    get objectStore() {
      return objectStore();
    },
    get edgeTenants() {
      return edgeTenants();
    },
    get queue() {
      return queue();
    },
  };
}

/** The signing PEM: from Secrets Manager (deployed Lambdas) or inline (tests, ad-hoc runs). */
function cloudFrontPrivateKey(env: Env, region: string | undefined): string | (() => Promise<string>) {
  const arn = env.CLOUDFRONT_PRIVATE_KEY_SECRET_ARN;
  if (arn) return () => loadSecretString(arn, region ? { region } : {});
  const pem = env.CLOUDFRONT_PRIVATE_KEY;
  if (!pem) throw new Error('Missing environment variable CLOUDFRONT_PRIVATE_KEY_SECRET_ARN (or CLOUDFRONT_PRIVATE_KEY)');
  return pem.replace(/\\n/g, '\n');
}

function createAwsAdapters(env: Env): Adapters {
  const region = env.AWS_REGION;
  const identity = lazy(
    () =>
      new CognitoIdentityProvider({
        pools: {
          CUSTOMER: { userPoolId: required(env, 'COGNITO_CUSTOMER_POOL_ID'), clientId: required(env, 'COGNITO_CUSTOMER_CLIENT_ID') },
          STAFF: { userPoolId: required(env, 'COGNITO_STAFF_POOL_ID'), clientId: required(env, 'COGNITO_STAFF_CLIENT_ID') },
        },
        ...(region ? { region } : {}),
        totpIssuer: env.TOTP_ISSUER || 'Saunaklar',
      }),
  );
  const mailer = lazy(
    () =>
      new SesMailer({
        fromDomain: required(env, 'MAIL_FROM_DOMAIN'),
        defaultFromName: env.MAIL_DEFAULT_FROM_NAME || 'Saunaklar',
        ...(env.SES_CONFIGURATION_SET ? { configurationSet: env.SES_CONFIGURATION_SET } : {}),
        ...(region ? { region } : {}),
      }),
  );
  const assetSigner = lazy(
    () =>
      new CloudFrontAssetSigner({
        keyPairId: required(env, 'CLOUDFRONT_KEY_PAIR_ID'),
        privateKey: cloudFrontPrivateKey(env, region),
      }),
  );
  const objectStore = lazy(() => new S3ObjectStore(required(env, 'S3_ASSETS_BUCKET'), region ? { region } : {}));
  const edgeTenants = lazy(() => new KeyValueStoreEdgeTenantStore(required(env, 'EDGE_TENANT_KVS_ARN')));
  const queue = lazy(() => new SqsQueue(required(env, 'SQS_QUEUE_URL'), region ? { region } : {}));
  return {
    get identity() {
      return identity();
    },
    get mailer() {
      return mailer();
    },
    get assetSigner() {
      return assetSigner();
    },
    get objectStore() {
      return objectStore();
    },
    get edgeTenants() {
      return edgeTenants();
    },
    get queue() {
      return queue();
    },
  };
}

export { verifyLocalAssetRequest } from './assets/local.ts';
export { verifyLocalUpload } from './storage/local.ts';
