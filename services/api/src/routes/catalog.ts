import type { Hono } from 'hono';
import { routes, type Tenant } from '@saunaklar/shared';
import type { AppEnv, Ctx } from '../context.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { mount } from '../lib/route.ts';
import { assetUrl, listCatalog, listRooms, loadModel } from '../domain/catalog.ts';
import { getConfigRow, getSelections, getSnapshot } from '../domain/configurations.ts';
import { deviceClass, resolveShareToken } from '../domain/sharing.ts';
import { issueAssetCookies } from './assets.ts';

const IMMUTABLE = 'public, max-age=31536000, immutable';

/**
 * Catalog cache contract (rule 9, review C1). The client asks with
 * `?v=<catalogVersion>` taken from /api/tenant:
 * - exact match: cacheable forever, the URL changes when the catalog does;
 * - mismatch: 409 with the current version, never a stale body cached under a new URL;
 * - no version: served, but not cached anywhere.
 * The tenant cache can be up to 60 s old, so a mismatch is re-checked
 * against the database before it is reported.
 */
async function checkVersion(c: Ctx, v: number | undefined): Promise<void> {
  c.header('Vary', 'Accept-Language');
  if (v === undefined) {
    c.header('Cache-Control', 'no-store');
    return;
  }
  const tenant = c.get('tenant')!;
  let current = tenant.catalogVersion;
  if (v !== current) {
    const { rows } = await c.get('deps').pool.query<{ catalog_version: string }>('select catalog_version from resolve_tenant($1)', [tenant.slug]);
    current = Number(rows[0]?.catalog_version ?? current);
  }
  if (v !== current) {
    c.header('Cache-Control', 'no-store');
    throw new ApiError('STALE_CATALOG_VERSION', 'The catalog has changed, reload it.', { meta: { currentVersion: current } });
  }
  c.header('Cache-Control', IMMUTABLE);
}

export function registerCatalog(app: Hono<AppEnv>): void {
  mount(app, routes.tenant, async ({ c, tenant }) => {
    const t = tenant!;
    const body = await tenantTx(c, async db => {
      const { rows } = await db.query<{
        name: string; default_share_expiry_days: number; display_name: string | null; tagline: string | null; primary_color: string | null;
        logo: string | null; favicon: string | null; support_email: string | null; support_phone: string | null;
        legal_name: string | null; legal_address: string | null; vat_display: 'INCLUDED' | 'EXCLUDED' | 'NONE' | null;
      }>(
        `select r.name, r.default_share_expiry_days, b.display_name, b.tagline, b.primary_color,
                l.storage_key as logo, f.storage_key as favicon, b.support_email, b.support_phone,
                b.legal_name, b.legal_address, b.vat_display
           from resellers r
           left join reseller_branding b on b.reseller_id = r.id
           left join assets l on l.id = b.logo_asset_id
           left join assets f on f.id = b.favicon_asset_id
          where r.id = $1`, [t.id]);
      const r = rows[0];
      if (!r) throw new ApiError('TENANT_NOT_FOUND');
      const out: Tenant = {
        id: t.id,
        slug: t.slug,
        name: r.name,
        currency: t.currency.trim(),
        catalogVersion: t.catalogVersion,
        defaultShareExpiryDays: r.default_share_expiry_days,
        branding: {
          displayName: r.display_name ?? r.name,
          tagline: r.tagline,
          primaryColor: r.primary_color?.trim() ?? '#1a1a1a',
          logoUrl: assetUrl(r.logo),
          faviconUrl: assetUrl(r.favicon),
          supportEmail: r.support_email,
          supportPhone: r.support_phone,
          legalName: r.legal_name,
          legalAddress: r.legal_address,
          vatDisplay: r.vat_display ?? 'INCLUDED',
        },
      };
      return out;
    });
    // Short shared cache: branding edits and version bumps show within a minute (design 12.2).
    c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=60');
    return body;
  });

  mount(app, routes.catalog, async ({ c, query, tenant }) => {
    await checkVersion(c, query.v);
    const items = await tenantTx(c, db => listCatalog(db, tenant!, requestLocale(c)));
    return { catalogVersion: tenant!.catalogVersion, currency: tenant!.currency.trim(), items };
  });

  mount(app, routes.sauna, async ({ c, query, params, tenant }) => {
    await checkVersion(c, query.v);
    const model = await tenantTx(c, db => loadModel(db, tenant!, requestLocale(c), { slug: params.slug! }));
    if (!model) {
      c.header('Cache-Control', 'no-store');
      throw new ApiError('NOT_FOUND', 'This sauna is not offered here.');
    }
    return model.detail;
  });

  mount(app, routes.rooms, async ({ c, query, tenant }) => {
    await checkVersion(c, query.v);
    const items = await tenantTx(c, db => listRooms(db, tenant!, requestLocale(c)));
    return { items };
  });

  mount(app, routes.shared, async ({ c, params, tenant }) => {
    const now = c.get('deps').now();
    const body = await tenantTx(c, async db => {
      const link = await resolveShareToken(db, params.token!, now);
      const row = await getConfigRow(db, link.configuration_id, { staff: true });
      // Links are only ever created for locked configurations; an unlocked one is a data bug, not a viewable state.
      if (!row.locked_at) throw new ApiError('NOT_FOUND', 'This link does not exist.');
      const [model, selections, snapshot, placement] = await Promise.all([
        loadModel(db, tenant!, requestLocale(c), { id: row.sauna_model_id }, true),
        getSelections(db, row.id),
        getSnapshot(db, row.id),
        db.query<{ room_scene_id: string; position_x_mm: number; position_z_mm: number; rotation_deg: string }>(
          'select room_scene_id, position_x_mm, position_z_mm, rotation_deg from configuration_room_placements where configuration_id = $1', [row.id]),
      ]);
      if (!model || !snapshot) throw new ApiError('NOT_FOUND', 'This link does not exist.');
      await db.query('insert into share_link_views (share_link_id, reseller_id, device_class) values ($1, $2, $3)',
        [link.id, tenant!.id, deviceClass(c.req.header('user-agent'))]);
      const { maxDiscountBps: _cap, ...sauna } = model.detail;
      const p = placement.rows[0];
      return {
        configuration: { id: row.id, name: row.name ?? model.detail.name, selections, lockedAt: row.locked_at.toISOString() },
        sauna,
        placement: p ? { roomSceneId: p.room_scene_id, positionXMm: p.position_x_mm, positionZMm: p.position_z_mm, rotationDeg: Number(p.rotation_deg) } : null,
        snapshot,
        expiresAt: link.expires_at.toISOString(),
      };
    });
    // A share link opens the full-quality model for its holder (design 10.2).
    await issueAssetCookies(c, 'FULL');
    c.header('Cache-Control', 'no-store');
    c.header('Referrer-Policy', 'no-referrer');
    return body;
  });
}
