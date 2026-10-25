import { randomUUID } from 'node:crypto';
import type { Queryable, QueryResultLike, TxRunner } from '../../../src/adapters/types.ts';

/**
 * In-memory stand-in for the `idp` schema that understands exactly the statements in
 * src/adapters/idp/local-store.ts. Transactions snapshot the state and restore it on throw,
 * so tests observe the same commit/rollback behaviour as Postgres.
 */
interface State {
  users: Map<string, Record<string, any>>;
  codes: Map<string, Record<string, any>>;
  challenges: Map<string, Record<string, any>>;
  refresh: Map<string, Record<string, any>>;
}

const hex = (b: unknown) => (Buffer.isBuffer(b) ? b.toString('hex') : String(b));
const clone = (s: State): State => ({
  users: new Map([...s.users].map(([k, v]) => [k, structuredClone(v)])),
  codes: new Map([...s.codes].map(([k, v]) => [k, structuredClone(v)])),
  challenges: new Map([...s.challenges].map(([k, v]) => [k, structuredClone(v)])),
  refresh: new Map([...s.refresh].map(([k, v]) => [k, { ...v }])),
});

export class FakeIdpDb implements Queryable {
  state: State = { users: new Map(), codes: new Map(), challenges: new Map(), refresh: new Map() };
  statements: string[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  readonly tx: TxRunner = async (fn) => {
    const snapshot = clone(this.state);
    try {
      return await fn(this);
    } catch (e) {
      this.state = snapshot;
      throw e;
    }
  };

  async query<R extends Record<string, unknown>>(text: string, values: readonly unknown[] = []): Promise<QueryResultLike<R>> {
    const sql = text.replace(/\s+/g, ' ').trim();
    this.statements.push(sql);
    const v = values as any[];
    const rows = (r: any[]): QueryResultLike<R> => ({ rows: r as R[], rowCount: r.length });
    const s = this.state;
    const now = this.now();

    // ---- users
    if (sql.startsWith('SELECT') && sql.includes('FROM idp.users WHERE pool = $1 AND username = $2')) {
      return rows([...s.users.values()].filter((u) => u.pool === v[0] && u.username === v[1]).map((u) => structuredClone(u)));
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM idp.users WHERE sub = $1')) {
      const u = s.users.get(v[0]);
      return rows(u ? [structuredClone(u)] : []);
    }
    if (sql.startsWith('INSERT INTO idp.users')) {
      if ([...s.users.values()].some((u) => u.pool === v[1] && u.username === v[2]) || s.users.has(v[0])) {
        throw Object.assign(new Error('duplicate key'), { code: '23505' });
      }
      s.users.set(v[0], {
        sub: v[0], pool: v[1], username: v[2], email: v[3], password_hash: v[4], status: v[5], attributes: JSON.parse(v[6]),
        email_verified: false, mfa_secret: null, mfa_enabled: false, created_at: now, updated_at: now,
      });
      return rows([]);
    }
    if (sql.startsWith('UPDATE idp.users SET attributes')) {
      const u = s.users.get(v[0])!;
      for (const k of v[1] as string[]) delete u.attributes[k];
      Object.assign(u.attributes, JSON.parse(v[2]));
      return rows([]);
    }
    if (sql.startsWith('UPDATE idp.users SET')) {
      const u = s.users.get(v[0]);
      if (u) {
        const sets = sql.slice('UPDATE idp.users SET '.length, sql.indexOf(' WHERE')).split(', ');
        for (const set of sets) {
          const [col, param] = set.split(' = ') as [string, string];
          u[col] = v[Number(param.slice(1)) - 1];
        }
        u.updated_at = now;
      }
      return rows([]);
    }
    if (sql === 'DELETE FROM idp.users WHERE sub = $1') {
      s.users.delete(v[0]);
      for (const map of [s.codes, s.challenges, s.refresh]) for (const [k, r] of map) if (r.sub === v[0]) map.delete(k);
      return rows([]);
    }

    // ---- codes
    if (sql.startsWith('INSERT INTO idp.codes')) {
      s.codes.set(`${v[0]}:${v[1]}`, { sub: v[0], purpose: v[1], code_hash: v[2], expires_at: v[3], attempts: 0 });
      return rows([]);
    }
    if (sql.startsWith('SELECT code_hash')) {
      const c = s.codes.get(`${v[0]}:${v[1]}`);
      return rows(c ? [{ ...c }] : []);
    }
    if (sql.startsWith('UPDATE idp.codes SET attempts')) {
      const c = s.codes.get(`${v[0]}:${v[1]}`);
      if (c) c.attempts++;
      return rows([]);
    }
    if (sql.startsWith('DELETE FROM idp.codes')) {
      const key = `${v[0]}:${v[1]}`;
      const c = s.codes.get(key);
      if (c && (v.length < 3 || c.attempts >= v[2])) s.codes.delete(key);
      return rows([]);
    }

    // ---- challenges
    if (sql.startsWith('INSERT INTO idp.mfa_challenges')) {
      const id = randomUUID();
      s.challenges.set(id, { id, sub: v[0], kind: v[1], expires_at: v[2], attempts: 0 });
      return rows([{ id }]);
    }
    if (sql.startsWith('SELECT id, sub, kind')) {
      const c = s.challenges.get(v[0]);
      return rows(c ? [{ ...c }] : []);
    }
    if (sql.startsWith('UPDATE idp.mfa_challenges SET attempts')) {
      const c = s.challenges.get(v[0]);
      if (c) c.attempts++;
      return rows([]);
    }
    if (sql === 'DELETE FROM idp.mfa_challenges WHERE id = $1 AND attempts >= $2') {
      const c = s.challenges.get(v[0]);
      if (c && c.attempts >= v[1]) s.challenges.delete(v[0]);
      return rows([]);
    }
    if (sql === 'DELETE FROM idp.mfa_challenges WHERE id = $1') {
      s.challenges.delete(v[0]);
      return rows([]);
    }
    if (sql === 'DELETE FROM idp.mfa_challenges WHERE sub = $1') {
      for (const [k, c] of s.challenges) if (c.sub === v[0]) s.challenges.delete(k);
      return rows([]);
    }

    // ---- refresh tokens
    if (sql.startsWith('INSERT INTO idp.refresh_tokens')) {
      s.refresh.set(hex(v[0]), { sub: v[1], family_id: v[2], expires_at: v[3], revoked_at: null, replaced_by: null });
      return rows([]);
    }
    if (sql.startsWith('SELECT sub, family_id')) {
      const r = s.refresh.get(hex(v[0]));
      return rows(r ? [{ ...r }] : []);
    }
    if (sql.startsWith('UPDATE idp.refresh_tokens SET revoked_at = now(), replaced_by')) {
      const r = s.refresh.get(hex(v[0]))!;
      Object.assign(r, { revoked_at: now, replaced_by: v[1] });
      return rows([]);
    }
    if (sql.startsWith('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE family_id')) {
      for (const r of s.refresh.values()) if (r.family_id === v[0] && !r.revoked_at) r.revoked_at = now;
      return rows([]);
    }
    if (sql.startsWith('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE sub')) {
      for (const r of s.refresh.values()) if (r.sub === v[0] && !r.revoked_at) r.revoked_at = now;
      return rows([]);
    }
    throw new Error(`FakeIdpDb: unsupported statement: ${sql}`);
  }
}
