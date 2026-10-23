import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useT } from '../i18n/i18n.ts';
import { applyTheme } from '../design/theme.ts';
import { TextNavLink } from '../design/components/TextLink.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { Toaster } from '../design/components/Toast.tsx';
import { NavigationProgress } from '../motion/PageTransition.tsx';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { hideSplash } from '../app/splash.ts';
import { LanguageSwitcher } from '../storefront/layout/LanguageSwitcher.tsx';
import '../design/layout.css';

export function ManufacturerLayout() {
  const { t } = useT();
  useEffect(() => {
    applyTheme(null);
    hideSplash();
    document.title = t('manufacturer.title');
  }, [t]);
  return (
    <div className="admin-shell">
      <NavigationProgress />
      <header className="admin-shell__head container">
        <span className="pf__logo" style={{ fontFamily: 'var(--font-display)', fontWeight: 650, letterSpacing: '-0.04em' }}>
          {t('manufacturer.title')}
        </span>
        <nav aria-label={t('nav.primary')}>
          <ul className="cluster" style={{ ['--cluster' as string]: '1.5rem', fontSize: 'var(--step--1)' }}>
            <li><TextNavLink to="/resellers">{t('manufacturer.resellers')}</TextNavLink></li>
            <li><TextNavLink to="/saunas">{t('manufacturer.saunas')}</TextNavLink></li>
            <li><TextNavLink to="/audit">{t('manufacturer.audit')}</TextNavLink></li>
          </ul>
        </nav>
        <LanguageSwitcher compact />
      </header>
      <main id="main" className="container" style={{ paddingBlock: 'var(--space-7)' }}>
        <Outlet />
      </main>
      <Toaster />
    </div>
  );
}

export function Placeholder() {
  const { t } = useT();
  const { pathname } = useLocation();
  return (
    <>
      <ScrambleText as="h1" className="page-title" text={pathname === '/' ? t('manufacturer.title') : pathname.slice(1)} />
      <EmptyState title={t('manufacturer.placeholder')} />
    </>
  );
}
