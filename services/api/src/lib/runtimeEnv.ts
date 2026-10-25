import { loadSecretString } from '../adapters/secrets.ts';

type Env = Record<string, string | undefined>;

/**
 * In AWS the secrets arrive as Secrets Manager ARNs (`APP_SECRET_ARN`,
 * `ORIGIN_SECRET_ARN`) rather than values, so they never appear in the
 * Lambda configuration. This resolves them once per execution environment
 * into the plain variables `loadConfig` reads. A value already set wins.
 * (`CLOUDFRONT_PRIVATE_KEY_SECRET_ARN` is resolved lazily by the asset signer,
 * see adapters/index.ts, so only the asset-signer function needs access to it.)
 */
const SECRET_VARS = ['APP_SECRET', 'ORIGIN_SECRET'] as const;

const regionOf = (env: Env) => (env.AWS_REGION ? { region: env.AWS_REGION } : {});

export async function resolveSecretEnv(env: Env = process.env): Promise<Env> {
  const out = { ...env };
  await Promise.all(SECRET_VARS.map(async name => {
    const arn = env[`${name}_ARN`];
    if (!out[name] && arn) out[name] = await loadSecretString(arn, regionOf(env));
  }));
  return out;
}

/** Secret JSON of a PostgreSQL login (RDS-managed master secret or a `svc_*` login secret). */
export interface DbLoginSecret {
  username: string;
  password: string;
  /** Application role the login is a member of (`svc_*` secrets only). */
  role?: string;
}

export async function loadDbLoginSecret(arn: string, env: Env = process.env): Promise<DbLoginSecret> {
  const parsed = JSON.parse(await loadSecretString(arn, regionOf(env))) as Partial<DbLoginSecret>;
  if (!parsed.username || !parsed.password) throw new Error('Database secret has no username/password');
  return { username: parsed.username, password: parsed.password, ...(parsed.role ? { role: parsed.role } : {}) };
}

/**
 * Owner URL for the worker's `{task:'migrate'}`. Locally `MIGRATION_DATABASE_URL` is set
 * directly. In AWS it is built at migrate time (not at cold start, because RDS rotates the
 * master secret) from `MIGRATION_DB_SECRET_ARN` (RDS-managed `{username, password}`),
 * `MIGRATION_DB_HOST`, `MIGRATION_DB_PORT` (default 5432) and `MIGRATION_DB_NAME`. The
 * connection goes straight to the instance with full TLS verification (the Lambda runtime
 * trusts the RDS CA via NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem).
 * Returns undefined when neither is configured.
 */
export async function resolveMigrationUrl(env: Env = process.env): Promise<string | undefined> {
  if (env.MIGRATION_DATABASE_URL) return env.MIGRATION_DATABASE_URL;
  const arn = env.MIGRATION_DB_SECRET_ARN;
  if (!arn) return undefined;
  const host = env.MIGRATION_DB_HOST;
  const db = env.MIGRATION_DB_NAME;
  if (!host || !db) throw new Error('MIGRATION_DB_HOST and MIGRATION_DB_NAME are required with MIGRATION_DB_SECRET_ARN');
  const { username, password } = await loadDbLoginSecret(arn, env);
  const url = new URL(`postgres://${host}:${env.MIGRATION_DB_PORT || '5432'}/${encodeURIComponent(db)}`);
  url.username = encodeURIComponent(username);
  url.password = encodeURIComponent(password);
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

/** `DB_LOGIN_SECRET_ARNS`: JSON map of login user → secret ARN (set by infra/modules/api). */
export function loginSecretArns(env: Env = process.env): Record<string, string> {
  const raw = env.DB_LOGIN_SECRET_ARNS;
  if (!raw) return {};
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('DB_LOGIN_SECRET_ARNS must be a JSON object');
  return parsed as Record<string, string>;
}
