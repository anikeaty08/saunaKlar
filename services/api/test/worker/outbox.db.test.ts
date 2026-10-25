import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../src/lib/log.ts';
import { drainOutbox } from '../../src/worker/outbox.ts';
import { startLocalWorker } from '../../src/worker/local.ts';
import {
  createHarness,
  outboxRows,
  seedCustomer,
  seedLockedConfiguration,
  seedTenant,
  staffAct,
  submitRequest,
  type Harness,
  type Tenant,
} from './fixtures.ts';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h?.close();
});
beforeEach(async () => {
  await h.owner.query('DELETE FROM notification_outbox');
  await h.owner.query('DELETE FROM email_suppressions');
  h.mailer.sent.length = 0;
  h.mailer.failNext = 0;
  h.edge.puts.length = 0;
  h.edge.deletes.length = 0;
});

const SEC = 1000;

function captureLog() {
  const lines: Record<string, unknown>[] = [];
  return { lines, log: createLogger('debug', {}, l => lines.push(JSON.parse(l) as Record<string, unknown>)) };
}

async function requestScenario(opts: { customerEmail?: string } = {}) {
  const t = await seedTenant(h.owner);
  const customer = await seedCustomer(h.owner, t, { email: opts.customerEmail });
  const conf = await seedLockedConfiguration(h.owner, t, customer.id);
  const requestId = await submitRequest(h.owner, t, customer.id, conf);
  return { t, customer, requestId };
}

describe('drainOutbox', () => {
  it('sends the customer confirmation and one mail per active reseller admin', async () => {
    const { t, customer, requestId } = await requestScenario();
    const result = await drainOutbox(h.deps());

    expect(result).toMatchObject({ sent: 2, retried: 0, deadLettered: 0 }); // TENANT_SYNC + REQUEST_SUBMITTED
    expect(h.edge.puts).toContainEqual([t.slug, 'ACTIVE']);
    const recipients = h.mailer.sent.map(m => m.to).sort();
    expect(recipients).toHaveLength(3); // customer + 2 active admins, not the disabled one
    expect(recipients).toContain(customer.email);
    expect(recipients.filter(r => r.startsWith('staff2.'))).toHaveLength(0);

    const toCustomer = h.mailer.sent.find(m => m.to === customer.email)!;
    expect(toCustomer).toMatchObject({ fromName: 'Alpha Saunas', replyTo: 'help@alpha.test', resellerId: t.resellerId });
    expect(toCustomer.subject).toContain(`REQ-${requestId.replace(/-/g, '').slice(0, 8).toUpperCase()}`);
    expect(toCustomer.html).toContain(`https://${t.slug}.saunas.test/account/requests/${requestId}`);
    expect(toCustomer.text).toContain('12,900.00');
    const toStaff = h.mailer.sent.find(m => m.to !== customer.email)!;
    expect(toStaff.text).not.toContain('Please call me'); // free text stays in the admin panel (column grants)
    expect(toStaff.html).not.toContain('Doe'); // the worker cannot read last names

    expect((await outboxRows(h.owner)).every(r => r.sent_at !== null)).toBe(true);
    // Idempotent: nothing left to send.
    expect(await drainOutbox(h.deps())).toMatchObject({ claimed: 0, sent: 0 });
    expect(h.mailer.sent).toHaveLength(3);
  });

  it('mails status changes with the note and quotes with amount and validity', async () => {
    const { t, customer, requestId } = await requestScenario();
    await drainOutbox(h.deps());
    h.mailer.sent.length = 0;

    await staffAct(h.owner, t, c => c.query(`UPDATE configuration_requests SET status_code = 'IN_REVIEW' WHERE id = $1`, [requestId]), 'We are on it');
    await staffAct(h.owner, t, async c => {
      await c.query(
        `INSERT INTO request_quotes (request_id, reseller_id, amount_minor, currency_code, valid_until, created_by_staff_id)
         VALUES ($1, $2, 1150000, 'EUR', '2030-01-31T00:00:00Z', $3)`,
        [requestId, t.resellerId, t.staffIds[0]],
      );
      await c.query(`UPDATE configuration_requests SET status_code = 'QUOTED' WHERE id = $1`, [requestId]);
    });
    const result = await drainOutbox(h.deps());

    expect(result.deadLettered).toBe(0);
    expect(h.mailer.sent.map(m => m.to)).toEqual([customer.email, customer.email]); // QUOTED status mail folds into the quote mail
    // Rows run concurrently, so match mails by content rather than order.
    const quote = h.mailer.sent.find(m => m.text.includes('11,500.00'));
    const status = h.mailer.sent.find(m => m !== quote);
    expect(status!.text).toContain('We are on it');
    expect(status!.subject).toMatch(/review/i);
    expect(quote!.text).toContain('2030');
  });

  it('honours suppressions case-insensitively', async () => {
    const email = `Mixed.Case.${Date.now()}@Example.test`;
    await h.owner.query(`INSERT INTO email_suppressions (email_lower, reason) VALUES ($1, 'BOUNCE')`, [email.toLowerCase()]);
    await requestScenario({ customerEmail: email });
    await drainOutbox(h.deps());
    expect(h.mailer.sent.map(m => m.to.toLowerCase())).not.toContain(email.toLowerCase());
    expect(h.mailer.sent).toHaveLength(2); // the admins still get theirs
  });

  it('backs off exponentially and dead-letters after maxAttempts without storing addresses', async () => {
    const { lines, log } = captureLog();
    await requestScenario();
    await h.owner.query(`UPDATE notification_outbox SET sent_at = now() WHERE event_type = 'TENANT_SYNC'`);
    h.mailer.failNext = 1000;
    const t0 = new Date(Date.now() + SEC);
    const at = (ms: number) => () => new Date(t0.getTime() + ms);

    expect(await drainOutbox(h.deps({ log, now: at(0), maxAttempts: 3 }))).toMatchObject({ retried: 1 });
    const pending = async () => (await outboxRows(h.owner)).filter(r => r.event_type === 'REQUEST_SUBMITTED');
    let [row] = await pending();
    expect(row!.attempts).toBe(1);
    expect(row!.available_at.getTime()).toBe(t0.getTime() + 30 * SEC);
    expect(row!.last_error).toContain('[email]');
    expect(row!.last_error).not.toMatch(/@/);

    expect(await drainOutbox(h.deps({ log, now: at(29 * SEC), maxAttempts: 3 }))).toMatchObject({ claimed: 0 });
    expect(await drainOutbox(h.deps({ log, now: at(31 * SEC), maxAttempts: 3 }))).toMatchObject({ retried: 1 });
    [row] = await pending();
    expect(row!.available_at.getTime()).toBe(t0.getTime() + 91 * SEC); // 31 s + 60 s

    expect(await drainOutbox(h.deps({ log, now: at(100 * SEC), maxAttempts: 3 }))).toMatchObject({ deadLettered: 1 });
    [row] = await pending();
    expect(row!.failed_at).not.toBeNull();
    expect(row!.attempts).toBe(3);
    const dead = lines.find(l => l.msg === 'outbox.dead_letter');
    expect(dead).toMatchObject({ level: 'error', eventType: 'REQUEST_SUBMITTED', attempts: 3 });
    expect(JSON.stringify(lines)).not.toMatch(/@example\.test|@alpha\.test/);

    expect(await drainOutbox(h.deps({ now: at(10_000 * SEC) }))).toMatchObject({ claimed: 0 });
  });

  it('dead-letters unknown event types at once', async () => {
    await h.owner.query(`INSERT INTO notification_outbox (event_type, payload) VALUES ('MYSTERY_EVENT', '{}')`);
    expect(await drainOutbox(h.deps())).toMatchObject({ deadLettered: 1 });
    const [row] = await outboxRows(h.owner);
    expect(row!.failed_at).not.toBeNull();
    expect(row!.last_error).toContain('unknown event type');
  });

  it('syncs tenants to the edge store, removing a previous slug', async () => {
    const t: Tenant = await seedTenant(h.owner);
    const renamed = `${t.slug}-new`;
    await h.owner.query(`UPDATE resellers SET slug = $2, status = 'SUSPENDED' WHERE id = $1`, [t.resellerId, renamed]);
    await drainOutbox(h.deps());
    // Both events converge on the current row state.
    expect(h.edge.puts).toEqual([
      [renamed, 'SUSPENDED'],
      [renamed, 'SUSPENDED'],
    ]);
    expect(h.edge.deletes).toEqual([t.slug]);
  });

  it('never processes a row twice when drains run in parallel (SKIP LOCKED)', async () => {
    await h.owner.query(
      `INSERT INTO notification_outbox (event_type, payload)
       SELECT 'TENANT_SYNC', jsonb_build_object('slug', 'tenant-' || g, 'status', 'ACTIVE') FROM generate_series(1, 60) g`,
    );
    const slowEdge = {
      puts: [] as string[],
      async put(slug: string) {
        await new Promise(r => setTimeout(r, 2));
        slowEdge.puts.push(slug);
      },
      async delete() {},
    };
    const opts = h.deps({ edge: slowEdge, batchSize: 5, concurrency: 3, maxBatches: 100 });
    const results = await Promise.all([drainOutbox(opts), drainOutbox(opts), drainOutbox(opts)]);

    expect(results.reduce((n, r) => n + r.sent, 0)).toBe(60);
    expect(slowEdge.puts).toHaveLength(60);
    expect(new Set(slowEdge.puts).size).toBe(60);
    expect((await outboxRows(h.owner)).every(r => r.sent_at !== null && r.attempts === 0)).toBe(true);
  });

  it('reclaims rows whose lease expired (crashed worker)', async () => {
    await h.owner.query(`INSERT INTO notification_outbox (event_type, payload) VALUES ('TENANT_SYNC', '{"slug":"lease","status":"ACTIVE"}')`);
    await h.owner.query(`UPDATE notification_outbox SET locked_until = now() + interval '2 minutes'`);
    expect(await drainOutbox(h.deps())).toMatchObject({ claimed: 0 });
    expect(await drainOutbox(h.deps({ now: () => new Date(Date.now() + 3 * 60 * SEC) }))).toMatchObject({ sent: 1 });
  });

  it('local worker drains on nudge and stops cleanly', async () => {
    const worker = startLocalWorker(h.deps(), { intervalMs: 60_000, retentionIntervalMs: 0 });
    await h.owner.query(`INSERT INTO notification_outbox (event_type, payload) VALUES ('TENANT_SYNC', '{"slug":"nudged","status":"ACTIVE"}')`);
    worker.nudge();
    await expect.poll(() => h.edge.puts.some(([slug]) => slug === 'nudged'), { timeout: 5000 }).toBe(true);
    await worker.stop();
  });
});
