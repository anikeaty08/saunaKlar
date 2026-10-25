import type { ChallengeName, Pool, Queryable } from '../types.ts';

/**
 * SQL for the local identity provider against packages/db/migrations/local/0001_local_idp.sql:
 * idp.users, idp.codes (one live code per (sub, purpose)), idp.refresh_tokens (family rotation
 * via replaced_by), idp.mfa_challenges. Bookkeeping that has no column of its own (status before
 * a disable, last accepted TOTP step) lives under `idp:`-prefixed keys in users.attributes.
 */

export type UserStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'DISABLED' | 'FORCE_CHANGE_PASSWORD';
export type CodePurpose = 'SIGNUP' | 'RESET' | 'INVITE';

export const ATTR_STATUS_BEFORE_DISABLE = 'idp:status_before_disable';
export const ATTR_TOTP_LAST_STEP = 'idp:totp_last_step';

export interface UserRow {
  sub: string;
  pool: Pool;
  username: string;
  email: string;
  email_verified: boolean;
  password_hash: string | null;
  status: UserStatus;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  attributes: Record<string, string>;
  created_at: Date;
  updated_at: Date;
}

export interface CodeRow {
  code_hash: string;
  attempts: number;
  expires_at: Date;
}

export interface ChallengeRow {
  id: string;
  sub: string;
  kind: ChallengeName;
  attempts: number;
  expires_at: Date;
}

export interface RefreshRow {
  sub: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  replaced_by: Buffer | null;
}

type Row<T> = T & Record<string, unknown>;

const USER_COLUMNS =
  'sub, pool, username, email, email_verified, password_hash, status, mfa_secret, mfa_enabled, attributes, created_at, updated_at';

export const isUniqueViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

export const store = {
  async findUser(db: Queryable, pool: Pool, username: string, lock = false): Promise<UserRow | null> {
    // Usernames are stored lower-case (customer UUIDs, staff e-mails), matching Cognito's case-insensitive pools.
    const { rows } = await db.query<Row<UserRow>>(
      `SELECT ${USER_COLUMNS} FROM idp.users WHERE pool = $1 AND username = $2${lock ? ' FOR UPDATE' : ''}`,
      [pool, username.toLowerCase()],
    );
    return rows[0] ?? null;
  },

  async findUserBySub(db: Queryable, sub: string, lock = false): Promise<UserRow | null> {
    const { rows } = await db.query<Row<UserRow>>(`SELECT ${USER_COLUMNS} FROM idp.users WHERE sub = $1${lock ? ' FOR UPDATE' : ''}`, [sub]);
    return rows[0] ?? null;
  },

  async insertUser(
    db: Queryable,
    u: { sub: string; pool: Pool; username: string; email: string; passwordHash: string; status: UserStatus; attributes: Record<string, string> },
  ): Promise<void> {
    await db.query(
      `INSERT INTO idp.users (sub, pool, username, email, password_hash, status, attributes)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [u.sub, u.pool, u.username.toLowerCase(), u.email, u.passwordHash, u.status, JSON.stringify(u.attributes)],
    );
  },

  async updateUser(
    db: Queryable,
    sub: string,
    fields: Partial<{ password_hash: string; status: UserStatus; email_verified: boolean; mfa_secret: string | null; mfa_enabled: boolean }>,
  ): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    await db.query(`UPDATE idp.users SET ${sets} WHERE sub = $1`, [sub, ...entries.map(([, v]) => v)]);
  },

  /** Sets (string) or removes (null) internal attribute keys. */
  async setAttributes(db: Queryable, sub: string, attrs: Record<string, string | null>): Promise<void> {
    const set = Object.fromEntries(Object.entries(attrs).filter(([, v]) => v !== null));
    const remove = Object.keys(attrs).filter((k) => attrs[k] === null);
    await db.query(`UPDATE idp.users SET attributes = (attributes - $2::text[]) || $3::jsonb WHERE sub = $1`, [
      sub,
      remove,
      JSON.stringify(set),
    ]);
  },

  async deleteUser(db: Queryable, sub: string): Promise<void> {
    // codes, refresh tokens and challenges cascade.
    await db.query('DELETE FROM idp.users WHERE sub = $1', [sub]);
  },

  // ---- codes ------------------------------------------------------------------

  async replaceCode(db: Queryable, sub: string, purpose: CodePurpose, codeHash: string, expiresAt: Date): Promise<void> {
    await db.query(
      `INSERT INTO idp.codes (sub, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (sub, purpose) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at,
         attempts = 0, created_at = now()`,
      [sub, purpose, codeHash, expiresAt],
    );
  },

  async activeCode(db: Queryable, sub: string, purpose: CodePurpose): Promise<CodeRow | null> {
    const { rows } = await db.query<Row<CodeRow>>(
      'SELECT code_hash, attempts, expires_at FROM idp.codes WHERE sub = $1 AND purpose = $2 FOR UPDATE',
      [sub, purpose],
    );
    return rows[0] ?? null;
  },

  /** Counts a wrong guess; the code is deleted once `maxAttempts` is reached. */
  async failCodeAttempt(db: Queryable, sub: string, purpose: CodePurpose, maxAttempts: number): Promise<void> {
    await db.query('UPDATE idp.codes SET attempts = attempts + 1 WHERE sub = $1 AND purpose = $2', [sub, purpose]);
    await db.query('DELETE FROM idp.codes WHERE sub = $1 AND purpose = $2 AND attempts >= $3', [sub, purpose, maxAttempts]);
  },

  async deleteCode(db: Queryable, sub: string, purpose: CodePurpose): Promise<void> {
    await db.query('DELETE FROM idp.codes WHERE sub = $1 AND purpose = $2', [sub, purpose]);
  },

  // ---- challenges -------------------------------------------------------------

  async insertChallenge(db: Queryable, c: { sub: string; kind: ChallengeName; expiresAt: Date }): Promise<string> {
    const { rows } = await db.query<{ id: string }>(
      'INSERT INTO idp.mfa_challenges (sub, kind, expires_at) VALUES ($1, $2, $3) RETURNING id',
      [c.sub, c.kind, c.expiresAt],
    );
    return rows[0]!.id;
  },

  async findChallenge(db: Queryable, id: string): Promise<ChallengeRow | null> {
    const { rows } = await db.query<Row<ChallengeRow>>(
      'SELECT id, sub, kind, attempts, expires_at FROM idp.mfa_challenges WHERE id = $1 FOR UPDATE',
      [id],
    );
    return rows[0] ?? null;
  },

  async failChallengeAttempt(db: Queryable, id: string, maxAttempts: number): Promise<void> {
    await db.query('UPDATE idp.mfa_challenges SET attempts = attempts + 1 WHERE id = $1', [id]);
    await db.query('DELETE FROM idp.mfa_challenges WHERE id = $1 AND attempts >= $2', [id, maxAttempts]);
  },

  async deleteChallenge(db: Queryable, id: string): Promise<void> {
    await db.query('DELETE FROM idp.mfa_challenges WHERE id = $1', [id]);
  },

  async deleteChallengesOf(db: Queryable, sub: string): Promise<void> {
    await db.query('DELETE FROM idp.mfa_challenges WHERE sub = $1', [sub]);
  },

  // ---- refresh tokens ---------------------------------------------------------

  async insertRefresh(db: Queryable, r: { tokenHash: Buffer; sub: string; familyId: string; expiresAt: Date }): Promise<void> {
    await db.query('INSERT INTO idp.refresh_tokens (token_hash, sub, family_id, expires_at) VALUES ($1, $2, $3, $4)', [
      r.tokenHash,
      r.sub,
      r.familyId,
      r.expiresAt,
    ]);
  },

  async findRefresh(db: Queryable, tokenHash: Buffer): Promise<RefreshRow | null> {
    const { rows } = await db.query<Row<RefreshRow>>(
      'SELECT sub, family_id, expires_at, revoked_at, replaced_by FROM idp.refresh_tokens WHERE token_hash = $1 FOR UPDATE',
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  async markReplaced(db: Queryable, tokenHash: Buffer, replacedBy: Buffer): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now(), replaced_by = $2 WHERE token_hash = $1', [tokenHash, replacedBy]);
  },

  async revokeFamily(db: Queryable, familyId: string): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);
  },

  async revokeAllForUser(db: Queryable, sub: string): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE sub = $1 AND revoked_at IS NULL', [sub]);
  },
};
