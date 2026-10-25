import type { EdgeTenantStatus, EdgeTenantStore } from '../types.ts';
import { assertSlug } from './slug.ts';

/** Local stand-in: the local edge resolves tenants from the database, so this only records writes. */
export class NoopEdgeTenantStore implements EdgeTenantStore {
  readonly entries = new Map<string, EdgeTenantStatus>();

  async put(slug: string, status: EdgeTenantStatus): Promise<void> {
    this.entries.set(assertSlug(slug), status);
  }

  async delete(slug: string): Promise<void> {
    this.entries.delete(assertSlug(slug));
  }
}
