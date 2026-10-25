/**
 * Infrastructure ports. Every adapter has a local implementation (Postgres `idp` schema,
 * dev mailbox, filesystem, HMAC "edge") and an AWS one (Cognito, SES, S3, CloudFront).
 */

// ---------------------------------------------------------------------------
// Database access handed to local adapters by the caller.

export interface QueryResultLike<R> {
  rows: R[];
  rowCount: number | null;
}

/** The subset of `pg.PoolClient` / `pg.Pool` the adapters use. */
export interface Queryable {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResultLike<R>>;
}

/**
 * Runs `fn` inside a transaction the caller opened (for the local IdP with
 * `SET LOCAL ROLE idp_local`), committing on success and rolling back on throw.
 */
export type TxRunner = <T>(fn: (db: Queryable) => Promise<T>) => Promise<T>;

// ---------------------------------------------------------------------------
// Identity provider (modelled on Cognito user pools).

export type Pool = 'CUSTOMER' | 'STAFF';
export const POOLS: readonly Pool[] = ['CUSTOMER', 'STAFF'];

/**
 * Branding passed with every call that sends a message, like Cognito `ClientMetadata`
 * consumed by the CustomMessage trigger. All values are strings (a Cognito constraint).
 */
export interface ClientMetadata {
  resellerId?: string;
  brandName: string;
  primaryColor?: string;
  /** Storefront (customer pool) or admin URL (staff pool) used for links in mails. */
  storefrontUrl: string;
  supportEmail?: string;
  locale?: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export type ChallengeName = 'SOFTWARE_TOKEN_MFA' | 'MFA_SETUP' | 'NEW_PASSWORD_REQUIRED';

export type AuthResult =
  | { kind: 'TOKENS'; tokens: Tokens }
  | { kind: 'CHALLENGE'; challenge: ChallengeName; session: string };

export interface SignUpInput {
  pool: Pool;
  username: string;
  email: string;
  password: string;
  attributes?: Record<string, string>;
  clientMetadata: ClientMetadata;
}

export interface AdminCreateUserInput {
  username: string;
  email: string;
  /** Generated (policy-compliant) when omitted. */
  temporaryPassword?: string;
  attributes?: Record<string, string>;
  /** Branding for the invitation mail; no mail is sent when omitted. */
  clientMetadata?: ClientMetadata;
}

export interface VerifiedAccessToken {
  sub: string;
  pool: Pool;
  username: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export interface SoftwareTokenAssociation {
  /** Base32 TOTP secret to show (and encode in a QR code). */
  secret: string;
  otpauthUri: string;
  /** The session to pass to `verifySoftwareToken`. */
  session: string;
}

export interface IdentityProvider {
  signUp(input: SignUpInput): Promise<{ sub: string }>;
  confirmSignUp(pool: Pool, username: string, code: string): Promise<void>;
  resendConfirmationCode(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void>;
  initiateAuth(pool: Pool, username: string, password: string): Promise<AuthResult>;
  respondMfa(pool: Pool, session: string, code: string): Promise<Tokens>;
  associateSoftwareToken(pool: Pool, session: string): Promise<SoftwareTokenAssociation>;
  verifySoftwareToken(pool: Pool, session: string, code: string): Promise<Tokens>;
  respondNewPassword(pool: Pool, session: string, newPassword: string): Promise<AuthResult>;
  refresh(pool: Pool, refreshToken: string): Promise<Tokens>;
  revoke(pool: Pool, refreshToken: string): Promise<void>;
  forgotPassword(pool: Pool, username: string, clientMetadata: ClientMetadata): Promise<void>;
  confirmForgotPassword(pool: Pool, username: string, code: string, newPassword: string): Promise<void>;
  adminCreateUser(pool: Pool, input: AdminCreateUserInput): Promise<{ sub: string; temporaryPassword: string }>;
  adminDeleteUser(pool: Pool, username: string): Promise<void>;
  adminDisableUser(pool: Pool, username: string): Promise<void>;
  adminEnableUser(pool: Pool, username: string): Promise<void>;
  verifyAccessToken(pool: Pool, token: string): Promise<VerifiedAccessToken>;
}

// ---------------------------------------------------------------------------
// Mail

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  resellerId?: string;
  /** The reseller's support address. The From domain is always the platform's. */
  replyTo?: string;
  /** Display name in From, typically the reseller's brand name. */
  fromName?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<{ messageId: string }>;
}

// ---------------------------------------------------------------------------
// Protected asset delivery (CloudFront signed cookies / URLs)

export type AssetTier = 'LOW' | 'FULL';

export interface SignedCookie {
  name: 'CloudFront-Policy' | 'CloudFront-Signature' | 'CloudFront-Key-Pair-Id';
  value: string;
  attributes: {
    path: string;
    httpOnly: true;
    secure: boolean;
    sameSite: 'Lax';
    maxAge: number;
    expires: Date;
  };
}

export interface AssetSigner {
  /** Cookies whose policy covers `https://{host}/assets/lo/*` (LOW) or `/assets/*` (FULL). */
  issueCookies(input: { host: string; tier: AssetTier; ttlSeconds: number }): Promise<{ cookies: SignedCookie[]; expiresAt: Date }>;
  /** A signed URL for exactly one file (AR hand-off, where viewers drop cookies). */
  signUrl(input: { host: string; path: string; ttlSeconds: number }): Promise<{ url: string; expiresAt: Date }>;
}

// ---------------------------------------------------------------------------
// Object storage

export interface PresignedPut {
  url: string;
  /** Headers the client must send verbatim with the PUT. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectHead {
  contentType: string;
  byteSize: number;
  cacheControl?: string;
}

export interface ObjectStore {
  readonly bucket: string;
  presignPut(input: { key: string; contentType: string; byteSize: number; ttlSeconds: number }): Promise<PresignedPut>;
  get(key: string): Promise<Buffer | null>;
  put(key: string, body: Uint8Array, contentType: string, cacheControl?: string): Promise<void>;
  delete(key: string): Promise<void>;
  head(key: string): Promise<ObjectHead | null>;
}

// ---------------------------------------------------------------------------
// Edge tenant directory (CloudFront KeyValueStore read by the viewer-request function)

export type EdgeTenantStatus = 'ACTIVE' | 'SUSPENDED';

export interface EdgeTenantStore {
  put(slug: string, status: EdgeTenantStatus): Promise<void>;
  delete(slug: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Queue

export interface Queue {
  send(message: unknown, options?: { delaySeconds?: number }): Promise<void>;
}
