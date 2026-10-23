import { resolve } from 'node:path';
import { Hono, type Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { withTx } from '@saunaklar/db';
import { parseHost } from '@saunaklar/shared';
import type { LocalEdge } from '../adapters/index.ts';
import { assertObjectKey } from '../adapters/storage/keys.ts';
import type { Deps } from '../context.ts';
import { renderMail, renderMailList } from './dev-mail.ts';
import { dirExists, readStatic } from './static.ts';

export interface LocalEdgeOptions {
  /** Hono app (or anything with `fetch`) serving `/api/*`. */
  api: { fetch(request: Request): Response | Promise<Response> };
  edge: LocalEdge;
  /** Built SPA (`apps/web/dist`). */
  webDist: string;
  /** Development routes (`/dev/mail`). Off in production. */
  devTools: boolean;
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Host as the browser sent it, without the port (policies and tenants are port-agnostic). */
const hostOf = (c: Context): string => (c.req.header('host') ?? '').toLowerCase().replace(/:\d+$/, '');

const text = (c: Context, status: 403 | 404 | 400 | 413, message: string) =>
  c.text(message, status, { 'Cache-Control': 'no-store' });

/**
 * The local stand-in for CloudFront and S3 (design 4.2, 10.2, 12): one origin that routes
 * like the production distribution does.
 *   /api/*          the API
 *   /assets/*       protected 3D assets: only with valid signed cookies/URL for this host
 *   /media/*, /branding/*   public objects, immutable
 *   /static/*       the SPA's hashed build output, immutable
 *   /favicon.ico    the tenant's branding favicon
 *   PUT /dev/uploads/<token>  presigned upload emulation (S3 PUT)
 *   /dev/mail       dev mailbox (development only)
 *   everything else the SPA with index.html fallback
 */
export function createLocalEdgeApp(deps: Deps, opts: LocalEdgeOptions): Hono {
  const app = new Hono();
  const store = deps.adapters.objectStore;
  const webDist = resolve(opts.webDist);

  const serveObject = async (c: Context, key: string, cacheControl: string) => {
    try {
      assertObjectKey(key);
    } catch {
      return text(c, 404, 'Not found');
    }
    const [head, body] = await Promise.all([store.head(key), store.get(key)]);
    if (!head || !body) return text(c, 404, 'Not found');
    return c.body(c.req.method === 'HEAD' ? null : new Uint8Array(body), 200, {
      'Content-Type': head.contentType,
      'Content-Length': String(body.byteLength),
      'Cache-Control': head.cacheControl ?? cacheControl,
      'X-Content-Type-Options': 'nosniff',
    });
  };

  app.all('/api/*', c => opts.api.fetch(c.req.raw));

  app.on(['GET', 'HEAD'], '/assets/*', async c => {
    const allowed = opts.edge.verifyAssetRequest({
      host: hostOf(c),
      path: c.req.path,
      cookies: getCookie(c),
      query: new URL(c.req.url).searchParams,
    });
    if (!allowed) return text(c, 403, 'Forbidden');
    // Signed responses are per viewer: never shared by caches.
    return serveObject(c, c.req.path.slice(1), 'private, max-age=600');
  });

  app.on(['GET', 'HEAD'], '/media/*', c => serveObject(c, c.req.path.slice(1), IMMUTABLE));
  app.on(['GET', 'HEAD'], '/branding/*', c => serveObject(c, c.req.path.slice(1), IMMUTABLE));

  app.on(['GET', 'HEAD'], '/favicon.ico', async c => {
    const key = await tenantFaviconKey(deps, hostOf(c));
    if (key) return serveObject(c, key, 'public, max-age=3600');
    const file = await readStatic(webDist, '/favicon.ico');
    return file ? c.body(new Uint8Array(file.body), 200, { 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=3600' }) : text(c, 404, 'Not found');
  });

  app.put('/dev/uploads/:token', async c => {
    const verified = opts.edge.verifyUpload(c.req.param('token'));
    if (!verified) return text(c, 403, 'Invalid or expired upload signature');
    const { grant, store: target } = verified;
    const contentType = (c.req.header('content-type') ?? '').split(';')[0]!.trim();
    if (contentType !== grant.contentType) return text(c, 403, 'Content-Type does not match the signed upload');
    const declared = Number(c.req.header('content-length') ?? grant.byteSize);
    if (declared > MAX_UPLOAD_BYTES || declared !== grant.byteSize) return text(c, 413, 'Size does not match the signed upload');
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength !== grant.byteSize) return text(c, 400, 'Size does not match the signed upload');
    await target.put(grant.key, body, grant.contentType);
    return c.body(null, 200, { ETag: `"${grant.key.length}-${grant.byteSize}"` });
  });

  if (opts.devTools) {
    app.get('/dev/mail', async c => c.html(await renderMailList(deps.pool, c.req.query('to'))));
    app.get('/dev/mail/:id', async c => {
      const html = await renderMail(deps.pool, c.req.param('id'));
      return html ? c.html(html) : text(c, 404, 'Not found');
    });
  }

  app.on(['GET', 'HEAD'], '/static/*', async c => {
    const file = await readStatic(webDist, c.req.path);
    if (!file) return text(c, 404, 'Not found');
    return c.body(c.req.method === 'HEAD' ? null : new Uint8Array(file.body), 200, { 'Content-Type': file.contentType, 'Cache-Control': IMMUTABLE });
  });

  app.on(['GET', 'HEAD'], '*', async c => {
    if (!(await dirExists(webDist))) {
      return text(c, 404, 'The web app is not built. Use the Vite dev server (npm run dev -w @saunaklar/web, http://<slug>.localhost:5173) or run npm run build first.');
    }
    const file = (c.req.path !== '/' && (await readStatic(webDist, c.req.path))) || (await readStatic(webDist, '/index.html'));
    if (!file) return text(c, 404, 'Not found');
    return c.body(c.req.method === 'HEAD' ? null : new Uint8Array(file.body), 200, { 'Content-Type': file.contentType, 'Cache-Control': file.cacheControl });
  });

  app.all('*', c => text(c, 404, 'Not found'));
  return app;
}

/** Storage key of the tenant's favicon, or null (not a storefront, unknown tenant, no favicon). */
async function tenantFaviconKey(deps: Deps, host: string): Promise<string | null> {
  const parsed = parseHost(host, { platformDomain: deps.config.PLATFORM_DOMAIN, adminHost: deps.config.ADMIN_HOST });
  if (parsed.kind !== 'storefront') return null;
  const { rows: [tenant] } = await deps.pool.query<{ id: string }>('SELECT id FROM resolve_tenant($1)', [parsed.slug]);
  if (!tenant) return null;
  return withTx(deps.pool, { role: 'app_tenant', resellerId: tenant.id, readOnly: true }, async db => {
    const { rows } = await db.query<{ storage_key: string }>(
      `SELECT a.storage_key FROM reseller_branding b JOIN assets a ON a.id = b.favicon_asset_id WHERE b.reseller_id = $1`,
      [tenant.id],
    );
    return rows[0]?.storage_key ?? null;
  });
}
