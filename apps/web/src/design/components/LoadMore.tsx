import { useT } from '../../i18n/i18n.ts';
import { Button } from './Button.tsx';

/** Cursor pagination: "Load more" while `hasMore`, then a quiet end note. */
export function LoadMore({ hasMore, loading, onLoad, shown, total }: { hasMore: boolean; loading?: boolean; onLoad: () => void; shown?: number; total?: number }) {
  const { t } = useT();
  return (
    <div className="load-more" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem', paddingBlock: 'var(--space-6)' }}>
      {shown !== undefined && <p className="eyebrow" aria-live="polite">{total !== undefined ? `${shown} / ${total}` : t('account.totalCount', { count: shown })}</p>}
      {hasMore ? (
        <Button variant="ghost" onClick={onLoad} loading={loading}>
          {t('common.loadMore')}
        </Button>
      ) : (
        <p className="muted" style={{ fontSize: 'var(--step--1)' }}>{t('common.noMore')}</p>
      )}
    </div>
  );
}
