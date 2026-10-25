import { Link } from 'react-router';
import { useT } from '../../i18n/i18n.ts';

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  const { t } = useT();
  return (
    <nav aria-label={t('detail.breadcrumb')} className="crumbs">
      <ol style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', fontFamily: 'var(--font-mono)', fontSize: 'var(--step--2)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: 'flex', gap: '0.5rem' }}>
            {it.to ? (
              <Link to={it.to} style={{ textDecoration: 'none' }}>
                {it.label}
              </Link>
            ) : (
              <span aria-current="page" style={{ color: 'var(--ink)' }}>
                {it.label}
              </span>
            )}
            {i < items.length - 1 && <span aria-hidden="true">/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
