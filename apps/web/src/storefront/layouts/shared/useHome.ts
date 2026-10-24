import { useCatalog, useTenantData } from '../../../api/queries.ts';
import { useT } from '../../../i18n/i18n.ts';
import { specsOf } from '../../components/specs.ts';

/** What every layout's home page needs: copy variables, the catalogue and a few derived numbers. */
export function useHome() {
  const i18n = useT();
  const tenant = useTenantData();
  const catalog = useCatalog();
  const name = tenant.branding.displayName;
  const vars = { name, manufacturer: tenant.manufacturer.name };
  const items = catalog.data?.items ?? [];
  const currency = catalog.data?.currency ?? tenant.currency;
  const maxSeats = items.reduce((mx, i) => Math.max(mx, specsOf(i).persons), 0) || 8;
  const hero = items.find(i => i.assets.thumbnailUrl) ?? items[0];
  return { ...i18n, tenant, name, vars, items, currency, pending: catalog.isPending, maxSeats, hero };
}

/** When the first-load splash is still up, entrances wait for its curtain. */
export const splashDelay = () => (document.getElementById('splash') ? 0.9 : 0);
