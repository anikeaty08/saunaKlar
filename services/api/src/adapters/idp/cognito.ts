import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AssociateSoftwareTokenCommand,
  CognitoIdentityProviderClient,
  ConfirmForgotPasswordCommand,
  ConfirmSignUpCommand,
  ForgotPasswordCommand,
  InitiateAuthCommand,
  ResendConfirmationCodeCommand,
  RespondToAuthChallengeCommand,
  RevokeTokenCommand,
  SignUpCommand,
  VerifySoftwareTokenCommand,
  type AuthenticationResultType,
  type ChallengeNameType,
} from '@aws-sdk/client-cognito-identity-provider';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { IdpError } from '../errors.ts';
import type {
  AdminCreateUserInput,
  AuthResult,
  ChallengeName,
  ClientMetadata,
  IdentityProvider,
  Pool,
  SignUpInput,
  SoftwareTokenAssociation,
  Tokens,
  VerifiedAccessToken,
} from '../types.ts';
import { base32Decode } from './base32.ts';
import { toIdpError, type CognitoContext } from './cognito-errors.ts';
import { checkPasswordPolicy, generateTemporaryPassword } from './password.ts';
import { otpauthUri } from './totp.ts';

export interface CognitoPoolConfig {
  userPoolId: string;
  /** Public app client (no secret) with USER_PASSWORD_AUTH and REFRESH_TOKEN_AUTH enabled. */
  clientId: string;
}

export interface CognitoIdentityProviderConfig {
  pools: Record<Pool, CognitoPoolConfig>;
  region?: string;
  totpIssuer?: string;
  client?: CognitoIdentityProviderClient;
}

const CHALLENGES: readonly ChallengeName[] = ['SOFTWARE_TOKEN_MFA', 'MFA_SETUP', 'NEW_PASSWORD_REQUIRED'];

/**
 * Cognito's challenge responses need USERNAME next to the opaque session, so our session
 * handle carries both: base64url(JSON {u, s}). Cognito binds its session to the user, so a
 * tampered username is rejected by Cognito itself.
 */
const wrapSession = (username: string, session: string) => Buffer.from(JSON.stringify({ u: username, s: session })).toString('base64url');

function unwrapSession(handle: string): { username: string; session: string } {
  try {
    const v = JSON.parse(Buffer.from(handle, 'base64url').toString('utf8')) as { u?: unknown; s?: unknown };
    if (typeof v.u === 'string' && typeof v.s === 'string' && v.s.length > 0) return { username: v.u, session: v.s };
  } catch {
    // fall through
  }
  throw new IdpError('CHALLENGE_EXPIRED');
}

/** ClientMetadata must be a flat string map. */
const metadata = (m: ClientMetadata | undefined): Record<string, string> | undefined =>
  m ? Object.fromEntries(Object.entries(m).filter((e): e is [string, string] => typeof e[1] === 'string')) : undefined;

const attributeList = (attrs: Record<string, string>) => Object.entries(attrs).map(([Name, Value]) => ({ Name, Value }));

export class CognitoIdentityProvider implements IdentityProvider {
  private readonly client: CognitoIdentityProviderClient;
  private readonly verifiers: Record<Pool, { verify(token: string): Promise<{ sub: string; username: string; exp: number }> }>;

  constructor(private readonly config: CognitoIdentityProviderConfig) {
    this.client = config.client ?? new CognitoIdentityProviderClient(config.region ? { region: config.region } : {});
    const verifier = (p: CognitoPoolConfig) =>
      CognitoJwtVerifier.create({ userPoolId: p.userPoolId, clientId: p.clientId, tokenUse: 'access' });
    this.verifiers = { CUSTOMER: verifier(config.pools.CUSTOMER), STAFF: verifier(config.pools.STAFF) };
  }

  private pool(pool: Pool): CognitoPoolConfig {
    return this.config.pools[pool];
  }

  private async call<T>(ctx: CognitoContext, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw toIdpError(e, ctx);
    }
  }

  private toResult(username: string, out: { AuthenticationResult?: AuthenticationResultType; ChallengeName?: ChallengeNameType | string; Session?: string }): AuthResult {
    if (out.AuthenticationResult) return { kind: 'TOKENS', tokens: tokensOf(out.AuthenticationResult) };
    const challenge = out.ChallengeName as ChallengeName | undefined;
    if (challenge && CHALLENGES.includes(challenge) && out.Session) {
      return { kind: 'CHALLENGE', challenge, session: wrapSession(username, out.Session) };
    }
    throw new Error(`Unsupported Cognito challenge ${String(out.ChallengeName)}`);
  }

  async signUp(input: SignUpInput): Promise<{ sub: string }> {
    checkPasswordPolicy(input.password);
    const out = await this.call('signup', () =>
      this.client.send(
        new SignUpCommand({
          ClientId: this.pool(input.pool).clientId,
          Username: input.username,
          Password: input.password,
          UserAttributes: attributeList({ ...input.attributes, email: input.email }),
          ClientMetadata: metadata(input.clientMetadata),
        }),
      ),
    );
    if (!out.UserSub) throw new Error('Cognito SignUp returned no sub');
    return { sub: out.UserSub };
  }

  async confirmSignUp(pool: Pool, username: string, code: string): Promise<void> {
    await this.call('code', () =>
      this.client.send(new ConfirmSignUpCommand({ ClientId: this.pool(pool).clientId, Username: username, ConfirmationCode: code })),
    );
  }

  async resendConfirmationCode(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void> {
    try {
      await this.client.send(
        new ResendConfirmationCodeCommand({ ClientId: this.pool(pool).clientId, Username: username, ClientMetadata: metadata(clientMetadata) }),
      );
    } catch (e) {
      // Unknown or already confirmed users succeed silently (no enumeration).
      const name = (e as { name?: string }).name;
      if (name === 'UserNotFoundException' || name === 'InvalidParameterException' || name === 'NotAuthorizedException') return;
      throw toIdpError(e, 'code');
    }
  }

  async initiateAuth(pool: Pool, username: string, password: string): Promise<AuthResult> {
    const out = await this.call('auth', () =>
      this.client.send(
        new InitiateAuthCommand({
          ClientId: this.pool(pool).clientId,
          AuthFlow: 'USER_PASSWORD_AUTH',
          AuthParameters: { USERNAME: username, PASSWORD: password },
        }),
      ),
    );
    return this.toResult(username, out);
  }

  async respondMfa(pool: Pool, session: string, code: string): Promise<Tokens> {
    const s = unwrapSession(session);
    const out = await this.call('mfa', () =>
      this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.pool(pool).clientId,
          ChallengeName: 'SOFTWARE_TOKEN_MFA',
          Session: s.session,
          ChallengeResponses: { USERNAME: s.username, SOFTWARE_TOKEN_MFA_CODE: code },
        }),
      ),
    );
    const result = this.toResult(s.username, out);
    if (result.kind !== 'TOKENS') throw new IdpError('CHALLENGE_EXPIRED');
    return result.tokens;
  }

  async associateSoftwareToken(_pool: Pool, session: string): Promise<SoftwareTokenAssociation> {
    const s = unwrapSession(session);
    const out = await this.call('challenge', () => this.client.send(new AssociateSoftwareTokenCommand({ Session: s.session })));
    if (!out.SecretCode || !out.Session) throw new Error('Cognito AssociateSoftwareToken returned no secret');
    return {
      secret: out.SecretCode,
      otpauthUri: otpauthUri({ secret: base32Decode(out.SecretCode), issuer: this.config.totpIssuer ?? 'Saunaklar', account: s.username }),
      session: wrapSession(s.username, out.Session),
    };
  }

  async verifySoftwareToken(pool: Pool, session: string, code: string): Promise<Tokens> {
    const s = unwrapSession(session);
    const verified = await this.call('mfa', () => this.client.send(new VerifySoftwareTokenCommand({ Session: s.session, UserCode: code })));
    if (verified.Status !== 'SUCCESS' || !verified.Session) throw new IdpError('MFA_INVALID');
    const out = await this.call('challenge', () =>
      this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.pool(pool).clientId,
          ChallengeName: 'MFA_SETUP',
          Session: verified.Session,
          ChallengeResponses: { USERNAME: s.username },
        }),
      ),
    );
    const result = this.toResult(s.username, out);
    if (result.kind !== 'TOKENS') throw new IdpError('CHALLENGE_EXPIRED');
    return result.tokens;
  }

  async respondNewPassword(pool: Pool, session: string, newPassword: string): Promise<AuthResult> {
    checkPasswordPolicy(newPassword);
    const s = unwrapSession(session);
    const out = await this.call('challenge', () =>
      this.client.send(
        new RespondToAuthChallengeCommand({
          ClientId: this.pool(pool).clientId,
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: s.session,
          ChallengeResponses: { USERNAME: s.username, NEW_PASSWORD: newPassword },
        }),
      ),
    );
    return this.toResult(s.username, out);
  }

  async refresh(pool: Pool, refreshToken: string): Promise<Tokens> {
    const out = await this.call('refresh', () =>
      this.client.send(
        new InitiateAuthCommand({
          ClientId: this.pool(pool).clientId,
          AuthFlow: 'REFRESH_TOKEN_AUTH',
          AuthParameters: { REFRESH_TOKEN: refreshToken },
        }),
      ),
    );
    if (!out.AuthenticationResult) throw new IdpError('SESSION_EXPIRED');
    // Without refresh-token rotation enabled on the client Cognito keeps the old refresh token.
    return tokensOf(out.AuthenticationResult, refreshToken);
  }

  async revoke(pool: Pool, refreshToken: string): Promise<void> {
    try {
      await this.client.send(new RevokeTokenCommand({ ClientId: this.pool(pool).clientId, Token: refreshToken }));
    } catch (e) {
      // An unknown/expired token is already as revoked as it gets.
      const name = (e as { name?: string }).name;
      if (name === 'UnauthorizedException' || name === 'NotAuthorizedException') return;
      throw e;
    }
  }

  async forgotPassword(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void> {
    try {
      await this.client.send(
        new ForgotPasswordCommand({ ClientId: this.pool(pool).clientId, Username: username, ClientMetadata: metadata(clientMetadata) }),
      );
    } catch (e) {
      const name = (e as { name?: string }).name;
      if (name === 'UserNotFoundException' || name === 'InvalidParameterException' || name === 'NotAuthorizedException') return;
      throw toIdpError(e, 'code');
    }
  }

  async confirmForgotPassword(pool: Pool, username: string, code: string, newPassword: string): Promise<void> {
    checkPasswordPolicy(newPassword);
    // Cognito revokes the user's refresh tokens on a password reset.
    await this.call('code', () =>
      this.client.send(
        new ConfirmForgotPasswordCommand({ ClientId: this.pool(pool).clientId, Username: username, ConfirmationCode: code, Password: newPassword }),
      ),
    );
  }

  async adminCreateUser(pool: Pool, input: AdminCreateUserInput): Promise<{ sub: string; temporaryPassword: string }> {
    const temporaryPassword = input.temporaryPassword ?? generateTemporaryPassword();
    checkPasswordPolicy(temporaryPassword);
    const out = await this.call('signup', () =>
      this.client.send(
        new AdminCreateUserCommand({
          UserPoolId: this.pool(pool).userPoolId,
          Username: input.username,
          TemporaryPassword: temporaryPassword,
          UserAttributes: attributeList({ ...input.attributes, email: input.email, email_verified: 'true' }),
          DesiredDeliveryMediums: ['EMAIL'],
          // The CustomMessage trigger brands the invitation from ClientMetadata.
          ...(input.clientMetadata ? { ClientMetadata: metadata(input.clientMetadata) } : { MessageAction: 'SUPPRESS' as const }),
        }),
      ),
    );
    const sub = out.User?.Attributes?.find((a) => a.Name === 'sub')?.Value;
    if (!sub) throw new Error('Cognito AdminCreateUser returned no sub');
    return { sub, temporaryPassword };
  }

  async adminDeleteUser(pool: Pool, username: string): Promise<void> {
    try {
      await this.client.send(new AdminDeleteUserCommand({ UserPoolId: this.pool(pool).userPoolId, Username: username }));
    } catch (e) {
      if ((e as { name?: string }).name === 'UserNotFoundException') return; // idempotent (erasure retries)
      throw e;
    }
  }

  async adminDisableUser(pool: Pool, username: string): Promise<void> {
    await this.call('admin', () => this.client.send(new AdminDisableUserCommand({ UserPoolId: this.pool(pool).userPoolId, Username: username })));
  }

  async adminEnableUser(pool: Pool, username: string): Promise<void> {
    await this.call('admin', () => this.client.send(new AdminEnableUserCommand({ UserPoolId: this.pool(pool).userPoolId, Username: username })));
  }

  async verifyAccessToken(pool: Pool, token: string): Promise<VerifiedAccessToken> {
    try {
      const payload = await this.verifiers[pool].verify(token);
      return { sub: payload.sub, pool, username: payload.username, exp: payload.exp };
    } catch (e) {
      throw new IdpError('SESSION_EXPIRED', 'Invalid or expired access token', { cause: e });
    }
  }
}

function tokensOf(r: AuthenticationResultType, fallbackRefresh?: string): Tokens {
  const refreshToken = r.RefreshToken ?? fallbackRefresh;
  if (!r.AccessToken || !refreshToken) throw new Error('Cognito returned incomplete tokens');
  return { accessToken: r.AccessToken, refreshToken, expiresIn: r.ExpiresIn ?? 3600 };
}
