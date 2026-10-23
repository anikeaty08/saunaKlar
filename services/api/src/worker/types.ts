import type { Pool, PoolClient } from 'pg';
import type { EdgeTenantStore, Mailer } from '../adapters/types.ts';
import type { Logger } from '../lib/log.ts';

export type OutboxEventType = 'REQUEST_SUBMITTED' | 'REQUEST_STATUS_CHANGED' | 'QUOTE_ADDED' | 'TENANT_SYNC';

/** A claimed `notification_outbox` row. Payloads hold ids only, never personal data. */
export interface OutboxRow {
  id: string;
  resellerId: string | null;
  eventType: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** Builds the storefront origin of a reseller, e.g. `https://alpha.saunas.example.com`. */
export type StorefrontLinks = (slug: string) => string;

export interface HandlerDeps {
  mailer: Mailer;
  edge: EdgeTenantStore;
  links: StorefrontLinks;
  log: Logger;
}

/** What one outbox handler receives: the row and the open app_worker transaction. */
export interface HandlerContext extends HandlerDeps {
  db: PoolClient;
  row: OutboxRow;
}

export type OutboxHandler = (ctx: HandlerContext) => Promise<HandlerOutcome>;

/** `sent`: delivered (or deliberately skipped). Counts are for logs only. */
export interface HandlerOutcome {
  sent: number;
  skipped: number;
}

/** A failure that retrying cannot fix (unknown event type, missing row, bad payload). */
export class PermanentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentError';
  }
}

export interface WorkerCoreDeps extends HandlerDeps {
  pool: Pool;
  now?: () => Date;
}
