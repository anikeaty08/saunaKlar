import type { Hono } from 'hono';
import { routes, type StaffChallengeResponse } from '@saunaklar/shared';
import type { AuthResult, ChallengeName, Tokens } from '../adapters/types.ts';
import type { AppEnv, Ctx } from '../context.ts';
import { platformTx, tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { loadPrincipal, setSessionCookies } from '../middleware/session.ts';

/**
 * Staff sign-in on a reseller host (`{slug}/admin`) or the manufacturer host.
 * Follows the Cognito challenge flow: password → (new password) → TOTP setup
 * or TOTP code → tokens. The challenge kind travels inside the opaque
 * challenge id so the client only ever echoes it back.
 */
const KINDS: Record<string, ChallengeName> = { M: 'SOFTWARE_TOKEN_MFA', S: 'MFA_SETUP', P: 'NEW_PASSWORD_REQUIRED' };
const PREFIX: Record<ChallengeName, string> = { SOFTWARE_TOKEN_MFA: 'M', MFA_SETUP: 'S', NEW_PASSWORD_REQUIRED: 'P' };

function parseChallenge(id: string): { kind: ChallengeName; session: string } {
  const kind = KINDS[id.slice(0, 1)];
  if (!kind || id[1] !== '.') throw new ApiError('CHALLENGE_EXPIRED');
  return { kind, session: id.slice(2) };
}

function requireStaffHost(c: Ctx): void {
  const kind = c.get('host').kind;
  if (kind !== 'storefront' && kind !== 'manufacturer') throw new ApiError('NOT_FOUND');
}

async function step(c: Ctx, result: AuthResult): Promise<StaffChallengeResponse> {
  const { identity } = c.get('deps').adapters;
  if (result.kind === 'TOKENS') return finish(c, result.tokens);
  if (result.challenge === 'MFA_SETUP') {
    const assoc = await identity.associateSoftwareToken('STAFF', result.session);
    return { status: 'MFA_SETUP', challengeId: `${PREFIX.MFA_SETUP}.${assoc.session}`, secret: assoc.secret, otpauthUri: assoc.otpauthUri };
  }
  const status = result.challenge === 'SOFTWARE_TOKEN_MFA' ? 'MFA_REQUIRED' : 'NEW_PASSWORD_REQUIRED';
  return { status, challengeId: `${PREFIX[result.challenge]}.${result.session}` };
}

/**
 * Tokens are only turned into a session when the staff user actually
 * administers THIS host's reseller (or the manufacturer, on the admin host).
 * Otherwise the tokens are revoked and the answer is indistinguishable from
 * a wrong password.
 */
async function finish(c: Ctx, tokens: Tokens): Promise<StaffChallengeResponse> {
  const { identity } = c.get('deps').adapters;
  const { sub } = await identity.verifyAccessToken('STAFF', tokens.accessToken);
  const host = c.get('host');
  const activate = (fn: typeof tenantTx) => fn(c, db => db.query('select activate_staff_user($1)', [sub]));
  if (host.kind === 'storefront') await activate(tenantTx);
  else await activate(platformTx);
  const principal = await loadPrincipal(c, 'STAFF', sub);
  if (!principal) {
    await identity.revoke('STAFF', tokens.refreshToken).catch(() => undefined);
    throw new ApiError('INVALID_CREDENTIALS');
  }
  setSessionCookies(c, 'STAFF', tokens);
  c.set('principal', principal);
  return { status: 'OK' };
}

export function registerStaffAuth(app: Hono<AppEnv>): void {
  mount(app, routes.staffLogin, async ({ c, body }) => {
    requireStaffHost(c);
    const result = await c.get('deps').adapters.identity.initiateAuth('STAFF', body.email.toLowerCase(), body.password);
    return step(c, result);
  });

  mount(app, routes.staffMfa, async ({ c, body }) => {
    requireStaffHost(c);
    const { identity } = c.get('deps').adapters;
    const { kind, session } = parseChallenge(body.challengeId);
    if (kind === 'SOFTWARE_TOKEN_MFA') return finish(c, await identity.respondMfa('STAFF', session, body.code));
    if (kind === 'MFA_SETUP') return finish(c, await identity.verifySoftwareToken('STAFF', session, body.code));
    throw new ApiError('CHALLENGE_EXPIRED');
  });

  mount(app, routes.staffNewPassword, async ({ c, body }) => {
    requireStaffHost(c);
    const { kind, session } = parseChallenge(body.challengeId);
    if (kind !== 'NEW_PASSWORD_REQUIRED') throw new ApiError('CHALLENGE_EXPIRED');
    return step(c, await c.get('deps').adapters.identity.respondNewPassword('STAFF', session, body.newPassword));
  });
}
