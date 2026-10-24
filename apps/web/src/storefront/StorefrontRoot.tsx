import { useEffect } from 'react';
import { Outlet, ScrollRestoration, useLocation } from 'react-router';
import { useTenant } from '../api/queries.ts';
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
import '../design/layout.css';

function useTenantBranding(tenant: Tenant | undefined) {
  useEffect(() => {
    if (!tenant) return;
    applyTheme(tenant.branding.primaryColor);
    if (tenant.branding.faviconUrl) {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
      }
      link.href = tenant.branding.faviconUrl;
    }
  }, [tenant]);
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
  useTenantBranding(tenant.data);

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
