import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runRetention } from '../../src/worker/retention.ts';
import { createHarness, seedCustomer, seedLockedConfiguration, seedTenant, type Harness } from './fixtures.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
  await installRetentionFunctionsIfMissing(h);
});

/**
 * Test shim with the agreed signatures, installed only while packages/db does not ship
 * `retention_delete_batch` / `delete_expired_pending_customers` yet.
 */
async function installRetentionFunctionsIfMissing(harness: Harness) {
  const { rows } = await harness.owner.query<{ ok: boolean }>(
    `SELECT to_regprocedure('retention_delete_batch(text,timestamptz,integer)') IS NOT NULL
        AND to_regprocedure('delete_expired_pending_customers(timestamptz,integer)') IS NOT NULL AS ok`,
  );
  if (rows[0]!.ok) return;
  await harness.owner.query(`
    CREATE FUNCTION retention_delete_batch(p_table text, p_cutoff timestamptz, p_limit integer) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE n integer;
    BEGIN
      IF p_table = 'share_link_views' THEN
        DELETE FROM share_link_views WHERE id IN (SELECT id FROM share_link_views WHERE viewed_at < p_cutoff LIMIT p_limit FOR UPDATE SKIP LOCKED);
      ELSIF p_table = 'audit_events' THEN
        DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE occurred_at < p_cutoff LIMIT p_limit FOR UPDATE SKIP LOCKED);
      ELSE
        RAISE EXCEPTION 'retention not allowed for %', p_table;
      END IF;
      GET DIAGNOSTICS n = ROW_COUNT;
      RETURN n;
    END $$;
    CREATE FUNCTION delete_expired_pending_customers(p_cutoff timestamptz, p_limit integer)
    RETURNS TABLE (id uuid, reseller_id uuid)
    LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
      DELETE FROM customers c
       WHERE c.id IN (SELECT x.id FROM customers x
                       WHERE x.status = 'PENDING' AND x.created_at < p_cutoff
                         AND NOT EXISTS (SELECT 1 FROM configurations k WHERE k.customer_id = x.id)
                         AND NOT EXISTS (SELECT 1 FROM share_links s WHERE s.created_by_customer_id = x.id)
                       LIMIT p_limit FOR UPDATE SKIP LOCKED)
      RETURNING c.id, c.reseller_id
    $$;
    GRANT EXECUTE ON FUNCTION retention_delete_batch(text, timestamptz, integer) TO app_worker;
    GRANT EXECUTE ON FUNCTION delete_expired_pending_customers(timestamptz, integer) TO app_worker;
  `);
}
afterAll(async () => {
  await h?.close();
});

const DAY = 86_400_000;

describe('runRetention', () => {
  it('removes the local IdP user of an expired sign-up', async () => {
    const t = await seedTenant(h.owner);
    const c = await seedCustomer(h.owner, t, { status: 'PENDING', createdAt: new Date(Date.now() - 9 * DAY) });
    await h.owner.query(`INSERT INTO idp.users (sub, pool, username, email) VALUES ($1, 'CUSTOMER', $2, $3)`, [c.id, c.id, c.email]);
    const result = await runRetention({ pool: h.api, log: h.deps().log });
    expect(result.pendingCustomers).toBe(1);
    expect((await h.owner.query('SELECT 1 FROM idp.users WHERE sub = $1', [c.id])).rowCount).toBe(0);
  });

  it('deletes only expired rows, in batches', async () => {
    const now = new Date();
    const ago = (days: number) => new Date(now.getTime() - days * DAY);
    const t = await seedTenant(h.owner);
    const customer = await seedCustomer(h.owner, t);
    const conf = await seedLockedConfiguration(h.owner, t, customer.id);
    const { rows: [link] } = await h.owner.query<{ id: string }>(
      `INSERT INTO share_links (reseller_id, configuration_id, token_hash, created_by_customer_id, expires_at)
       VALUES ($1, $2, $3, $4, now() + interval '30 days') RETURNING id`,
      [t.resellerId, conf, randomBytes(32), customer.id],
    );
    // share_link_views: 13 months
    await h.owner.query(
      `INSERT INTO share_link_views (share_link_id, reseller_id, viewed_at)
       SELECT $1, $2, ts FROM unnest($3::timestamptz[]) ts`,
      [link!.id, t.resellerId, [ago(400), ago(400), ago(400), ago(420), ago(300), ago(1)]],
    );
    // outbox: sent 30 days, failed 90 days, pending never
    await h.owner.query('DELETE FROM notification_outbox');
    await h.owner.query(
      `INSERT INTO notification_outbox (event_type, sent_at, failed_at) VALUES
         ('TENANT_SYNC', $1, NULL), ('TENANT_SYNC', $1, NULL), ('TENANT_SYNC', $2, NULL),
         ('TENANT_SYNC', NULL, $3), ('TENANT_SYNC', NULL, $1),
         ('TENANT_SYNC', NULL, NULL)`,
      [ago(31), ago(29), ago(91)],
    );
    // audit: 24 months
    await h.owner.query('DELETE FROM audit_events');
    await h.owner.query(
      `INSERT INTO audit_events (occurred_at, action, entity_type, entity_id)
       VALUES ($1, 'x.update', 'x', '1'), ($2, 'x.update', 'x', '2'), ($3, 'x.update', 'x', '3')`,
      [ago(800), ago(740), ago(700)],
    );
    // pending sign-ups: 7 days
    const oldPending = await seedCustomer(h.owner, t, { status: 'PENDING', createdAt: ago(8) });
    const freshPending = await seedCustomer(h.owner, t, { status: 'PENDING', createdAt: ago(2) });
    const oldActive = await seedCustomer(h.owner, t, { status: 'ACTIVE', createdAt: ago(400) });
    const deleteIdpUser = vi.fn(async () => {});

    const result = await runRetention({ pool: h.api, log: h.deps().log, now: () => now, batchSize: 2, deleteIdpUser });

    expect(result).toEqual({ shareLinkViews: 4, sentOutbox: 2, failedOutbox: 1, auditEvents: 2, pendingCustomers: 1, failedJobs: [] });
    expect(deleteIdpUser).toHaveBeenCalledExactlyOnceWith({ customerId: oldPending.id, resellerId: t.resellerId });

    const count = async (sql: string) => Number((await h.owner.query<{ n: string }>(sql)).rows[0]!.n);
    expect(await count('SELECT count(*) AS n FROM share_link_views')).toBe(2);
    expect(await count('SELECT count(*) AS n FROM notification_outbox')).toBe(3);
    expect(await count('SELECT count(*) AS n FROM audit_events WHERE entity_type = \'x\'')).toBe(1);
    const { rows } = await h.owner.query<{ id: string }>('SELECT id FROM customers WHERE id = ANY($1::uuid[])', [
      [oldPending.id, freshPending.id, oldActive.id],
    ]);
    expect(rows.map(r => r.id).sort()).toEqual([freshPending.id, oldActive.id].sort());

    // A second run finds nothing.
    const again = await runRetention({ pool: h.api, log: h.deps().log, now: () => now, deleteIdpUser });
    expect(again).toMatchObject({ shareLinkViews: 0, sentOutbox: 0, failedOutbox: 0, auditEvents: 0, pendingCustomers: 0 });
  });

  it('keeps a pending customer whose IdP deletion fails', async () => {
    const t = await seedTenant(h.owner);
    const c = await seedCustomer(h.owner, t, { status: 'PENDING', createdAt: new Date(Date.now() - 10 * DAY) });
    const result = await runRetention({
      pool: h.api,
      log: h.deps().log,
      deleteIdpUser: async () => {
        throw new Error('cognito down');
      },
    });
    expect(result.pendingCustomers).toBe(0);
    expect(result.failedJobs).toEqual(['pendingCustomers']);
    expect((await h.owner.query('SELECT 1 FROM customers WHERE id = $1', [c.id])).rowCount).toBe(1);
  });
});
