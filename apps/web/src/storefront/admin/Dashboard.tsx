import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { REQUEST_STATUSES } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { StatusBadge } from '../../design/components/Badge.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { BarChart, HBarList, StatGrid, StatTile } from '../../staff/charts.tsx';

const RANGES = ['7', '30', '90'] as const;

export function Dashboard() {
  const { t } = useT();
  const fmt = useFormat();
  useDocumentTitle(t('admin.nav.dashboard'));
  const [days, setDays] = useState<(typeof RANGES)[number]>('30');
  const q = useQuery({ queryKey: ['admin', 'analytics', days], queryFn: () => api('adminAnalytics', { query: { days: Number(days) } }), placeholderData: prev => prev });
  const open = useQuery({ queryKey: ['admin', 'requests', { status: 'SUBMITTED', limit: 5 }], queryFn: () => api('adminRequests', { query: { status: 'SUBMITTED', limit: 5 } }) });

  const tick = (d: { label: string }) => fmt.date(d.label, 'short').replace(/\.?\d{2,4}$/, '').replace(/[./-]$/, '');
  return (
    <>
      <PageHead
        title={t('admin.nav.dashboard')}
        lede={t('admin.dashboard.lede')}
        actions={<Segmented label={t('staff.range')} hideLabel size="sm" value={days} onChange={setDays} options={RANGES.map(r => ({ value: r, label: t('staff.lastDays', { count: Number(r) }) }))} />}
      />
      {q.isPending ? (
        <div aria-hidden="true" className="staff-grid">
          <Skeleton height="7rem" />
          <Skeleton height="14rem" />
        </div>
      ) : q.error ? (
        <ErrorPage error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="staff-grid" style={{ opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity 200ms' }}>
          <StatGrid>
            <StatTile label={t('admin.dashboard.requests')} value={q.data.totals.requests} />
            <StatTile label={t('admin.dashboard.accepted')} value={q.data.totals.acceptedRequests} />
            <StatTile label={t('admin.dashboard.configurations')} value={q.data.totals.configurations} />
            <StatTile label={t('admin.dashboard.customers')} value={q.data.totals.customers} />
            <StatTile label={t('admin.dashboard.views')} value={q.data.totals.shareLinkViews} />
          </StatGrid>
          <div className="staff-grid staff-grid--2">
            <BarChart label={t('admin.dashboard.daily')} data={q.data.daily.map(d => ({ label: d.date, value: d.requests }))} tickLabel={tick} emptyText={t('admin.dashboard.empty')} />
            <BarChart label={t('admin.dashboard.dailyConfigurations')} data={q.data.daily.map(d => ({ label: d.date, value: d.configurations }))} tickLabel={tick} emptyText={t('admin.dashboard.empty')} />
          </div>
          <div className="staff-grid staff-grid--2">
            <Panel title={t('admin.dashboard.byStatus')}>
              <HBarList
                label={t('admin.dashboard.byStatus')}
                items={REQUEST_STATUSES.map(s => ({ key: s, label: t(`status.${s}` as TKey), value: q.data.requestsByStatus[s] ?? 0 }))}
              />
            </Panel>
            <Panel title={t('admin.dashboard.topSaunas')}>
              {q.data.topSaunas.length === 0 ? (
                <p className="staff-muted">{t('admin.dashboard.empty')}</p>
              ) : (
                <HBarList label={t('admin.dashboard.topSaunas')} items={q.data.topSaunas.map(s => ({ key: s.saunaModelId, label: s.name, value: s.configurations }))} />
              )}
            </Panel>
          </div>
          <Panel
            title={t('admin.dashboard.openRequests')}
            action={
              <ButtonLink to="/admin/requests?status=SUBMITTED" variant="link" iconAfter={ArrowRight}>
                {t('admin.nav.requests')}
              </ButtonLink>
            }
          >
            {open.isPending ? (
              <Skeleton lines={3} />
            ) : (open.data?.items.length ?? 0) === 0 ? (
              <p className="staff-muted">{t('admin.requests.empty')}</p>
            ) : (
              <ul className="attention">
                {open.data!.items.map(r => (
                  <li key={r.id}>
                    <Link to={`/admin/requests/${r.id}`} className="attention__row">
                      <span>
                        <span className="staff-strong">{r.customerName}</span>
                        <span className="staff-sub">{r.saunaName}</span>
                      </span>
                      <StatusBadge status={r.status} />
                      <span className="mono staff-muted">{fmt.relative(r.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </>
  );
}
