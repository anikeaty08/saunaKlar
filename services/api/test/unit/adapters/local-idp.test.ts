import { beforeEach, describe, expect, it } from 'vitest';
import { IdpError } from '../../../src/adapters/errors.ts';
import { LocalIdentityProvider } from '../../../src/adapters/idp/local.ts';
import { base32Decode } from '../../../src/adapters/idp/base32.ts';
import { totp } from '../../../src/adapters/idp/totp.ts';
import type { AuthResult, ClientMetadata, MailMessage, Mailer, Tokens } from '../../../src/adapters/types.ts';
import { FakeIdpDb } from './fake-idp-db.ts';

const CUSTOMER_ID = '6f1c1b1e-0c4e-4c8e-9a39-6a3b2f6d9e01';
const meta: ClientMetadata = {
  resellerId: '0b9a0f7e-1111-4222-8333-944455556666',
  brandName: 'Alpha Spa',
  primaryColor: '#2a6f4e',
  storefrontUrl: 'https://alpha.example.com',
  supportEmail: 'help@alpha.example.com',
  locale: 'de',
};

class CapturingMailer implements Mailer {
  sent: MailMessage[] = [];
  async send(m: MailMessage) {
    this.sent.push(m);
    return { messageId: String(this.sent.length) };
  }
  lastCode(): string {
    const m = /^ {4}(\S+)$/m.exec(this.sent.at(-1)?.text ?? '');
    if (!m) throw new Error('no code in last mail');
    return m[1]!;
  }
}

let clock: Date;
let db: FakeIdpDb;
let mailer: CapturingMailer;
let idp: LocalIdentityProvider;

const make = (staffMfa: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED') =>
  new LocalIdentityProvider({ tx: db.tx, mailer, jwtSecret: 'test-jwt-secret-0123456789abcdefghijkl', staffMfa, now: () => clock });

const advance = (ms: number) => (clock = new Date(clock.getTime() + ms));

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof IdpError) return e.code;
    throw e;
  }
  return 'OK';
}

const tokensOf = (r: AuthResult): Tokens => {
  if (r.kind !== 'TOKENS') throw new Error(`expected tokens, got ${r.challenge}`);
  return r.tokens;
};
const sessionOf = (r: AuthResult, challenge: string): string => {
  if (r.kind !== 'CHALLENGE' || r.challenge !== challenge) throw new Error(`expected ${challenge}`);
  return r.session;
};

beforeEach(() => {
  clock = new Date('2026-10-23T10:00:00Z');
  db = new FakeIdpDb(() => clock);
  mailer = new CapturingMailer();
  idp = make();
});

async function signUpCustomer() {
  await idp.signUp({
    pool: 'CUSTOMER',
    username: CUSTOMER_ID,
    email: 'anna@example.com',
    password: 'Sauna-Lover-2026',
    attributes: { given_name: 'Anna' },
    clientMetadata: meta,
  });
}

describe('LocalIdentityProvider: customer sign-up', () => {
  it('uses the customer id as sub and mails a branded, localised code', async () => {
    const { sub } = await idp.signUp({ pool: 'CUSTOMER', username: CUSTOMER_ID, email: 'anna@example.com', password: 'Sauna-Lover-2026', clientMetadata: meta });
    expect(sub).toBe(CUSTOMER_ID);
    const mail = mailer.sent[0]!;
    expect(mail).toMatchObject({ to: 'anna@example.com', fromName: 'Alpha Spa', replyTo: 'help@alpha.example.com', resellerId: meta.resellerId });
    expect(mail.subject).toBe('Ihr Bestätigungscode für Alpha Spa');
    expect(mail.html).toContain('#2a6f4e');
    expect(mailer.lastCode()).toMatch(/^\d{6}$/);
    // Only the hash is stored.
    const stored = [...db.state.codes.values()][0]!;
    expect(stored.code_hash).not.toContain(mailer.lastCode());
  });

  it('enforces the password policy and rejects duplicate usernames', async () => {
    expect(await codeOf(idp.signUp({ pool: 'CUSTOMER', username: CUSTOMER_ID, email: 'a@b.ch', password: 'short', clientMetadata: meta }))).toBe('PASSWORD_POLICY');
    await signUpCustomer();
    expect(await codeOf(idp.signUp({ pool: 'CUSTOMER', username: CUSTOMER_ID, email: 'a@b.ch', password: 'Sauna-Lover-2026', clientMetadata: meta }))).toBe('CONFLICT');
  });

  it('rolls back the user when the mail cannot be sent', async () => {
    mailer.send = async () => {
      throw new Error('smtp down');
    };
    await expect(signUpCustomer()).rejects.toThrow('smtp down');
    expect(db.state.users.size).toBe(0);
  });

  it('blocks sign-in until confirmed, then issues tokens', async () => {
    await signUpCustomer();
    expect(await codeOf(idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'))).toBe('EMAIL_NOT_VERIFIED');
    await idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, mailer.lastCode());
    const tokens = tokensOf(await idp.initiateAuth('CUSTOMER', CUSTOMER_ID.toUpperCase(), 'Sauna-Lover-2026'));
    expect(tokens.expiresIn).toBe(900);
    expect(await idp.verifyAccessToken('CUSTOMER', tokens.accessToken)).toEqual({
      sub: CUSTOMER_ID,
      pool: 'CUSTOMER',
      username: CUSTOMER_ID,
      exp: Math.floor(clock.getTime() / 1000) + 900,
    });
    expect(await codeOf(idp.verifyAccessToken('STAFF', tokens.accessToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.verifyAccessToken('CUSTOMER', `${tokens.accessToken}x`))).toBe('SESSION_EXPIRED');
  });

  it('never reveals whether a user exists', async () => {
    await signUpCustomer();
    await idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, mailer.lastCode());
    expect(await codeOf(idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Wrong-Password-1'))).toBe('INVALID_CREDENTIALS');
    expect(await codeOf(idp.initiateAuth('CUSTOMER', 'nobody', 'Wrong-Password-1'))).toBe('INVALID_CREDENTIALS');
    const before = mailer.sent.length;
    await expect(idp.forgotPassword('CUSTOMER', 'nobody', meta)).resolves.toBeUndefined();
    await expect(idp.resendConfirmationCode('CUSTOMER', 'nobody', meta)).resolves.toBeUndefined();
    await expect(idp.resendConfirmationCode('CUSTOMER', CUSTOMER_ID, meta)).resolves.toBeUndefined(); // already confirmed
    expect(mailer.sent.length).toBe(before);
  });

  it('invalidates a code after 5 wrong attempts (attempts survive the failed call)', async () => {
    await signUpCustomer();
    const code = mailer.lastCode();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, wrong))).toBe('CODE_INVALID');
    expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, code))).toBe('CODE_INVALID');
    await idp.resendConfirmationCode('CUSTOMER', CUSTOMER_ID, meta);
    expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, mailer.lastCode()))).toBe('OK');
  });

  it('expires sign-up codes after 24 hours', async () => {
    await signUpCustomer();
    advance(24 * 3600 * 1000 + 1);
    expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, mailer.lastCode()))).toBe('CODE_EXPIRED');
  });

  it('a resent code replaces the previous one', async () => {
    await signUpCustomer();
    const first = mailer.lastCode();
    await idp.resendConfirmationCode('CUSTOMER', CUSTOMER_ID, meta);
    const second = mailer.lastCode();
    if (first !== second) expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, first))).toBe('CODE_INVALID');
    expect(await codeOf(idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, second))).toBe('OK');
  });
});

describe('LocalIdentityProvider: refresh tokens', () => {
  let tokens: Tokens;
  beforeEach(async () => {
    await signUpCustomer();
    await idp.confirmSignUp('CUSTOMER', CUSTOMER_ID, mailer.lastCode());
    tokens = tokensOf(await idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'));
  });

  it('rotates, and reuse of a rotated token revokes the whole family', async () => {
    const second = await idp.refresh('CUSTOMER', tokens.refreshToken);
    expect(second.refreshToken).not.toBe(tokens.refreshToken);
    const third = await idp.refresh('CUSTOMER', second.refreshToken);
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('CUSTOMER', third.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('two tabs refreshing with the same token within 15 s both get the same successor', async () => {
    const first = await idp.refresh('CUSTOMER', tokens.refreshToken);
    advance(14_000);
    const second = await idp.refresh('CUSTOMER', tokens.refreshToken);
    expect(second).toEqual(first);
    // The successor stays usable and rotates normally.
    const third = await idp.refresh('CUSTOMER', first.refreshToken);
    expect(third.refreshToken).not.toBe(first.refreshToken);
  });

  it('keeps successors only encrypted', async () => {
    const next = await idp.refresh('CUSTOMER', tokens.refreshToken);
    const attrs = JSON.stringify(db.state.users.get(CUSTOMER_ID)!.attributes);
    expect(attrs).toContain('idp:refresh_grace');
    expect(attrs).not.toContain(next.refreshToken);
    expect(attrs).not.toContain(next.accessToken);
  });

  it('outside the window reuse still revokes the family', async () => {
    const next = await idp.refresh('CUSTOMER', tokens.refreshToken);
    advance(15_001);
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('CUSTOMER', next.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('the window does not revive a logged-out or disabled session', async () => {
    const next = await idp.refresh('CUSTOMER', tokens.refreshToken);
    await idp.revoke('CUSTOMER', next.refreshToken);
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');

    const fresh = tokensOf(await idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'));
    await idp.refresh('CUSTOMER', fresh.refreshToken);
    await idp.adminDisableUser('CUSTOMER', CUSTOMER_ID);
    expect(await codeOf(idp.refresh('CUSTOMER', fresh.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('a stale grace entry for a successor that was rotated again counts as reuse', async () => {
    const second = await idp.refresh('CUSTOMER', tokens.refreshToken);
    const third = await idp.refresh('CUSTOMER', second.refreshToken);
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.refresh('CUSTOMER', third.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('only works in its own pool and expires after 30 days, not extended by rotation', async () => {
    expect(await codeOf(idp.refresh('STAFF', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    advance(29 * 24 * 3600 * 1000);
    const next = await idp.refresh('CUSTOMER', tokens.refreshToken);
    advance(2 * 24 * 3600 * 1000);
    expect(await codeOf(idp.refresh('CUSTOMER', next.refreshToken))).toBe('SESSION_EXPIRED');
  });

  it('revoke ends the session family; unknown tokens are ignored', async () => {
    const next = await idp.refresh('CUSTOMER', tokens.refreshToken);
    await idp.revoke('CUSTOMER', next.refreshToken);
    expect(await codeOf(idp.refresh('CUSTOMER', next.refreshToken))).toBe('SESSION_EXPIRED');
    await expect(idp.revoke('CUSTOMER', 'nonsense')).resolves.toBeUndefined();
  });

  it('password reset changes the password and revokes every refresh token', async () => {
    await idp.forgotPassword('CUSTOMER', CUSTOMER_ID, { ...meta, locale: 'fr' });
    expect(mailer.sent.at(-1)!.subject).toBe('Réinitialisez votre mot de passe Alpha Spa');
    const code = mailer.lastCode();
    expect(await codeOf(idp.confirmForgotPassword('CUSTOMER', CUSTOMER_ID, code, 'weak'))).toBe('PASSWORD_POLICY');
    await idp.confirmForgotPassword('CUSTOMER', CUSTOMER_ID, code, 'New-Sauna-Pass-9');
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    expect(await codeOf(idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'))).toBe('INVALID_CREDENTIALS');
    tokensOf(await idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'New-Sauna-Pass-9'));
    expect(await codeOf(idp.confirmForgotPassword('CUSTOMER', CUSTOMER_ID, code, 'Another-Pass-77'))).toBe('CODE_INVALID');
  });

  it('reset codes expire after 1 hour', async () => {
    await idp.forgotPassword('CUSTOMER', CUSTOMER_ID, meta);
    advance(3600 * 1000 + 1);
    expect(await codeOf(idp.confirmForgotPassword('CUSTOMER', CUSTOMER_ID, mailer.lastCode(), 'New-Sauna-Pass-9'))).toBe('CODE_EXPIRED');
  });

  it('disable blocks sign-in and refresh; enable restores the account', async () => {
    await idp.adminDisableUser('CUSTOMER', CUSTOMER_ID);
    expect(await codeOf(idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'))).toBe('ACCOUNT_DISABLED');
    expect(await codeOf(idp.refresh('CUSTOMER', tokens.refreshToken))).toBe('SESSION_EXPIRED');
    await idp.adminEnableUser('CUSTOMER', CUSTOMER_ID);
    tokensOf(await idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'));
    expect(await codeOf(idp.adminDisableUser('CUSTOMER', 'nobody'))).toBe('NOT_FOUND');
  });

  it('delete removes the user idempotently', async () => {
    await idp.adminDeleteUser('CUSTOMER', CUSTOMER_ID);
    await idp.adminDeleteUser('CUSTOMER', CUSTOMER_ID);
    expect(db.state.users.size).toBe(0);
    expect(db.state.refresh.size).toBe(0);
    expect(await codeOf(idp.initiateAuth('CUSTOMER', CUSTOMER_ID, 'Sauna-Lover-2026'))).toBe('INVALID_CREDENTIALS');
  });
});

describe('LocalIdentityProvider: staff with TOTP', () => {
  const email = 'owner@alpha.example.com';
  const adminMeta = { ...meta, storefrontUrl: 'https://alpha.example.com/admin', locale: 'it' };
  const now = () => Math.floor(clock.getTime() / 1000);

  async function invite() {
    const { temporaryPassword } = await idp.adminCreateUser('STAFF', { username: email, email, attributes: { name: 'Olivia' }, clientMetadata: adminMeta });
    return temporaryPassword;
  }

  async function enrol(): Promise<string> {
    const temp = await invite();
    const np = sessionOf(await idp.initiateAuth('STAFF', email, temp), 'NEW_PASSWORD_REQUIRED');
    const setup = sessionOf(await idp.respondNewPassword('STAFF', np, 'Staff-Secret-123'), 'MFA_SETUP');
    const assoc = await idp.associateSoftwareToken('STAFF', setup);
    expect(assoc.otpauthUri).toContain(`secret=${assoc.secret}`);
    expect(await codeOf(idp.verifySoftwareToken('STAFF', setup, '000000'))).toBe('CHALLENGE_EXPIRED'); // old session is gone
    const secret = base32Decode(assoc.secret);
    tokensOf({ kind: 'TOKENS', tokens: await idp.verifySoftwareToken('STAFF', assoc.session, totp(secret, now())) });
    return assoc.secret;
  }

  it('mails a localised invitation with the temporary password', async () => {
    const temp = await invite();
    const mail = mailer.sent[0]!;
    expect(mail.to).toBe(email);
    expect(mail.subject).toBe('È stato invitato su Alpha Spa');
    expect(mail.text).toContain(temp);
    expect(mail.html).toContain('https://alpha.example.com/admin');
  });

  it('walks NEW_PASSWORD_REQUIRED → MFA_SETUP → tokens, then requires TOTP', async () => {
    const secret = base32Decode(await enrol());
    advance(60_000);
    const mfa = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    expect(await codeOf(idp.respondMfa('STAFF', mfa, '000000'))).toBe('MFA_INVALID');
    const code = totp(secret, now());
    const tokens = await idp.respondMfa('STAFF', mfa, code);
    expect((await idp.verifyAccessToken('STAFF', tokens.accessToken)).username).toBe(email);
    // The same code cannot be replayed on a new login.
    const again = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    expect(await codeOf(idp.respondMfa('STAFF', again, code))).toBe('MFA_INVALID');
    // A consumed session cannot be used twice.
    expect(await codeOf(idp.respondMfa('STAFF', mfa, code))).toBe('CHALLENGE_EXPIRED');
  });

  it('rejects forged, expired and exhausted sessions', async () => {
    const secret = base32Decode(await enrol());
    advance(60_000);
    const mfa = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    const [id] = mfa.split('.');
    expect(await codeOf(idp.respondMfa('STAFF', `${id}.forged`, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
    expect(await codeOf(idp.respondMfa('CUSTOMER', mfa, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
    for (let i = 0; i < 5; i++) await codeOf(idp.respondMfa('STAFF', mfa, '000000'));
    expect(await codeOf(idp.respondMfa('STAFF', mfa, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
    const late = sessionOf(await idp.initiateAuth('STAFF', email, 'Staff-Secret-123'), 'SOFTWARE_TOKEN_MFA');
    advance(5 * 60_000 + 1);
    expect(await codeOf(idp.respondMfa('STAFF', late, totp(secret, now())))).toBe('CHALLENGE_EXPIRED');
  });

  it('temporary passwords expire after 7 days', async () => {
    const temp = await invite();
    advance(7 * 24 * 3600 * 1000 + 1);
    expect(await codeOf(idp.initiateAuth('STAFF', email, temp))).toBe('INVALID_CREDENTIALS');
  });

  it('with an OPTIONAL policy staff without TOTP get tokens directly', async () => {
    idp = make('OPTIONAL');
    const temp = await invite();
    const np = sessionOf(await idp.initiateAuth('STAFF', email, temp), 'NEW_PASSWORD_REQUIRED');
    tokensOf(await idp.respondNewPassword('STAFF', np, 'Staff-Secret-123'));
  });

  it('generates a policy-compliant temporary password when none is given', async () => {
    const temp = await invite();
    expect(temp).toMatch(/^(?=.*[A-Z])(?=.*[a-z])(?=.*\d).{10,}$/);
  });
});
