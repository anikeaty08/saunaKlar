/**
 * Typed pg client helpers.
 *
 * Every application query runs inside withTx(): BEGIN; SET LOCAL ROLE <role>; transaction-local
 * set_config() for the tenant and actor; fn(client); COMMIT (ROLLBACK on error). Nothing is set
 * at session level, so pooled connections (and RDS Proxy) never carry state between requests.
 */
import pg from 'pg';

export type DbRole = 'app_tenant' | 'app_platform' | 'app_worker' | 'catalog_admin' | 'idp_local';
export const DB_ROLES: readonly DbRole[] = ['app_tenant', 'app_platform', 'app_worker', 'catalog_admin', 'idp_local'];

export interface TxContext {
  role: DbRole;
  /** app.reseller_id: the tenant (from the Host header). Required for app_tenant to see rows. */
  resellerId?: string | null;
  /** app.actor_staff_id: staff user acting (audit, request history, transition actor kind). */
  actorStaffId?: string | null;
  /** app.actor_customer_id: customer acting; narrows PII/request rows to that customer. */
  actorCustomerId?: string | null;
  /** SET TRANSACTION READ ONLY. */
  readOnly?: boolean;
  isolation?: 'read committed' | 'repeatable read' | 'serializable';
}

export type Queryable = Pick<pg.PoolClient, 'query'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function int8(value: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) throw new RangeError(`bigint ${value} exceeds Number.MAX_SAFE_INTEGER`);
  return n;
}

/**
 * Type parsers for this package's pools: bigint (minor units, counters, identity ids) and
 * numeric (attribute values, rotation) become numbers. Everything else keeps pg's defaults.
 */
export const typeParsers: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => {
    if (format !== 'binary') {
      if (oid === pg.types.builtins.INT8) return int8;
      if (oid === pg.types.builtins.NUMERIC) return (v: string) => Number(v);
    }
    return (pg.types.getTypeParser as (oid: number, format?: string) => unknown)(oid, format);
  }) as pg.CustomTypesConfig['getTypeParser'],
};

export function createPool(url: string, options: Omit<pg.PoolConfig, 'connectionString'> = {}): pg.Pool {
  const pool = new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000, types: typeParsers, ...options });
  // An idle client error (e.g. server restart) must not crash the process.
  pool.on('error', () => {});
  return pool;
}

function checkUuid(name: string, value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  if (!UUID_RE.test(value)) throw new TypeError(`withTx: ${name} must be a UUID`);
  return value;
}

/** Runs fn in one transaction with the given role and tenant/actor context. */
export async function withTx<T>(pool: pg.Pool, ctx: TxContext, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  if (!DB_ROLES.includes(ctx.role)) throw new TypeError(`withTx: unknown role ${String(ctx.role)}`);
  const resellerId = checkUuid('resellerId', ctx.resellerId);
  const staffId = checkUuid('actorStaffId', ctx.actorStaffId);
  const customerId = checkUuid('actorCustomerId', ctx.actorCustomerId);
  if (staffId && customerId) throw new TypeError('withTx: set actorStaffId or actorCustomerId, not both');

  const client = await pool.connect();
  let broken = false;
  try {
    const mode = [
      ctx.isolation ? `ISOLATION LEVEL ${ctx.isolation.toUpperCase()}` : '',
      ctx.readOnly ? 'READ ONLY' : '',
    ].filter(Boolean).join(' ');
    await client.query(mode ? `BEGIN ${mode}` : 'BEGIN');
    try {
      // The role name is from the closed DB_ROLES list, so interpolation is safe.
      await client.query(`SET LOCAL ROLE ${ctx.role}`);
      await client.query(
        `SELECT set_config('app.reseller_id', $1, true), set_config('app.actor_staff_id', $2, true),
                set_config('app.actor_customer_id', $3, true), set_config('app.status_note', '', true)`,
        [resellerId, staffId, customerId],
      );
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw err;
    }
  } catch (err) {
    // BEGIN itself failed (or ROLLBACK did): the connection state is unknown, discard it.
    if (!broken && isConnectionError(err)) broken = true;
    throw err;
  } finally {
    client.release(broken ? true : undefined);
  }
}

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return typeof code === 'string' && (code.startsWith('08') || code === '57P01' || code === '57P02' || code === '57P03');
}

/** Sets the note stored in request_status_history (and the outbox payload) for the next status change. */
export async function setStatusNote(client: Queryable, note: string | null): Promise<void> {
  await client.query(`SELECT set_config('app.status_note', $1, true)`, [note ?? '']);
}

// ---------------------------------------------------------------------------------------------
// sql`...` tagged template: values become $n parameters; nested sql fragments are inlined.
// ---------------------------------------------------------------------------------------------
export class SqlQuery {
  readonly strings: readonly string[];
  readonly params: readonly unknown[];

  // No TS parameter properties: Node's type stripping must be able to run this file as is.
  constructor(strings: readonly string[], params: readonly unknown[]) {
    this.strings = strings;
    this.params = params;
  }

  get text(): string {
    return this.build().text;
  }

  get values(): unknown[] {
    return this.build().values;
  }

  private build(offset = 0): { text: string; values: unknown[] } {
    let text = this.strings[0] ?? '';
    const values: unknown[] = [];
    this.params.forEach((p, i) => {
      if (p instanceof SqlQuery) {
        const inner = p.build(offset + values.length);
        text += inner.text;
        values.push(...inner.values);
      } else {
        values.push(p);
        text += `$${offset + values.length}`;
      }
      text += this.strings[i + 1] ?? '';
    });
    return { text, values };
  }
}

export function sql(strings: TemplateStringsArray, ...values: unknown[]): SqlQuery {
  return new SqlQuery([...strings], values);
}

/** Joins fragments with a separator, e.g. join([sql`a = ${1}`, sql`b = ${2}`], ' AND '). */
sql.join = (parts: readonly SqlQuery[], separator: string): SqlQuery =>
  new SqlQuery(['', ...parts.slice(1).map(() => separator), ''].slice(0, parts.length + 1), parts);

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(db: Queryable, q: SqlQuery): Promise<R[]> {
  const { rows } = await db.query<R>(q.text, q.values);
  return rows;
}

export async function queryOne<R extends pg.QueryResultRow = pg.QueryResultRow>(db: Queryable, q: SqlQuery): Promise<R | undefined> {
  return (await query<R>(db, q))[0];
}
