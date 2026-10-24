import { lazy, Suspense, type ComponentType, type LazyExoticComponent } from 'react';
import { useSession, useTenantData } from '../../api/queries.ts';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { LAYOUT_LOADERS, resolveLayout, type LayoutId } from '../layouts/registry.ts';

const homes = new Map<LayoutId, LazyExoticComponent<ComponentType>>();
const homeOf = (id: LayoutId) => {
  let c = homes.get(id);
  if (!c) {
    c = lazy(() => LAYOUT_LOADERS[id]().then(m => ({ default: m.Home })));
    homes.set(id, c);
  }
  return c;
};

/** The home page belongs to the reseller's chosen layout; each layout is its own chunk. */
export default function Home() {
  const tenant = useTenantData();
  const session = useSession().data;
  useDocumentTitle(null);
  const LayoutHome = homeOf(resolveLayout(tenant, session));
  return (
    <Suspense fallback={<div className="layout-pending" style={{ minHeight: '100svh' }} />}>
      <LayoutHome />
    </Suspense>
  );
}
