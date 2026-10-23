import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { setStatusNote } from '../src/index.ts';
import { ALPHA, BETA, SEED, count, draft, expectCode, lock, one, setupEnv, tenant, type Env } from './helpers.ts';

let env: Env;
beforeAll(async () => { env = await setupEnv(); });
afterAll(async () => { await env?.close(); });

const anna = SEED.customers.annaAlpha;
const ben = SEED.customers.benAlpha;
const owner = SEED.staff.alphaOwner;
const asAnna = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tenant(env, ALPHA, fn, { actorCustomerId: anna });
const asBen = <T>(fn: (c: pg.PoolClient) => Promise<T>) => tenant(env, ALPHA, fn, { actorCustomerId: ben });
const asStaff = <T>(fn: (c: pg.PoolClient) => Promise<T>, staff: string = owner) => tenant(env, ALPHA, fn, { actorStaffId: staff });

const lockedForAnna = () => asAnna(async c => {
  const id = await draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: ['spruce', 'heater-6kw', 'door-clear'] });
  await lock(c, id);
  return id;
});
const send = (configurationId: string, customer = anna) => (customer === anna ? asAnna : asBen)(async c => (await one<{ id: string }>(c,
  `INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id, message) VALUES ($1, $2, $3, 'hello') RETURNING id`,
  [ALPHA, customer, configurationId])).id);
const move = (id: string, to: string, tx: typeof asStaff | typeof asAnna = asStaff, note?: string) => tx(async c => {
  if (note) await setStatusNote(c, note);
  await c.query(`UPDATE configuration_requests SET status_code = $2 WHERE id = $1`, [id, to]);
});
const quote = (id: string, validFor = '14 days', staff = owner) => asStaff(c => one<{ id: string }>(c,
  `INSERT INTO request_quotes (request_id, reseller_id, amount_minor, currency_code, valid_until, created_by_staff_id)
   VALUES ($1, $2, 700000, 'EUR', now() + $3::interval, $4) RETURNING id`, [id, ALPHA, validFor, staff]), staff);

describe('rule 7: sending a request', () => {
  it('requires a locked configuration', async () => {
    const id = await asAnna(c => draft(c, { reseller: ALPHA, model: 'espoo-compact', customer: anna, options: [] }));
    await expectCode(send(id), 'CONFIGURATION_NOT_LOCKED');
  });

  it('must be sent by the owning customer (not staff, not another customer)', async () => {
    const id = await lockedForAnna();
    await expectCode(asStaff(c => c.query(`INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id) VALUES ($1, $2, $3)`,
      [ALPHA, anna, id])), 'REQUEST_NOT_OWNER');
    await expectCode(asBen(c => c.query(`INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id) VALUES ($1, $2, $3)`,
      [ALPHA, anna, id])), 'REQUEST_NOT_OWNER');
    // ben as himself on anna's configuration: the composite FK (configuration, reseller, customer) refuses it
    await expectCode(send(id, ben), 'FOREIGN_KEY_VIOLATION');
  });

  it('starts as SUBMITTED', async () => {
    const id = await lockedForAnna();
    await expectCode(asAnna(c => c.query(`INSERT INTO configuration_requests (reseller_id, customer_id, configuration_id, status_code)
      VALUES ($1, $2, $3, 'QUOTED')`, [ALPHA, anna, id])), 'INVALID_TRANSITION');
  });

  it('writes history and a REQUEST_SUBMITTED outbox row; one request per configuration', async () => {
    const conf = await lockedForAnna();
    const id = await send(conf);
    const h = await one(env.owner, 'SELECT from_status, to_status, changed_by_customer_id FROM request_status_history WHERE request_id = $1', [id]);
    expect(h).toEqual({ from_status: null, to_status: 'SUBMITTED', changed_by_customer_id: anna });
    const o = await one<{ payload: Record<string, unknown> }>(env.owner,
      `SELECT payload FROM notification_outbox WHERE event_type = 'REQUEST_SUBMITTED' AND payload->>'requestId' = $1`, [id]);
    expect(o.payload).toMatchObject({ requestId: id, configurationId: conf, customerId: anna, fromStatus: null, toStatus: 'SUBMITTED', actorKind: 'CUSTOMER' });
    expect(JSON.stringify(o.payload)).not.toContain('@');
    await expectCode(send(conf), 'UNIQUE_VIOLATION');
  });
});

describe('rule 7: status workflow', () => {
  let req = '';
  beforeAll(async () => { req = await send(await lockedForAnna()); });

  it('rejects transitions the actor kind may not make', async () => {
    await expectCode(move(req, 'IN_REVIEW', asAnna), 'INVALID_TRANSITION', 'SUBMITTED->IN_REVIEW');
    await expectCode(move(req, 'ACCEPTED'), 'INVALID_TRANSITION');
    await expectCode(move(req, 'NOPE'), 'INVALID_TRANSITION'); // unknown status: no transition leads there
  });

  it('rejects staff of another reseller and customers who do not own the request', async () => {
    await expectCode(asStaff(c => c.query(`UPDATE configuration_requests SET status_code = 'IN_REVIEW' WHERE id = $1`, [req]), SEED.staff.betaOwner),
      'STAFF_NOT_RESELLER_ADMIN');
    // ben cannot even see anna's request (RLS narrows customers to their own rows)
    const r = await asBen(c => c.query(`UPDATE configuration_requests SET status_code = 'CANCELLED' WHERE id = $1`, [req]));
    expect(r.rowCount).toBe(0);
  });

  it('staff moves SUBMITTED -> IN_REVIEW with a note in history, outbox and audit', async () => {
    await move(req, 'IN_REVIEW', asStaff, 'Looking at it');
    const h = await one(env.owner, `SELECT from_status, to_status, changed_by_staff_id, note FROM request_status_history WHERE request_id = $1 ORDER BY id DESC LIMIT 1`, [req]);
    expect(h).toEqual({ from_status: 'SUBMITTED', to_status: 'IN_REVIEW', changed_by_staff_id: owner, note: 'Looking at it' });
    const o = await one<{ payload: Record<string, unknown> }>(env.owner,
      `SELECT payload FROM notification_outbox WHERE event_type = 'REQUEST_STATUS_CHANGED' AND payload->>'requestId' = $1`, [req]);
    expect(o.payload).toMatchObject({ fromStatus: 'SUBMITTED', toStatus: 'IN_REVIEW', actorKind: 'STAFF', note: 'Looking at it' });
    expect(await count(env.owner, `SELECT 1 FROM audit_events WHERE action = 'configuration_requests.update' AND entity_id = $1`, [req])).toBe(1);
  });

  it('only the status can change', async () => {
    await expectCode(env.owner.query(`UPDATE configuration_requests SET message = 'edited' WHERE id = $1`, [req]), 'REQUEST_IMMUTABLE');
    await expectCode(asStaff(c => c.query(`UPDATE configuration_requests SET message = 'edited' WHERE id = $1`, [req])), 'INSUFFICIENT_PRIVILEGE');
  });

  it('QUOTED needs an active quote', async () => {
    await expectCode(move(req, 'QUOTED'), 'QUOTE_MISSING');
  });

  it('a quote writes QUOTE_ADDED; a new quote supersedes the active one', async () => {
    const q1 = await quote(req);
    const q2 = await quote(req, '30 days');
    const { rows } = await env.owner.query<{ id: string; superseded: boolean }>(
      'SELECT id, superseded_at IS NOT NULL AS superseded FROM request_quotes WHERE request_id = $1 ORDER BY created_at, superseded_at NULLS LAST', [req]);
    expect(rows).toEqual([{ id: q1.id, superseded: true }, { id: q2.id, superseded: false }]);
    expect(await count(env.owner, `SELECT 1 FROM notification_outbox WHERE event_type = 'QUOTE_ADDED' AND payload->>'requestId' = $1`, [req])).toBe(2);
    await expectCode(asStaff(c => c.query(`UPDATE request_quotes SET amount_minor = 1 WHERE id = $1`, [q2.id])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(env.owner.query(`UPDATE request_quotes SET amount_minor = 1 WHERE id = $1`, [q2.id]), 'QUOTE_IMMUTABLE');
  });

  it('a quote must be in the reseller currency and written by its staff', async () => {
    await expectCode(asStaff(c => c.query(`INSERT INTO request_quotes (request_id, reseller_id, amount_minor, currency_code, valid_until, created_by_staff_id)
      VALUES ($1, $2, 1, 'CHF', now() + interval '1 day', $3)`, [req, ALPHA, owner])), 'FOREIGN_KEY_VIOLATION');
    await expectCode(quote(req, '1 day', SEED.staff.betaOwner), 'STAFF_NOT_RESELLER_ADMIN');
  });

  it('staff moves to QUOTED; the customer accepts; staff closes; terminal states stay terminal', async () => {
    await move(req, 'QUOTED');
    await expectCode(move(req, 'ACCEPTED'), 'INVALID_TRANSITION'); // staff cannot accept
    await move(req, 'ACCEPTED', asAnna);
    await move(req, 'CLOSED');
    await expectCode(move(req, 'CANCELLED'), 'INVALID_TRANSITION');
    const { rows } = await env.owner.query<{ to_status: string }>('SELECT to_status FROM request_status_history WHERE request_id = $1 ORDER BY id', [req]);
    expect(rows.map(r => r.to_status)).toEqual(['SUBMITTED', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'CLOSED']);
  });

  it('history is append-only', async () => {
    await expectCode(asStaff(c => c.query(`UPDATE request_status_history SET note = 'x' WHERE request_id = $1`, [req])), 'INSUFFICIENT_PRIVILEGE');
    await expectCode(env.owner.query(`UPDATE request_status_history SET note = 'x' WHERE request_id = $1`, [req]), 'APPEND_ONLY');
  });
});

describe('rule 7: quotes, expiry and cancellation', () => {
  it('refuses a quote on a SUBMITTED request', async () => {
    const req = await send(await lockedForAnna());
    await expectCode(quote(req), 'REQUEST_NOT_QUOTABLE');
  });

  it('refuses acceptance after the active quote expired', async () => {
    const req = await send(await lockedForAnna());
    await move(req, 'IN_REVIEW');
    const q = await quote(req);
    await move(req, 'QUOTED');
    // Backdate the quote (bypassing triggers as the owner, as only a test may).
    const c = await env.owner.connect();
    try {
      await c.query(`SET session_replication_role = replica`);
      await c.query(`UPDATE request_quotes SET created_at = now() - interval '20 days', valid_until = now() - interval '1 day' WHERE id = $1`, [q.id]);
      await c.query(`SET session_replication_role = origin`);
    } finally {
      c.release();
    }
    await expectCode(move(req, 'ACCEPTED', asAnna), 'QUOTE_EXPIRED');
    // re-quote path: staff goes back to IN_REVIEW, adds a fresh quote, quotes again, customer accepts
    await move(req, 'IN_REVIEW');
    await quote(req);
    await move(req, 'QUOTED');
    await move(req, 'ACCEPTED', asAnna);
  });

  it('lets the customer cancel an open request but not a closed one', async () => {
    const req = await send(await lockedForAnna());
    await move(req, 'CANCELLED', asAnna);
    expect((await one<{ s: string }>(env.owner, 'SELECT status_code AS s FROM configuration_requests WHERE id = $1', [req])).s).toBe('CANCELLED');
    await expectCode(move(req, 'IN_REVIEW'), 'INVALID_TRANSITION');
  });

  it('rejects an actor context with both staff and customer set', async () => {
    const req = await send(await lockedForAnna());
    const c = await env.owner.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT set_config('app.actor_staff_id', $1, true), set_config('app.actor_customer_id', $2, true)`, [owner, anna]);
      await expectCode(c.query(`UPDATE configuration_requests SET status_code = 'CANCELLED' WHERE id = $1`, [req]), 'ACTOR_AMBIGUOUS');
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  });
});

describe('request notes', () => {
  it('are written by reseller staff and hidden from customers', async () => {
    const req = SEED.configurations.annaInReview;
    const reqId = (await one<{ id: string }>(env.owner, 'SELECT id FROM configuration_requests WHERE configuration_id = $1', [req])).id;
    await asStaff(c => c.query(`INSERT INTO request_notes (request_id, reseller_id, author_staff_id, body) VALUES ($1, $2, $3, 'internal')`, [reqId, ALPHA, owner]));
    expect(await asStaff(c => count(c, 'SELECT 1 FROM request_notes WHERE request_id = $1', [reqId]))).toBe(2);
    expect(await asAnna(c => count(c, 'SELECT 1 FROM request_notes'))).toBe(0);
    await expectCode(asStaff(c => c.query(`INSERT INTO request_notes (request_id, reseller_id, author_staff_id, body) VALUES ($1, $2, $3, 'x')`,
      [reqId, ALPHA, SEED.staff.betaOwner])), 'STAFF_NOT_RESELLER_ADMIN');
    await expectCode(tenant(env, BETA, c => c.query(`INSERT INTO request_notes (request_id, reseller_id, author_staff_id, body) VALUES ($1, $2, $3, 'x')`,
      [reqId, BETA, SEED.staff.betaOwner])), 'FOREIGN_KEY_VIOLATION');
  });

  it('a customer sees its own request with history and quotes, not other customers\' requests', async () => {
    expect(await asAnna(c => count(c, 'SELECT 1 FROM configuration_requests WHERE customer_id <> $1', [anna]))).toBe(0);
    expect(await asBen(c => count(c, 'SELECT 1 FROM configuration_requests'))).toBe(1);
    expect(await asBen(c => count(c, 'SELECT 1 FROM request_quotes'))).toBe(0);
    expect(await asAnna(c => count(c, 'SELECT 1 FROM request_status_history h JOIN configuration_requests r ON r.id = h.request_id'))).toBeGreaterThan(5);
    // The API's lookup of a configuration's request works under RLS.
    const r = await asAnna(c => one<{ status_code: string }>(c, 'SELECT id, status_code FROM configuration_requests WHERE configuration_id = $1',
      [SEED.configurations.annaQuoted]));
    expect(r.status_code).toBe('QUOTED');
  });
});
