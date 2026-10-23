import type { Context } from 'hono';
import type { Pool, PoolClient } from 'pg';
import type { HostKind } from '@saunaklar/shared';
import type { Adapters } from './adapters/index.ts';
import type { Config } from './config.ts';
import type { Logger } from './lib/log.ts';

export interface Deps {
  config: Config;
  pool: Pool;
  adapters: Adapters;
  log: Logger;
  now: () => Date;
}

export interface TenantInfo {
  id: string;
  slug: string;
  status: 'ACTIVE' | 'SUSPENDED';
  currency: string;
  catalogVersion: number;
}

export type Principal =
  | { kind: 'anonymous' }
  | { kind: 'customer'; customerId: string; email: string; firstName: string; lastName: string; locale: string }
  | {
      kind: 'staff';
      staffId: string;
      email: string;
      displayName: string;
      scope: 'RESELLER' | 'MANUFACTURER';
      role: 'OWNER' | 'ADMIN' | 'MANUFACTURER_ADMIN';
      manufacturerId: string | null;
    };

export interface AppEnv {
  Variables: {
    deps: Deps;
    requestId: string;
    host: HostKind & { name: string };
    tenant: TenantInfo | null;
    principal: Principal;
    /** Per-browser random id (host-only cookie) that the CSRF token is bound to. */
    browserId: string;
    /** The access token was present but expired: protected routes answer SESSION_EXPIRED so the client refreshes. */
    sessionExpired: boolean;
  };
}

export type Ctx = Context<AppEnv>;
export type Db = PoolClient;
