import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { ErrorCode } from '@saunaklar/shared';
import { IdpError } from '../errors.ts';
import { templates } from '../mail/templates.ts';
import type {
  AdminCreateUserInput,
  AuthResult,
  ChallengeName,
  ClientMetadata,
  IdentityProvider,
  Mailer,
  Pool,
  Queryable,
  SignUpInput,
  SoftwareTokenAssociation,
  Tokens,
  TxRunner,
  VerifiedAccessToken,
} from '../types.ts';
import { base32Decode, base32Encode } from './base32.ts';
import { store, isUniqueViolation, type UserRow } from './local-store.ts';
import { checkPasswordPolicy, generateTemporaryPassword, getDummyHash, hashPassword, verifyPassword } from './password.ts';
import { generateTotpSecret, otpauthUri, verifyTotp } from './totp.ts';

export const LOCAL_IDP_ISSUER = 'saunaklar-local-idp';

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_MS = 30 * 24 * 3600 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SIGNUP_CODE_TTL_MS = 24 * 3600 * 1000;
const RESET_CODE_TTL_MS = 3600 * 1000;
const TEMP_PASSWORD_TTL_MS = 7 * 24 * 3600 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_MFA_ATTEMPTS = 5;

export interface LocalIdentityProviderConfig {
  /** Runs a transaction as role `idp_local`. */
  tx: TxRunner;
  mailer: Mailer;
  /** HS256 key for access tokens, at least 32 bytes. */
  jwtSecret: string;
  staffMfa: 'REQUIRED' | 'OPTIONAL';
  /** Issuer shown in authenticator apps. */
  totpIssuer?: string;
  now?: () => Date;
}

/** Errors decided inside a transaction are returned (so attempt counters commit) and thrown after it. */
type Outcome<T> = { ok: true; value: T } | { ok: false; code: ErrorCode };
const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });
const fail = (code: ErrorCode): Outcome<never> => ({ ok: false, code });
const unwrap = <T>(o: Outcome<T>): T => {
  if (!o.ok) throw new IdpError(o.code);
  return o.value;
};

const sha256 = (value: string) => createHash('sha256').update(value).digest();
const randomToken = () => randomBytes(32).toString('base64url');
const sixDigits = () => randomInt(0, 1_000_000).toString().padStart(6, '0');

/**
 * Cognito-compatible identity provider backed by the local `idp` schema. Behaviour mirrors the
 * Cognito adapter closely enough that the API cannot tell them apart.
 */
export class LocalIdentityProvider implements IdentityProvider {
  private readonly key: Uint8Array;
  private readonly now: () => Date;

  constructor(private readonly config: LocalIdentityProviderConfig) {
    if (Buffer.byteLength(config.jwtSecret) < 32) throw new Error('Local IdP JWT secret must be at least 32 bytes');
    this.key = new TextEncoder().encode(config.jwtSecret);
    this.now = config.now ?? (() => new Date());
  }

  // ---- sign-up ------------------------------------------------------------

  async signUp(input: SignUpInput): Promise<{ sub: string }> {
    checkPasswordPolicy(input.password);
    const passwordHash = await hashPassword(input.password);
    return this.config.tx(async (db) => {
      let sub: string;
      try {
        sub = await store.insertUser(db, {
          pool: input.pool,
          username: input.username,
          email: input.email,
          passwordHash,
          status: 'UNCONFIRMED',
          attributes: input.attributes ?? {},
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new IdpError('CONFLICT', 'Username already exists');
        throw e;
      }
      await this.sendCode(db, { sub, email: input.email, attributes: input.attributes ?? null }, 'SIGNUP', input.clientMetadata);
      return { sub };
    });
  }

  async confirmSignUp(pool: Pool, username: string, code: string): Promise<void> {
    unwrap(
      await this.config.tx(async (db) => {
        const user = await store.findUser(db, pool, username, true);
        if (!user) return fail('CODE_INVALID');
        const checked = await this.checkCode(db, user.sub, 'SIGNUP', code);
        if (!checked.ok) return checked;
        if (user.status === 'UNCONFIRMED') await store.updateUser(db, user.sub, { status: 'CONFIRMED' });
        return ok(undefined);
      }),
    );
  }

  async resendConfirmationCode(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void> {
    await this.config.tx(async (db) => {
      const user = await store.findUser(db, pool, username, true);
      // Unknown or already confirmed: succeed silently (no enumeration).
      if (!user || user.status !== 'UNCONFIRMED') return;
      await this.sendCode(db, user, 'SIGNUP', clientMetadata);
    });
  }

  // ---- sign-in ------------------------------------------------------------

  async initiateAuth(pool: Pool, username: string, password: string): Promise<AuthResult> {
    return unwrap(
      await this.config.tx(async (db) => {
        const user = await store.findUser(db, pool, username, true);
        const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyHash()));
        if (!user || !valid) return fail('INVALID_CREDENTIALS');
        if (!user.enabled) return fail('ACCOUNT_DISABLED');
        if (user.status === 'UNCONFIRMED') return fail('EMAIL_NOT_VERIFIED');
        if (user.status === 'FORCE_CHANGE_PASSWORD') {
          if (this.now().getTime() - new Date(user.created_at).getTime() > TEMP_PASSWORD_TTL_MS) return fail('INVALID_CREDENTIALS');
          return ok(await this.challenge(db, user.sub, 'NEW_PASSWORD_REQUIRED'));
        }
        return ok(await this.nextStep(db, user));
      }),
    );
  }

  async respondMfa(pool: Pool, session: string, code: string): Promise<Tokens> {
    return unwrap(
      await this.config.tx(async (db) => {
        const found = await this.loadChallenge(db, pool, session, 'SOFTWARE_TOKEN_MFA');
        if (!found.ok) return found;
        const { challenge, user } = found.value;
        const step = user.totp_secret ? verifyTotp(base32Decode(user.totp_secret), code, this.unixNow()) : null;
        const lastStep = user.totp_last_step === null ? -1n : BigInt(user.totp_last_step);
        if (step === null || step <= lastStep) {
          await store.failChallengeAttempt(db, challenge.id, MAX_MFA_ATTEMPTS);
          return fail('MFA_INVALID');
        }
        await store.consumeChallenge(db, challenge.id);
        await store.updateUser(db, user.sub, { totp_last_step: step });
        return ok(await this.issueTokens(db, user));
      }),
    );
  }

  async associateSoftwareToken(pool: Pool, session: string): Promise<SoftwareTokenAssociation> {
    return unwrap(
      await this.config.tx(async (db) => {
        const found = await this.loadChallenge(db, pool, session, 'MFA_SETUP');
        if (!found.ok) return found;
        const { challenge, user } = found.value;
        const secret = generateTotpSecret();
        const secretB32 = base32Encode(secret);
        // Cognito hands out a fresh session with the association; mirror that.
        await store.consumeChallenge(db, challenge.id);
        const next = await this.challenge(db, user.sub, 'MFA_SETUP', secretB32);
        if (next.kind !== 'CHALLENGE') throw new Error('unreachable');
        return ok({
          secret: secretB32,
          otpauthUri: otpauthUri({ secret, issuer: this.config.totpIssuer ?? 'Saunaklar', account: user.email }),
          session: next.session,
        });
      }),
    );
  }

  async verifySoftwareToken(pool: Pool, session: string, code: string): Promise<Tokens> {
    return unwrap(
      await this.config.tx(async (db) => {
        const found = await this.loadChallenge(db, pool, session, 'MFA_SETUP');
        if (!found.ok) return found;
        const { challenge, user } = found.value;
        if (!challenge.pending_secret) return fail('CHALLENGE_EXPIRED');
        const step = verifyTotp(base32Decode(challenge.pending_secret), code, this.unixNow());
        if (step === null) {
          await store.failChallengeAttempt(db, challenge.id, MAX_MFA_ATTEMPTS);
          return fail('MFA_INVALID');
        }
        await store.consumeChallenge(db, challenge.id);
        await store.updateUser(db, user.sub, { totp_secret: challenge.pending_secret, totp_enabled: true, totp_last_step: step });
        return ok(await this.issueTokens(db, user));
      }),
    );
  }

  async respondNewPassword(pool: Pool, session: string, newPassword: string): Promise<AuthResult> {
    checkPasswordPolicy(newPassword);
    const passwordHash = await hashPassword(newPassword);
    return unwrap(
      await this.config.tx(async (db) => {
        const found = await this.loadChallenge(db, pool, session, 'NEW_PASSWORD_REQUIRED');
        if (!found.ok) return found;
        const { challenge, user } = found.value;
        await store.consumeChallenge(db, challenge.id);
        // The invitation reached the mailbox, so the address counts as verified.
        await store.updateUser(db, user.sub, { password_hash: passwordHash, status: 'CONFIRMED' });
        return ok(await this.nextStep(db, { ...user, status: 'CONFIRMED' }));
      }),
    );
  }

  // ---- tokens ---------------------------------------------------------------

  async refresh(pool: Pool, refreshToken: string): Promise<Tokens> {
    return unwrap(
      await this.config.tx(async (db) => {
        const hash = sha256(refreshToken);
        const row = await store.findRefresh(db, hash);
        if (!row) return fail('SESSION_EXPIRED');
        if (row.revoked_at) {
          // A rotated token presented again means it leaked: end the whole session family.
          if (row.rotated_at) await store.revokeFamily(db, row.family_id);
          return fail('SESSION_EXPIRED');
        }
        if (new Date(row.expires_at).getTime() <= this.now().getTime()) return fail('SESSION_EXPIRED');
        const user = await store.findUserBySub(db, row.user_sub);
        if (!user || user.pool !== pool) return fail('SESSION_EXPIRED');
        if (!user.enabled) {
          await store.revokeFamily(db, row.family_id);
          return fail('ACCOUNT_DISABLED');
        }
        await store.rotateRefresh(db, hash);
        // The family keeps its original expiry: rotation never extends a session past 30 days.
        return ok(await this.issueTokens(db, user, { familyId: row.family_id, expiresAt: new Date(row.expires_at) }));
      }),
    );
  }

  async revoke(pool: Pool, refreshToken: string): Promise<void> {
    await this.config.tx(async (db) => {
      const row = await store.findRefresh(db, sha256(refreshToken));
      if (!row) return;
      const user = await store.findUserBySub(db, row.user_sub);
      if (user?.pool === pool) await store.revokeFamily(db, row.family_id);
    });
  }

  async verifyAccessToken(pool: Pool, token: string): Promise<VerifiedAccessToken> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: LOCAL_IDP_ISSUER,
        audience: pool,
        algorithms: ['HS256'],
        currentDate: this.now(),
      });
      if (payload.token_use !== 'access' || typeof payload.sub !== 'string' || typeof payload.username !== 'string' || typeof payload.exp !== 'number') {
        throw new Error('Malformed access token');
      }
      return { sub: payload.sub, pool, username: payload.username, exp: payload.exp };
    } catch (e) {
      throw new IdpError('SESSION_EXPIRED', 'Invalid or expired access token', { cause: e });
    }
  }

  // ---- password reset -------------------------------------------------------

  async forgotPassword(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void> {
    await this.config.tx(async (db) => {
      const user = await store.findUser(db, pool, username, true);
      // Unknown, disabled or never-confirmed users: succeed silently (no enumeration).
      if (!user || !user.enabled || user.status !== 'CONFIRMED') return;
      await this.sendCode(db, user, 'RESET', clientMetadata);
    });
  }

  async confirmForgotPassword(pool: Pool, username: string, code: string, newPassword: string): Promise<void> {
    checkPasswordPolicy(newPassword);
    const passwordHash = await hashPassword(newPassword);
    unwrap(
      await this.config.tx(async (db) => {
        const user = await store.findUser(db, pool, username, true);
        if (!user) return fail('CODE_INVALID');
        const checked = await this.checkCode(db, user.sub, 'RESET', code);
        if (!checked.ok) return checked;
        await store.updateUser(db, user.sub, { password_hash: passwordHash });
        await store.revokeAllForUser(db, user.sub);
        return ok(undefined);
      }),
    );
  }

  // ---- administration -------------------------------------------------------

  async adminCreateUser(pool: Pool, input: AdminCreateUserInput): Promise<{ sub: string; temporaryPassword: string }> {
    const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
    checkPasswordPolicy(temporaryPassword);
    const passwordHash = await hashPassword(temporaryPassword);
    return this.config.tx(async (db) => {
      let sub: string;
      try {
        sub = await store.insertUser(db, {
          pool,
          username: input.username,
          email: input.email,
          passwordHash,
          status: 'FORCE_CHANGE_PASSWORD',
          attributes: input.attributes ?? {},
        });
      } catch (e) {
        if (isUniqueViolation(e)) throw new IdpError('CONFLICT', 'Username already exists');
        throw e;
      }
      const meta = input.clientMetadata;
      if (meta) {
        const mail = templates.staffInvite(
          brandOf(meta),
          { email: input.email, temporaryPassword, adminUrl: meta.storefrontUrl, displayName: input.attributes?.name ?? null },
          meta.locale,
        );
        await this.config.mailer.send({ to: input.email, ...mail, ...senderOf(meta) });
      }
      return { sub, temporaryPassword };
    });
  }

  async adminDeleteUser(pool: Pool, username: string): Promise<void> {
    await this.config.tx(async (db) => {
      const user = await store.findUser(db, pool, username, true);
      if (user) await store.deleteUser(db, user.sub);
    });
  }

  async adminDisableUser(pool: Pool, username: string): Promise<void> {
    unwrap(
      await this.config.tx(async (db) => {
        const user = await store.findUser(db, pool, username, true);
        if (!user) return fail('NOT_FOUND');
        await store.updateUser(db, user.sub, { enabled: false });
        await store.revokeAllForUser(db, user.sub);
        return ok(undefined);
      }),
    );
  }

  async adminEnableUser(pool: Pool, username: string): Promise<void> {
    unwrap(
      await this.config.tx(async (db) => {
        const user = await store.findUser(db, pool, username, true);
        if (!user) return fail('NOT_FOUND');
        await store.updateUser(db, user.sub, { enabled: true });
        return ok(undefined);
      }),
    );
  }

  // ---- internals ------------------------------------------------------------

  private unixNow(): number {
    return Math.floor(this.now().getTime() / 1000);
  }

  private async nextStep(db: Queryable, user: UserRow): Promise<AuthResult> {
    if (user.totp_enabled && user.totp_secret) return this.challenge(db, user.sub, 'SOFTWARE_TOKEN_MFA');
    if (user.pool === 'STAFF' && this.config.staffMfa === 'REQUIRED') return this.challenge(db, user.sub, 'MFA_SETUP');
    return { kind: 'TOKENS', tokens: await this.issueTokens(db, user) };
  }

  private async challenge(db: Queryable, sub: string, challenge: ChallengeName, pendingSecret?: string): Promise<AuthResult> {
    const session = randomToken();
    await store.insertChallenge(db, {
      sessionHash: sha256(session),
      sub,
      challenge,
      ...(pendingSecret ? { pendingSecret } : {}),
      expiresAt: new Date(this.now().getTime() + CHALLENGE_TTL_MS),
    });
    return { kind: 'CHALLENGE', challenge, session };
  }

  private async loadChallenge(db: Queryable, pool: Pool, session: string, expected: ChallengeName) {
    const challenge = await store.findChallenge(db, sha256(session));
    if (!challenge || challenge.consumed_at || challenge.challenge !== expected) return fail('CHALLENGE_EXPIRED');
    if (new Date(challenge.expires_at).getTime() <= this.now().getTime()) return fail('CHALLENGE_EXPIRED');
    const user = await store.findUserBySub(db, challenge.user_sub, true);
    if (!user || user.pool !== pool) return fail('CHALLENGE_EXPIRED');
    if (!user.enabled) return fail('ACCOUNT_DISABLED');
    return ok({ challenge, user });
  }

  private async issueTokens(db: Queryable, user: UserRow, family?: { familyId: string; expiresAt: Date }): Promise<Tokens> {
    const now = this.now();
    const iat = Math.floor(now.getTime() / 1000);
    const accessToken = await new SignJWT({ token_use: 'access', username: user.username })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuer(LOCAL_IDP_ISSUER)
      .setAudience(user.pool)
      .setSubject(user.sub)
      .setJti(randomUUID())
      .setIssuedAt(iat)
      .setExpirationTime(iat + ACCESS_TTL_SECONDS)
      .sign(this.key);
    const refreshToken = randomToken();
    await store.insertRefresh(db, {
      tokenHash: sha256(refreshToken),
      sub: user.sub,
      familyId: family?.familyId ?? randomUUID(),
      expiresAt: family?.expiresAt ?? new Date(now.getTime() + REFRESH_TTL_MS),
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS };
  }

  private async sendCode(
    db: Queryable,
    user: Pick<UserRow, 'sub' | 'email' | 'attributes'>,
    purpose: 'SIGNUP' | 'RESET',
    meta: ClientMetadata,
  ): Promise<void> {
    const code = sixDigits();
    const ttl = purpose === 'SIGNUP' ? SIGNUP_CODE_TTL_MS : RESET_CODE_TTL_MS;
    await store.replaceCode(db, user.sub, purpose, sha256(code), new Date(this.now().getTime() + ttl));
    const firstName = user.attributes?.given_name ?? null;
    const mail =
      purpose === 'SIGNUP'
        ? templates.signupCode(brandOf(meta), { code, firstName }, meta.locale)
        : templates.resetCode(brandOf(meta), { code, firstName }, meta.locale);
    await this.config.mailer.send({ to: user.email, ...mail, ...senderOf(meta) });
  }

  private async checkCode(db: Queryable, sub: string, purpose: 'SIGNUP' | 'RESET', code: string): Promise<Outcome<void>> {
    const row = await store.activeCode(db, sub, purpose);
    if (!row) return fail('CODE_INVALID');
    if (new Date(row.expires_at).getTime() <= this.now().getTime()) return fail('CODE_EXPIRED');
    if (row.attempts >= MAX_CODE_ATTEMPTS) return fail('CODE_INVALID');
    const given = sha256(code.trim());
    if (!timingSafeEqual(given, Buffer.from(row.code_hash))) {
      await store.failCodeAttempt(db, row.id, MAX_CODE_ATTEMPTS);
      return fail('CODE_INVALID');
    }
    await store.consumeCode(db, row.id);
    return ok(undefined);
  }
}

const brandOf = (m: ClientMetadata) => ({
  brandName: m.brandName,
  storefrontUrl: m.storefrontUrl,
  ...(m.primaryColor ? { primaryColor: m.primaryColor } : {}),
  ...(m.supportEmail ? { supportEmail: m.supportEmail } : {}),
});

const senderOf = (m: ClientMetadata) => ({
  fromName: m.brandName,
  ...(m.resellerId ? { resellerId: m.resellerId } : {}),
  ...(m.supportEmail ? { replyTo: m.supportEmail } : {}),
});
