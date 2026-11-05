import { useEffect } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Boxes, LayoutDashboard, ScrollText, SearchX, Store } from 'lucide-react';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ButtonLink } from '../design/components/Button.tsx';
import { useT } from '../i18n/i18n.ts';
import { applyTheme } from '../design/theme.ts';
import { hideSplash } from '../app/splash.ts';
import { AdminShell, RequireStaff } from '../staff/index.ts';
import { Logo } from '../design/brand/Logo.tsx';
import './manufacturer.css';

export function Brand() {
  return <Logo className="staff-shell__logo" size={24} />;
}

/**
 * Manufacturer admin on the admin host. Everything below `/` needs a
 * manufacturer staff session; without one the staff sign-in renders in place,
 * so a deep link survives signing in.
 */
export function ManufacturerLayout() {
  const { t } = useT();
  useEffect(() => {
    applyTheme(null);
    hideSplash();
  }, []);
  return (
    <RequireStaff scope="MANUFACTURER" title={t('manufacturer.loginTitle')} brand={<Brand />}>
      {session => (
        <AdminShell
          brand={<Brand />}
          area={t('manufacturer.title')}
          session={session}
          nav={[
            { to: '/', label: t('manufacturer.overview'), icon: LayoutDashboard, end: true },
            { to: '/resellers', label: t('manufacturer.resellers'), icon: Store },
            { to: '/saunas', label: t('manufacturer.saunas'), icon: Boxes },
            { to: '/audit', label: t('manufacturer.audit'), icon: ScrollText },
          ]}
        >
          <Outlet />
        </AdminShell>
      )}
    </RequireStaff>
  );
}

/** `/login` once signed in: to the overview. */
export function Home() {
  return <Navigate to="/" replace />;
}

/** The old analytics page is part of the overview now; its `?days=` carries over. */
export function AnalyticsRedirect() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/', search }} replace />;
}

export function NotFound() {
  const { t } = useT();
  return <EmptyState icon={SearchX} title={t('notFound.title')} body={t('notFound.body')} action={<ButtonLink to="/resellers">{t('manufacturer.resellers')}</ButtonLink>} />;
}
