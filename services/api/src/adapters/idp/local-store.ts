import type { Queryable } from '../types.ts';
import type { Pool, ChallengeName } from '../types.ts';

/**
 * SQL for the local identity provider. Expected schema (packages/db/migrations/local):
 *
 *   idp.users(sub uuid pk default gen_random_uuid(), pool text CHECK IN ('CUSTOMER','STAFF'),
 *     username text, email text, password_hash text,
 *     status text CHECK IN ('UNCONFIRMED','CONFIRMED','FORCE_CHANGE_PASSWORD'),
 *     enabled boolean default true, totp_secret text NULL (base32), totp_enabled boolean default false,
 *     totp_last_step bigint NULL, attributes jsonb default '{}', created_at, updated_at,
 *     unique (pool, lower(username)))
 *   idp.codes(id uuid pk, user_sub uuid → users ON DELETE CASCADE, purpose CHECK IN ('SIGNUP','RESET'),
 *     code_hash bytea, attempts int default 0, expires_at, consumed_at NULL, created_at)
 *   idp.refresh_tokens(token_hash bytea pk, user_sub → users ON DELETE CASCADE, family_id uuid,
 *     expires_at, revoked_at NULL, rotated_at NULL, created_at)
 *   idp.mfa_challenges(id uuid pk, session_hash bytea unique, user_sub → users ON DELETE CASCADE,
 *     challenge CHECK IN ('SOFTWARE_TOKEN_MFA','MFA_SETUP','NEW_PASSWORD_REQUIRED'),
 *     pending_secret text NULL, attempts int default 0, expires_at, consumed_at NULL, created_at)
 */

export type UserStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'FORCE_CHANGE_PASSWORD';

export interface UserRow {
  sub: string;
  pool: Pool;
  username: string;
  email: string;
  password_hash: string;
  status: UserStatus;
  enabled: boolean;
  totp_secret: string | null;
  totp_enabled: boolean;
  totp_last_step: string | null;
  attributes: Record<string, string> | null;
  created_at: Date;
}

export interface CodeRow {
  id: string;
  code_hash: Buffer;
  attempts: number;
  expires_at: Date;
}

export interface ChallengeRow {
  id: string;
  user_sub: string;
  challenge: ChallengeName;
  pending_secret: string | null;
  attempts: number;
  expires_at: Date;
  consumed_at: Date | null;
}

export interface RefreshRow {
  user_sub: string;
  family_id: string;
  expires_at: Date;
  revoked_at: Date | null;
  rotated_at: Date | null;
}

const USER_COLUMNS = `sub, pool, username, email, password_hash, status, enabled, totp_secret, totp_enabled,
  totp_last_step::text AS totp_last_step, attributes, created_at`;

export const isUniqueViolation = (e: unknown): boolean => (e as { code?: unknown } | null)?.code === '23505';

export const store = {
  async findUser(db: Queryable, pool: Pool, username: string, lock = false): Promise<UserRow | null> {
    const { rows } = await db.query<UserRow & Record<string, unknown>>(
      `SELECT ${USER_COLUMNS} FROM idp.users WHERE pool = $1 AND lower(username) = lower($2)${lock ? ' FOR UPDATE' : ''}`,
      [pool, username],
    );
    return rows[0] ?? null;
  },

  async findUserBySub(db: Queryable, sub: string, lock = false): Promise<UserRow | null> {
    const { rows } = await db.query<UserRow & Record<string, unknown>>(
      `SELECT ${USER_COLUMNS} FROM idp.users WHERE sub = $1${lock ? ' FOR UPDATE' : ''}`,
      [sub],
    );
    return rows[0] ?? null;
  },

  async insertUser(
    db: Queryable,
    u: { pool: Pool; username: string; email: string; passwordHash: string; status: UserStatus; attributes: Record<string, string> },
  ): Promise<string> {
    const { rows } = await db.query<{ sub: string }>(
      `INSERT INTO idp.users (pool, username, email, password_hash, status, attributes)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING sub`,
      [u.pool, u.username, u.email, u.passwordHash, u.status, JSON.stringify(u.attributes)],
    );
    return rows[0]!.sub;
  },

  async updateUser(
    db: Queryable,
    sub: string,
    fields: Partial<{ password_hash: string; status: UserStatus; enabled: boolean; totp_secret: string; totp_enabled: boolean; totp_last_step: bigint }>,
  ): Promise<void> {
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return;
    const sets = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ');
    await db.query(`UPDATE idp.users SET ${sets}, updated_at = now() WHERE sub = $1`, [
      sub,
      ...entries.map(([, v]) => (typeof v === 'bigint' ? v.toString() : v)),
    ]);
  },

  async deleteUser(db: Queryable, sub: string): Promise<void> {
    await db.query('DELETE FROM idp.mfa_challenges WHERE user_sub = $1', [sub]);
    await db.query('DELETE FROM idp.refresh_tokens WHERE user_sub = $1', [sub]);
    await db.query('DELETE FROM idp.codes WHERE user_sub = $1', [sub]);
    await db.query('DELETE FROM idp.users WHERE sub = $1', [sub]);
  },

  // ---- codes --------------------------------------------------------------

  async replaceCode(db: Queryable, sub: string, purpose: 'SIGNUP' | 'RESET', codeHash: Buffer, expiresAt: Date): Promise<void> {
    await db.query(
      `UPDATE idp.codes SET consumed_at = now() WHERE user_sub = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [sub, purpose],
    );
    await db.query(`INSERT INTO idp.codes (user_sub, purpose, code_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
      sub,
      purpose,
      codeHash,
      expiresAt,
    ]);
  },

  async activeCode(db: Queryable, sub: string, purpose: 'SIGNUP' | 'RESET'): Promise<CodeRow | null> {
    const { rows } = await db.query<CodeRow & Record<string, unknown>>(
      `SELECT id, code_hash, attempts, expires_at FROM idp.codes
       WHERE user_sub = $1 AND purpose = $2 AND consumed_at IS NULL
       ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
      [sub, purpose],
    );
    return rows[0] ?? null;
  },

  async failCodeAttempt(db: Queryable, id: string, maxAttempts: number): Promise<void> {
    await db.query(
      `UPDATE idp.codes SET attempts = attempts + 1,
         consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
       WHERE id = $1`,
      [id, maxAttempts],
    );
  },

  async consumeCode(db: Queryable, id: string): Promise<void> {
    await db.query('UPDATE idp.codes SET consumed_at = now() WHERE id = $1', [id]);
  },

  // ---- challenges -----------------------------------------------------------

  async insertChallenge(
    db: Queryable,
    c: { sessionHash: Buffer; sub: string; challenge: ChallengeName; pendingSecret?: string; expiresAt: Date },
  ): Promise<void> {
    await db.query(
      `INSERT INTO idp.mfa_challenges (session_hash, user_sub, challenge, pending_secret, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [c.sessionHash, c.sub, c.challenge, c.pendingSecret ?? null, c.expiresAt],
    );
  },

  async findChallenge(db: Queryable, sessionHash: Buffer): Promise<ChallengeRow | null> {
    const { rows } = await db.query<ChallengeRow & Record<string, unknown>>(
      `SELECT id, user_sub, challenge, pending_secret, attempts, expires_at, consumed_at
       FROM idp.mfa_challenges WHERE session_hash = $1 FOR UPDATE`,
      [sessionHash],
    );
    return rows[0] ?? null;
  },

  async failChallengeAttempt(db: Queryable, id: string, maxAttempts: number): Promise<void> {
    await db.query(
      `UPDATE idp.mfa_challenges SET attempts = attempts + 1,
         consumed_at = CASE WHEN attempts + 1 >= $2 THEN now() ELSE consumed_at END
       WHERE id = $1`,
      [id, maxAttempts],
    );
  },

  async consumeChallenge(db: Queryable, id: string): Promise<void> {
    await db.query('UPDATE idp.mfa_challenges SET consumed_at = now() WHERE id = $1', [id]);
  },

  // ---- refresh tokens -------------------------------------------------------

  async insertRefresh(db: Queryable, r: { tokenHash: Buffer; sub: string; familyId: string; expiresAt: Date }): Promise<void> {
    await db.query(`INSERT INTO idp.refresh_tokens (token_hash, user_sub, family_id, expires_at) VALUES ($1, $2, $3, $4)`, [
      r.tokenHash,
      r.sub,
      r.familyId,
      r.expiresAt,
    ]);
  },

  async findRefresh(db: Queryable, tokenHash: Buffer): Promise<RefreshRow | null> {
    const { rows } = await db.query<RefreshRow & Record<string, unknown>>(
      `SELECT user_sub, family_id, expires_at, revoked_at, rotated_at FROM idp.refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash],
    );
    return rows[0] ?? null;
  },

  async rotateRefresh(db: Queryable, tokenHash: Buffer): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now(), rotated_at = now() WHERE token_hash = $1', [tokenHash]);
  },

  async revokeFamily(db: Queryable, familyId: string): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);
  },

  async revokeAllForUser(db: Queryable, sub: string): Promise<void> {
    await db.query('UPDATE idp.refresh_tokens SET revoked_at = now() WHERE user_sub = $1 AND revoked_at IS NULL', [sub]);
  },
};
