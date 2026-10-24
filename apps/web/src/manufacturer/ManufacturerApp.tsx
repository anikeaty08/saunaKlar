import { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router';
import { Activity, Boxes, ScrollText, SearchX, Store } from 'lucide-react';
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
            { to: '/resellers', label: t('manufacturer.resellers'), icon: Store },
            { to: '/saunas', label: t('manufacturer.saunas'), icon: Boxes },
            { to: '/analytics', label: t('manufacturer.analytics'), icon: Activity },
            { to: '/audit', label: t('manufacturer.audit'), icon: ScrollText },
          ]}
        >
          <Outlet />
        </AdminShell>
      )}
    </RequireStaff>
  );
}

/** `/login` once signed in (and `/`): straight to the resellers. */
export function Home() {
  return <Navigate to="/resellers" replace />;
}

export function NotFound() {
  const { t } = useT();
  return <EmptyState icon={SearchX} title={t('notFound.title')} body={t('notFound.body')} action={<ButtonLink to="/resellers">{t('manufacturer.resellers')}</ButtonLink>} />;
}
