import type { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { routes } from '@saunaklar/shared';
import type { AssetTier } from '../adapters/types.ts';
import type { AppEnv, Ctx, Db } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { resolveShareToken } from '../domain/sharing.ts';

/**
 * Asset access (design 10): 3D files sit behind CloudFront signed cookies.
 * Anonymous visitors get the LOW tier (`/assets/lo/*`); signed-in users and
 * holders of a valid share link get FULL (`/assets/*`). The policy is bound
 * to the requesting host (review G2), so cookies from one reseller never
 * unlock another reseller's subdomain.
 */

/** Sets the CloudFront cookies for `tier` on this host and returns their expiry. */
export async function issueAssetCookies(c: Ctx, tier: AssetTier): Promise<Date> {
  const { adapters, config } = c.get('deps');
  const { cookies, expiresAt } = await adapters.assetSigner.issueCookies({ host: c.get('host').name, tier, ttlSeconds: config.ASSET_COOKIE_TTL_SECONDS });
  for (const ck of cookies) {
    setCookie(c, ck.name, ck.value, { path: ck.attributes.path, httpOnly: true, secure: ck.attributes.secure, sameSite: 'Lax', maxAge: ck.attributes.maxAge });
  }
  return expiresAt;
}

/** The share link's sauna model, or null when the token is not usable. Errors are swallowed: a bad token just means LOW. */
async function shareModel(db: Db, token: string | undefined, now: Date): Promise<string | null> {
  if (!token) return null;
  try {
    const link = await resolveShareToken(db, token, now);
    const { rows } = await db.query<{ sauna_model_id: string; locked_at: Date | null }>(
      'select sauna_model_id, locked_at from configurations where id = $1', [link.configuration_id]);
    return rows[0]?.locked_at ? rows[0].sauna_model_id : null;
  } catch (err) {
    if (err instanceof ApiError) return null;
    throw err;
  }
}

export function registerAssets(app: Hono<AppEnv>): void {
  mount(app, routes.assetSession, async ({ c, body, principal }) => {
    let tier: AssetTier = principal.kind === 'anonymous' ? 'LOW' : 'FULL';
    if (tier === 'LOW' && body.shareToken) {
      const model = await tenantTx(c, db => shareModel(db, body.shareToken, c.get('deps').now()));
      if (model) tier = 'FULL';
    }
    const expiresAt = await issueAssetCookies(c, tier);
    c.header('Cache-Control', 'no-store');
    return { tier: tier === 'LOW' ? 'LOW' as const : 'FULL' as const, expiresAt: expiresAt.toISOString() };
  });

  mount(app, routes.assetAr, async ({ c, body, principal }) => {
    const { adapters, config, now } = c.get('deps');
    const keys = await tenantTx(c, async db => {
      const viaShare = principal.kind === 'anonymous' ? await shareModel(db, body.shareToken, now()) : null;
      if (principal.kind === 'anonymous' && viaShare !== body.saunaModelId) {
        throw new ApiError('UNAUTHENTICATED', 'Sign in or open a shared configuration to view this sauna in AR.');
      }
      // The model must be assigned to this reseller. A hidden model stays reachable for
      // staff (preview) and for share viewers whose configuration predates the hiding.
      const { rows } = await db.query<{ is_visible: boolean; glb: string | null; usdz: string | null }>(
        `select rs.is_visible,
                (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
                  where x.sauna_model_id = rs.sauna_model_id and x.asset_role = 'MODEL_AR_GLB') as glb,
                (select a.storage_key from sauna_model_assets x join assets a on a.id = x.asset_id
                  where x.sauna_model_id = rs.sauna_model_id and x.asset_role = 'MODEL_AR_USDZ') as usdz
           from reseller_saunas rs
           join sauna_models m on m.id = rs.sauna_model_id and m.status = 'ACTIVE'
          where rs.reseller_id = $1 and rs.sauna_model_id = $2`,
        [c.get('tenant')!.id, body.saunaModelId]);
      const row = rows[0];
      if (!row || (!row.is_visible && principal.kind === 'customer' && !viaShare)) throw new ApiError('NOT_FOUND', 'This sauna is not offered here.');
      return row;
    });
    const host = c.get('host').name;
    const ttlSeconds = config.AR_URL_TTL_SECONDS;
    const [glb, usdz] = await Promise.all([
      keys.glb ? adapters.assetSigner.signUrl({ host, path: `/${keys.glb}`, ttlSeconds }) : null,
      keys.usdz ? adapters.assetSigner.signUrl({ host, path: `/${keys.usdz}`, ttlSeconds }) : null,
    ]);
    c.header('Cache-Control', 'no-store');
    const expiresAt = glb?.expiresAt ?? usdz?.expiresAt ?? new Date(now().getTime() + ttlSeconds * 1000);
    return { glbUrl: glb?.url ?? null, usdzUrl: usdz?.url ?? null, expiresAt: expiresAt.toISOString() };
  });
}
