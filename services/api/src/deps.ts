import { Signer } from '@aws-sdk/rds-signer';
import pg from 'pg';
import { createAdapters } from './adapters/index.ts';
import type { Deps } from './context.ts';
import { loadConfig, type Config } from './config.ts';
import { createLogger } from './lib/log.ts';

/**
 * Builds the database pool. In AWS the function's DB user authenticates with
 * a short-lived IAM token against RDS Proxy (design 15.1: no static DB
 * passwords); `pg` calls the password function for every new connection.
 */
export function createDbPool(cfg: Config, env: Record<string, string | undefined> = process.env): pg.Pool {
  const url = new URL(cfg.API_DATABASE_URL);
  const iam = env.DB_IAM_AUTH === '1';
  const signer = iam
    ? new Signer({ hostname: url.hostname, port: Number(url.port || 5432), username: decodeURIComponent(url.username), region: env.AWS_REGION })
    : null;
  return new pg.Pool({
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: signer ? () => signer.getAuthToken() : decodeURIComponent(url.password),
    ssl: iam || url.searchParams.get('sslmode') === 'require' ? { rejectUnauthorized: true } : undefined,
    max: cfg.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    application_name: env.AWS_LAMBDA_FUNCTION_NAME ?? 'saunaklar-api',
  });
}

export function buildDeps(env: Record<string, string | undefined> = process.env): Deps {
  const config = loadConfig(env);
  const pool = createDbPool(config, env);
  const log = createLogger(config.LOG_LEVEL, { service: env.AWS_LAMBDA_FUNCTION_NAME ?? 'api' });
  const adapters = createAdapters(env, { pool, log });
  return { config, pool, adapters, log, now: () => new Date() };
}
