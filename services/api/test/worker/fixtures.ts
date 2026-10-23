import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createTestDatabase } from '@saunaklar/db';
import type { EdgeTenantStatus, MailMessage } from '../../src/adapters/types.ts';
import { silentLogger } from '../../src/lib/log.ts';
import type { WorkerDeps } from '../../src/worker/handler.ts';

/**
 * Worker DB test harness: a fresh database from the migrations, an owner pool for seeding
 * and assertions, and an API-login pool (`sauna_api`) for the code under test, so the
 * `app_worker` grants are exercised for real.
 */
export interface Harness {
  owner: pg.Pool;
  api: pg.Pool;
  mailer: FakeMailer;
  edge: FakeEdge;
  deps(extra?: Partial<WorkerDeps>): WorkerDeps;
  close(): Promise<void>;
}

export class FakeMailer {
  readonly sent: MailMessage[] = [];
  failNext = 0;
  async send(message: MailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error(`SES rejected ${message.to}`);
    }
    this.sent.push(message);
    return { messageId: String(this.sent.length) };
  }
}

export class FakeEdge {
  readonly puts: [string, EdgeTenantStatus][] = [];
  readonly deletes: string[] = [];
  async put(slug: string, status: EdgeTenantStatus) {
    this.puts.push([slug, status]);
  }
  async delete(slug: string) {
    this.deletes.push(slug);
  }
}

export async function createHarness(): Promise<Harness> {
  const db = await createTestDatabase();
  const owner = new pg.Pool({ connectionString: db.url, max: 4 });
  const api = new pg.Pool({ connectionString: db.apiUrl, max: 8 });
  const mailer = new FakeMailer();
  const edge = new FakeEdge();
  return {
    owner,
    api,
    mailer,
    edge,
    deps: extra => ({ pool: api, mailer, edge, log: silentLogger, links: slug => `https://${slug}.saunas.test`, ...extra }),
    async close() {
      await Promise.all([owner.end(), api.end()]);
      await db.drop();
    },
  };
}

/** Runs `fn` as `role` with the given session settings (owner connection, SET LOCAL ROLE). */
export async function asRole<T>(
  pool: pg.Pool,
  role: string,
  settings: Record<string, string>,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SET LOCAL ROLE ${role}`);
    for (const [k, v] of Object.entries(settings)) await c.query('SELECT set_config($1, $2, true)', [k, v]);
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

export interface Tenant {
  manufacturerId: string;
  resellerId: string;
  slug: string;
  modelId: string;
  staffIds: string[];
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq++).toString(36)}`;

/** A reseller with branding, two active admins, one disabled admin and one assigned sauna. */
export async function seedTenant(owner: pg.Pool, opts: { supportEmail?: string } = {}): Promise<Tenant> {
  const u = uniq();
  const slug = `r${u}`;
  const { rows: [m] } = await owner.query<{ id: string }>(`INSERT INTO manufacturers (name) VALUES ('Maker') RETURNING id`);
  const { rows: [r] } = await owner.query<{ id: string }>(
    `INSERT INTO resellers (manufacturer_id, slug, name, currency_code) VALUES ($1, $2, 'Alpha Saunas GmbH', 'EUR') RETURNING id`,
    [m!.id, slug],
  );
  await owner.query(
    `INSERT INTO reseller_branding (reseller_id, display_name, primary_color, support_email) VALUES ($1, 'Alpha Saunas', '#2a4b3c', $2)`,
    [r!.id, opts.supportEmail ?? 'help@alpha.test'],
  );
  const staffIds: string[] = [];
  for (const [i, status] of (['ACTIVE', 'ACTIVE', 'DISABLED'] as const).entries()) {
    const { rows: [s] } = await owner.query<{ id: string }>(
      `INSERT INTO staff_users (email, display_name, idp_subject, status) VALUES ($1, $2, $3, $4) RETURNING id`,
      [`staff${i}.${u}@alpha.test`, `Staff ${i}`, `sub-${u}-${i}`, status],
    );
    await owner.query(`INSERT INTO reseller_admins (reseller_id, staff_user_id, role) VALUES ($1, $2, $3)`, [r!.id, s!.id, i === 0 ? 'OWNER' : 'ADMIN']);
    staffIds.push(s!.id);
  }
  const { rows: [model] } = await owner.query<{ id: string }>(
    `INSERT INTO sauna_models (manufacturer_id, sku, slug, status, name) VALUES ($1, $2, $3, 'ACTIVE', 'Nordic 200') RETURNING id`,
    [m!.id, `SKU-${u.toUpperCase()}`, `nordic-${u}`],
  );
  await owner.query(
    `INSERT INTO sauna_model_prices (sauna_model_id, currency_code, list_price_minor, max_discount_bps) VALUES ($1, 'EUR', 1290000, 1000)`,
    [model!.id],
  );
  await owner.query(`INSERT INTO reseller_saunas (reseller_id, sauna_model_id) VALUES ($1, $2)`, [r!.id, model!.id]);
  return { manufacturerId: m!.id, resellerId: r!.id, slug, modelId: model!.id, staffIds };
}

export async function seedCustomer(
  owner: pg.Pool,
  t: Tenant,
  opts: { status?: 'PENDING' | 'ACTIVE'; email?: string; createdAt?: Date } = {},
): Promise<{ id: string; email: string }> {
  const email = opts.email ?? `cust.${uniq()}@example.test`;
  const status = opts.status ?? 'ACTIVE';
  const { rows: [c] } = await owner.query<{ id: string }>(
    `INSERT INTO customers (reseller_id, email, first_name, last_name, status, email_verified_at, created_at)
     VALUES ($1, $2, 'Jane', 'Doe', $3, CASE WHEN $3 = 'ACTIVE' THEN now() END, coalesce($4, now())) RETURNING id`,
    [t.resellerId, email, status, opts.createdAt ?? null],
  );
  return { id: c!.id, email };
}

/** A locked configuration with a price snapshot, owned by the customer. */
export async function seedLockedConfiguration(owner: pg.Pool, t: Tenant, customerId: string): Promise<string> {
  const id = randomUUID();
  await asRole(owner, 'app_tenant', { 'app.reseller_id': t.resellerId, 'app.actor_customer_id': customerId }, async c => {
    await c.query(`INSERT INTO configurations (id, reseller_id, sauna_model_id, customer_id) VALUES ($1, $2, $3, $4)`, [id, t.resellerId, t.modelId, customerId]);
    await c.query(
      `INSERT INTO configuration_price_snapshots
         (configuration_id, currency_code, list_price_minor, options_total_minor, discount_amount_minor, final_price_minor, discount_source, max_discount_bps)
       VALUES ($1, 'EUR', 1290000, 0, 0, 1290000, 'NONE', 1000)`,
      [id],
    );
    await c.query(`UPDATE configurations SET locked_at = now() WHERE id = $1`, [id]);
  });
  return id;
}

/** Submits a request the way the customer API does: app_tenant + actor customer. */
export async function submitRequest(owner: pg.Pool, t: Tenant, customerId: string, configurationId: string): Promise<string> {
  return asRole(owner, 'app_tenant', { 'app.reseller_id': t.resellerId, 'app.actor_customer_id': customerId }, async c => {
    const { rows: [r] } = await c.query<{ id: string }>(
      `INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id, message) VALUES ($1, $2, $3, 'Please call me') RETURNING id`,
      [t.resellerId, customerId, configurationId],
    );
    return r!.id;
  });
}

export async function staffAct<T>(owner: pg.Pool, t: Tenant, fn: (c: pg.PoolClient) => Promise<T>, note?: string): Promise<T> {
  const settings: Record<string, string> = { 'app.reseller_id': t.resellerId, 'app.actor_staff_id': t.staffIds[0]! };
  if (note) settings['app.status_note'] = note;
  return asRole(owner, 'app_tenant', settings, fn);
}

export async function outboxRows(owner: pg.Pool) {
  const { rows } = await owner.query<{
    id: string;
    event_type: string;
    attempts: number;
    sent_at: Date | null;
    failed_at: Date | null;
    available_at: Date;
    last_error: string | null;
  }>(`SELECT id::text, event_type, attempts, sent_at, failed_at, available_at, last_error FROM notification_outbox ORDER BY id`);
  return rows;
}
