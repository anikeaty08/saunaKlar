import { useLocation } from 'react-router';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';

const SECTIONS = ['dashboard', 'requests', 'configurations', 'saunas', 'customers', 'branding', 'settings'] as const;

/**
 * Reseller admin (`/admin/*` on the storefront host). Placeholder: the admin
 * panel work replaces this module with the real screens (own chunk).
 */
export default function AdminApp() {
  const { t } = useT();
  const { pathname } = useLocation();
  useDocumentTitle(t('admin.title'));
  const current = pathname.split('/')[2] ?? 'dashboard';
  return (
    <div className="page container">
      <ScrambleText as="p" className="eyebrow" text={t('admin.title')} />
      <ScrambleText as="h1" className="page-title page-title--md" text={t(`admin.nav.${(SECTIONS as readonly string[]).includes(current) ? current : 'dashboard'}` as TKey)} />
      <nav className="cluster" style={{ ['--cluster' as string]: '1.5rem', margin: 'var(--space-6) 0', fontSize: 'var(--step--1)' }} aria-label={t('admin.title')}>
        {SECTIONS.map(s => (
          <TextLink key={s} to={s === 'dashboard' ? '/admin' : `/admin/${s}`} warm={false}>
            {t(`admin.nav.${s}` as TKey)}
          </TextLink>
        ))}
      </nav>
      <EmptyState title={t('admin.placeholder')} />
    </div>
  );
}
