import { useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { useSession, useTenant } from '../api/queries.ts';
import { isApiError } from '../api/client.ts';
import type { Tenant } from '../api/types.ts';
import { applyTheme } from '../design/theme.ts';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { Toaster } from '../design/components/Toast.tsx';
import { Skeleton } from '../design/components/Skeleton.tsx';
import { NavigationProgress, PageTransition } from '../motion/PageTransition.tsx';
import { ScrollProgress } from '../motion/ScrollProgress.tsx';
import { useT } from '../i18n/i18n.ts';
import { hideSplash } from '../app/splash.ts';
import { UnknownHost } from '../platform/PlatformPage.tsx';
import { Header } from './layout/Header.tsx';
import { Footer } from './layout/Footer.tsx';
import { LocaleFlip } from './layout/LocaleFlip.tsx';
import { LAYOUT_LOADERS, LAYOUT_META, loadLayoutFont, resolveLayout, type LayoutId } from './layouts/registry.ts';
import '../design/layout.css';

function useTenantBranding(tenant: Tenant | undefined, layout: LayoutId | null) {
  useEffect(() => {
    if (!tenant || !layout) return;
    applyTheme(tenant.branding.primaryColor, LAYOUT_META[layout].flavour);
    document.documentElement.dataset.layout = layout;
    loadLayoutFont(layout);
    // Start the layout chunk (its CSS restyles header and cards on every page).
    void LAYOUT_LOADERS[layout]();
    if (tenant.branding.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = tenant.branding.faviconUrl;
    }
  }, [tenant, layout]);
}

/** Header and footer outlines while the tenant loads (normally hidden by the splash). */
export function ShellSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="container" style={{ height: 'var(--header-h)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Skeleton width="9rem" height="1.25rem" />
        <Skeleton width="16rem" height="0.9rem" />
      </div>
      <div className="container" style={{ paddingBlock: 'var(--space-9)' }}>
        <Skeleton width="60%" height="clamp(3rem, 10vw, 9rem)" />
        <Skeleton width="40%" height="clamp(3rem, 10vw, 9rem)" style={{ marginTop: '1rem' }} />
      </div>
    </div>
  );
}

export function StorefrontRoot() {
  const tenant = useTenant();
  const { t } = useT();
  const { pathname } = useLocation();
  const session = useSession().data;
  const layout = tenant.data ? resolveLayout(tenant.data, session) : null;
  useTenantBranding(tenant.data, layout);

  useEffect(() => {
    if (!tenant.isPending) hideSplash();
  }, [tenant.isPending]);

  if (tenant.isPending) return <ShellSkeleton />;
  if (tenant.error) {
    if (isApiError(tenant.error, 'TENANT_NOT_FOUND') || isApiError(tenant.error, 'TENANT_SUSPENDED') || isApiError(tenant.error, 'WRONG_HOST')) {
      return <UnknownHost reason={tenant.error.code === 'TENANT_SUSPENDED' ? 'suspended' : 'unknown-host'} attempted={window.location.hostname} />;
    }
    return <ErrorPage error={tenant.error} onRetry={() => void tenant.refetch()} />;
  }
  const data = tenant.data;
  // The reseller admin brings its own frame (sidebar, toasts, progress bar).
  if (pathname === '/admin' || pathname.startsWith('/admin/'))
    return (
      <>
        <Outlet />
        <ScrollRestoration />
      </>
    );
  const label = pathname.split('/')[1] || data.branding.displayName;

  return (
    <>
      <a href="#main" className="skip-link">
        {t('common.skipToContent')}
      </a>
      <NavigationProgress />
      <Header tenant={data} />
      <LocaleFlip>
        <PageTransition label={label}>
          <main id="main" tabIndex={-1} className="main main--sheet">
            <Outlet />
          </main>
        </PageTransition>
        <Footer tenant={data} />
      </LocaleFlip>
      <ScrollProgress />
      <ScrollRestoration />
      <Toaster />
    </>
  );
}
