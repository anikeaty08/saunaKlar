import { Hono } from 'hono';
import type { LambdaFunction } from '@saunaklar/shared';
import type { AppEnv, Deps } from './context.ts';
import { notFoundHandler, onError, originLock, requestContext, securityHeaders } from './middleware/core.ts';
import { rateLimit } from './middleware/rateLimit.ts';
import { csrf, session } from './middleware/session.ts';
import { hostAndTenant, TenantCache } from './middleware/tenant.ts';
import { registerAccount } from './routes/account.ts';
import { registerAdmin } from './routes/admin.ts';
import { registerAssets } from './routes/assets.ts';
import { registerAuth } from './routes/auth.ts';
import { registerCatalog } from './routes/catalog.ts';
import { registerConfigurations } from './routes/configurations.ts';
import { registerManufacturer } from './routes/manufacturer.ts';
import { registerStaffAuth } from './routes/staffAuth.ts';

export const ALL_FUNCTIONS: readonly LambdaFunction[] = ['public-catalog', 'customer', 'reseller-admin', 'manufacturer-admin', 'asset-signer'];

/**
 * Builds the API. In AWS each Lambda function mounts only its own routes
 * (separate IAM role and DB user per function, design 4.2); locally and in
 * tests one process mounts all of them.
 */
export function createApp(deps: Deps, functions: readonly LambdaFunction[] = ALL_FUNCTIONS, tenantCache = new TenantCache()): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('deps', deps);
    await next();
  });
  app.use('*', requestContext, securityHeaders, originLock, hostAndTenant(tenantCache), session, csrf);
  app.use('/api/auth/*', rateLimit({ group: 'auth', windowMs: 60_000, max: 30 }));
  app.use('/api/shared/*', rateLimit({ group: 'shared', windowMs: 60_000, max: 60 }));
  app.use('/api/assets/*', rateLimit({ group: 'assets', windowMs: 60_000, max: 120 }));

  const has = (f: LambdaFunction) => functions.includes(f);
  if (has('public-catalog')) registerCatalog(app);
  if (has('customer')) {
    registerAuth(app);
    registerAccount(app);
    registerConfigurations(app);
  }
  if (has('reseller-admin')) {
    registerStaffAuth(app);
    registerAdmin(app);
  }
  if (has('manufacturer-admin')) {
    if (!has('reseller-admin')) registerStaffAuth(app);
    registerManufacturer(app);
  }
  if (has('asset-signer')) registerAssets(app);

  app.get('/api/health', c => c.json({ ok: true }));
  app.notFound(notFoundHandler);
  app.onError(onError);
  return app;
}
