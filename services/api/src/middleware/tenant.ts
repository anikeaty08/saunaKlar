import type { MiddlewareHandler } from 'hono';
import { parseHost } from '@saunaklar/shared';
import type { AppEnv, Deps, TenantInfo } from '../context.ts';
import { ApiError } from '../lib/problem.ts';

/**
 * Resolves the tenant from the Host header (design 5.1). CloudFront forwards
 * the viewer's host as `x-tenant-host` because the origin request goes to
 * API Gateway's own hostname; that header is trusted only together with the
 * origin secret (checked earlier by `originLock`).
 */
export function hostAndTenant(cache = new TenantCache()): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const deps = c.get('deps');
    const { config } = deps;
    const raw = (config.TRUST_X_TENANT_HOST ? c.req.header('x-tenant-host') : undefined) ?? c.req.header('host') ?? '';
    const host = parseHost(raw, { platformDomain: config.PLATFORM_DOMAIN, adminHost: config.ADMIN_HOST });
    const name = raw.toLowerCase().replace(/:\d+$/, '');
    c.set('host', { ...host, name });
    c.set('tenant', null);
    if (host.kind === 'storefront') {
      const tenant = await cache.get(deps, host.slug);
      if (!tenant) throw new ApiError('TENANT_NOT_FOUND');
      if (tenant.status !== 'ACTIVE') throw new ApiError('TENANT_SUSPENDED');
      c.set('tenant', tenant);
    } else if (host.kind === 'unknown') {
      throw new ApiError('WRONG_HOST');
    }
    await next();
  };
}

/** 60 s in-memory cache per warm Lambda (design 12.2); suspensions propagate within a minute. */
export class TenantCache {
  private readonly entries = new Map<string, { at: number; value: TenantInfo | null }>();
  constructor(private readonly ttlMs = 60_000) {}

  async get(deps: Deps, slug: string): Promise<TenantInfo | null> {
    const now = deps.now().getTime();
    const hit = this.entries.get(slug);
    if (hit && now - hit.at < this.ttlMs) return hit.value;
    const { rows } = await deps.pool.query<{ id: string; slug: string; status: 'ACTIVE' | 'SUSPENDED'; currency_code: string; catalog_version: string }>(
      'select id, slug, status, currency_code, catalog_version from resolve_tenant($1)',
      [slug],
    );
    const row = rows[0];
    const value: TenantInfo | null = row
      ? { id: row.id, slug: row.slug, status: row.status, currency: row.currency_code, catalogVersion: Number(row.catalog_version) }
      : null;
    this.entries.set(slug, { at: now, value });
    if (this.entries.size > 5_000) this.entries.delete(this.entries.keys().next().value!);
    return value;
  }

  invalidate(slug?: string): void {
    if (slug) this.entries.delete(slug);
    else this.entries.clear();
  }
}
