import { migrate } from '@saunaklar/db';
import { originFor } from '../config.ts';
import type { Deps } from '../context.ts';
import { isAdapterError } from '../adapters/errors.ts';
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
  const migrationUrl = env.MIGRATION_DATABASE_URL;
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
    // Deploy hook: `{task:'migrate'}` applies migrations with the owner URL (never the API login).
    ...(migrationUrl ? { migrate: () => migrate(migrationUrl) } : {}),
  };
}
