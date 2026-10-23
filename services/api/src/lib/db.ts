import { withTx } from '@saunaklar/db';
import type { Ctx, Db } from '../context.ts';
import { ApiError } from './problem.ts';

/**
 * Transaction helpers. Every query runs inside one of these, which sets the
 * DB role and the transaction-local tenant/actor settings that RLS and the
 * audit/history triggers read (design 7.6).
 */
function actor(c: Ctx) {
  const p = c.get('principal');
  return {
    ...(p?.kind === 'customer' ? { actorCustomerId: p.customerId } : {}),
    ...(p?.kind === 'staff' ? { actorStaffId: p.staffId } : {}),
  };
}

export function tenantTx<T>(c: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  const tenant = c.get('tenant');
  if (!tenant) throw new ApiError('TENANT_NOT_FOUND');
  return withTx(c.get('deps').pool, { role: 'app_tenant', resellerId: tenant.id, ...actor(c) }, fn);
}

export function platformTx<T>(c: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTx(c.get('deps').pool, { role: 'app_platform', ...actor(c) }, fn);
}

export function idpTx<T>(c: Ctx, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTx(c.get('deps').pool, { role: 'idp_local' }, fn);
}
