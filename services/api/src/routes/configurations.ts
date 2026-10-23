import type { Hono } from 'hono';
import { routes } from '@saunaklar/shared';
import type { AppEnv } from '../context.ts';
import { decodeCursor, pageOf } from '../lib/cursor.ts';
import { tenantTx } from '../lib/db.ts';
import { requestLocale } from '../lib/locale.ts';
import { ApiError } from '../lib/problem.ts';
import { asCustomer, mount } from '../lib/route.ts';
import {
  cloneConfiguration, createConfiguration, getConfigRow, getSelections, listConfigurationSummaries, livePrice, replacePlacement, replaceSelections,
  toBreakdownDto, toConfigurationDto,
} from '../domain/configurations.ts';
import { loadModel } from '../domain/catalog.ts';
import { buildRequestDto, customerTransition, listRequestSummaries, submitRequest } from '../domain/requests.ts';
import { resolveShareToken } from '../domain/sharing.ts';

/** Drops the internal sort key the domain lists carry for cursors. */
const strip = <T extends { _at: string }>({ _at, ...rest }: T) => rest;

/** Customer-owned configurations and requests (design 9.1, 9.4). Every query runs under RLS for the tenant. */
export function registerConfigurations(app: Hono<AppEnv>): void {
  mount(app, routes.configurations, async ({ c, query, principal, tenant }) => {
    const me = asCustomer(principal);
    const { config } = c.get('deps');
    const rows = await tenantTx(c, db =>
      listConfigurationSummaries(db, tenant!, requestLocale(c), { customerId: me.customerId }, decodeCursor(config.APP_SECRET, query.cursor), query.limit));
    const p = pageOf(rows, query.limit, config.APP_SECRET, r => ({ at: r._at, id: r.id }));
    return { items: p.items.map(strip), nextCursor: p.nextCursor };
  });

  mount(app, routes.createConfiguration, async ({ c, body, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    return tenantTx(c, async db => {
      const row = await createConfiguration(db, tenant!, locale, { ...body, customerId: me.customerId, staffId: null });
      return toConfigurationDto(db, tenant!, locale, row);
    });
  });

  mount(app, routes.configuration, async ({ c, params, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, async db => toConfigurationDto(db, tenant!, locale, await getConfigRow(db, params.id!, { customerId: me.customerId })));
  });

  mount(app, routes.renameConfiguration, async ({ c, params, body, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      if (row.locked_at) throw new ApiError('CONFIGURATION_LOCKED', 'This configuration is locked. Clone it to make changes.');
      const { rows } = await db.query('update configurations set name = $2, updated_at = now() where id = $1 returning *', [row.id, body.name]);
      return toConfigurationDto(db, tenant!, locale, rows[0]);
    });
  });

  mount(app, routes.deleteConfiguration, async ({ c, params, principal }) => {
    const me = asCustomer(principal);
    await tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      // A locked configuration backs a request or a share link and is kept as the record of what was priced.
      if (row.locked_at) throw new ApiError('CONFIGURATION_LOCKED', 'A locked configuration cannot be deleted.');
      await db.query('delete from configuration_room_placements where configuration_id = $1', [row.id]);
      await db.query('delete from configuration_selections where configuration_id = $1', [row.id]);
      await db.query('delete from configurations where id = $1', [row.id]);
    });
    return { ok: true as const };
  });

  mount(app, routes.putSelections, async ({ c, params, body, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      await replaceSelections(db, tenant!, locale, row, body.optionIds);
      return toConfigurationDto(db, tenant!, locale, await getConfigRow(db, row.id, { customerId: me.customerId }));
    });
  });

  mount(app, routes.putPlacement, async ({ c, params, body, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      await replacePlacement(db, tenant!, row, body);
      await db.query('update configurations set updated_at = now() where id = $1', [row.id]);
      return toConfigurationDto(db, tenant!, locale, await getConfigRow(db, row.id, { customerId: me.customerId }));
    });
  });

  mount(app, routes.price, async ({ c, params, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      if (row.locked_at) return (await toConfigurationDto(db, tenant!, locale, row)).price;
      const model = await loadModel(db, tenant!, locale, { id: row.sauna_model_id }, true);
      if (!model) throw new ApiError('SAUNA_NOT_OFFERED');
      return toBreakdownDto(livePrice(model, await getSelections(db, row.id)), tenant!.currency);
    });
  });

  mount(app, routes.clone, async ({ c, params, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    return tenantTx(c, async db => {
      const source = await getConfigRow(db, params.id!, { customerId: me.customerId });
      const row = await cloneConfiguration(db, tenant!, locale, source, { customerId: me.customerId, staffId: null });
      return toConfigurationDto(db, tenant!, locale, row);
    });
  });

  mount(app, routes.submitRequest, async ({ c, params, body, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    const { config } = c.get('deps');
    return tenantTx(c, async db => {
      const row = await getConfigRow(db, params.id!, { customerId: me.customerId });
      const id = await submitRequest(db, tenant!, locale, row, me.customerId, body.message, config.SHARE_PRICE_VALID_DAYS);
      return buildRequestDto(db, tenant!, locale, id, me.customerId);
    });
  });

  // Review C5: a share link is read-only; claiming copies it into the customer's own drafts.
  mount(app, routes.claimShared, async ({ c, params, principal, tenant }) => {
    const me = asCustomer(principal);
    const locale = requestLocale(c);
    const now = c.get('deps').now();
    return tenantTx(c, async db => {
      const link = await resolveShareToken(db, params.token!, now);
      const source = await getConfigRow(db, link.configuration_id, { staff: true });
      const row = await cloneConfiguration(db, tenant!, locale, source, { customerId: me.customerId, staffId: null });
      return { configurationId: row.id };
    });
  });

  mount(app, routes.myRequests, async ({ c, query, principal, tenant }) => {
    const me = asCustomer(principal);
    const { config } = c.get('deps');
    const rows = await tenantTx(c, db =>
      listRequestSummaries(db, tenant!, requestLocale(c), { customerId: me.customerId }, decodeCursor(config.APP_SECRET, query.cursor), query.limit));
    const p = pageOf(rows, query.limit, config.APP_SECRET, r => ({ at: r._at, id: r.id }));
    return { items: p.items.map(({ _at, customerName: _n, customerEmail: _e, ...r }) => r), nextCursor: p.nextCursor };
  });

  mount(app, routes.myRequest, async ({ c, params, principal, tenant }) => {
    const me = asCustomer(principal);
    c.header('Cache-Control', 'no-store');
    return tenantTx(c, db => buildRequestDto(db, tenant!, requestLocale(c), params.id!, me.customerId));
  });

  for (const [def, to] of [[routes.cancelRequest, 'CANCELLED'], [routes.acceptRequest, 'ACCEPTED']] as const) {
    mount(app, def, async ({ c, params, principal, tenant }) => {
      const me = asCustomer(principal);
      const now = c.get('deps').now();
      return tenantTx(c, async db => {
        await customerTransition(db, params.id!, me.customerId, to, now);
        return buildRequestDto(db, tenant!, requestLocale(c), params.id!, me.customerId);
      });
    });
  }
}
