import { migrate } from '@saunaklar/db';
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
import pg from 'pg';
import { originFor } from '../config.ts';
import type { Deps } from '../context.ts';
import { isAdapterError } from '../adapters/errors.ts';
import { loadDbLoginSecret, loginSecretArns, resolveMigrationUrl, type DbLoginSecret } from '../lib/runtimeEnv.ts';
import type { WorkerDeps } from './handler.ts';

type Env = Record<string, string | undefined>;

/**
 * Worker dependencies from the API's shared `Deps`. In AWS the Cognito user of an expired
 * sign-up is deleted through the IdP adapter (idempotent: "not found" counts as done);
 * locally retention removes `idp.users` rows inside its own transaction instead.
 */
export function workerDepsFrom(deps: Deps, env: Env = process.env): WorkerDeps {
  const { config, adapters } = deps;
  const aws = env.ADAPTERS === 'aws';
  // Locally MIGRATION_DATABASE_URL; in AWS MIGRATION_DB_SECRET_ARN (+ host/name), resolved per run.
  const canMigrate = !!(env.MIGRATION_DATABASE_URL || env.MIGRATION_DB_SECRET_ARN);
  return {
    pool: deps.pool,
    log: deps.log.child({ component: 'worker' }),
    now: deps.now,
    mailer: adapters.mailer,
    edge: adapters.edgeTenants,
    links: slug => originFor(config, `${slug}.${config.PLATFORM_DOMAIN}`),
    ...(aws
      ? {
          deleteIdpUser: async ({ customerId }) => {
            try {
              await adapters.identity.adminDeleteUser('CUSTOMER', customerId);
            } catch (err) {
              if (isAdapterError(err) && err.code === 'NOT_FOUND') return;
              throw err;
            }
          },
        }
      : {}),
    // Deploy hook: `{task:'migrate'}` applies migrations with the owner URL (never the API login),
    // then makes the per-function login users match their Secrets Manager entries.
    ...(canMigrate
      ? {
          migrate: async () => {
            const url = await resolveMigrationUrl(env);
            if (!url) throw new Error('No migration database configured');
            const applied = await migrate(url);
            const logins = await syncLoginUsers(url, env);
            return { applied, logins };
          },
        }
      : {}),
  };
}

/** Application roles a login user may join (the DB roles of docs/implementation-plan.md). */
const APP_ROLES = new Set(['app_tenant', 'app_platform', 'app_worker', 'catalog_admin']);
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Creates or updates the per-function login users (`svc_*`, infra/modules/database) so that
 * RDS Proxy can log in with the passwords it reads from Secrets Manager. Each user is LOGIN
 * NOINHERIT, a member of exactly one application role, and gets the same direct grants as the
 * local `sauna_api` login (schema usage and resolve_tenant() before SET LOCAL ROLE).
 * Idempotent; runs as the schema owner after the migrations. Returns the synced user names.
 */
export async function syncLoginUsers(
  ownerUrl: string,
  env: Env = process.env,
  loadSecret: (arn: string, env: Env) => Promise<DbLoginSecret> = loadDbLoginSecret,
): Promise<string[]> {
  const arns = loginSecretArns(env);
  const names = Object.keys(arns).sort();
  if (!names.length) return [];
  const secrets = await Promise.all(names.map(name => loadSecret(arns[name]!, env)));
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    for (const secret of secrets) {
      const { username, password, role } = secret;
      if (!IDENT.test(username)) throw new Error('Invalid login user name in DB secret');
      if (!role || !APP_ROLES.has(role)) throw new Error(`Login ${username} has no valid application role`);
      await client.query('BEGIN');
      try {
        const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [username])).rowCount;
        // Never send the plaintext: the instance logs DDL (log_statement = ddl), so only the
        // SCRAM verifier may appear in a statement.
        const lit = (await client.query<{ q: string }>('SELECT quote_literal($1) AS q', [scramVerifier(password)])).rows[0]!.q;
        await client.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${username} LOGIN NOINHERIT PASSWORD ${lit}`);
        // Exactly one application role: revoke any other membership left from earlier config.
        for (const other of APP_ROLES) {
          if (other !== role) await client.query(`REVOKE ${other} FROM ${username}`);
        }
        await client.query(`GRANT ${role} TO ${username}`);
        await client.query(`GRANT USAGE ON SCHEMA public TO ${username}`);
        if (role !== 'catalog_admin') await client.query(`GRANT EXECUTE ON FUNCTION resolve_tenant(text) TO ${username}`);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    }
  } finally {
    await client.end();
  }
  return secrets.map(s => s.username);
}

/** PostgreSQL SCRAM-SHA-256 password verifier (RFC 5802/7677 format used in pg_authid). */
export function scramVerifier(password: string, salt: Buffer = randomBytes(16), iterations = 4096): string {
  const salted = pbkdf2Sync(password.normalize('NFKC'), salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
