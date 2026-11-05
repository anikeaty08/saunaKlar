import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ArrowRight, CircleCheck } from 'lucide-react';
import { REQUEST_STATUSES, type RequestStatus } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Badge, StatusBadge } from '../../design/components/Badge.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { BarChart, HBarList, StatGrid, StatTile } from '../../staff/charts.tsx';
import { buildInbox, openCount } from './inbox.ts';

const RANGES = ['7', '30', '90'] as const;
const INBOX_SIZE = 8;

const requestsQuery = (status: RequestStatus, limit: number) => ({
  queryKey: ['admin', 'requests', { status, limit }],
  queryFn: () => api('adminRequests', { query: { status, limit } }),
});

/** Landing of the reseller admin: what needs doing first, then a few numbers. */
export function Dashboard() {
  const { t } = useT();
  useDocumentTitle(t('admin.nav.dashboard'));
  return (
    <>
      <PageHead title={t('admin.nav.dashboard')} lede={t('admin.dashboard.lede')} />
      <div className="staff-grid">
        <Inbox />
        <Numbers />
      </div>
    </>
  );
}

function Inbox() {
  const { t } = useT();
  const fmt = useFormat();
  const submitted = useQuery(requestsQuery('SUBMITTED', 25));
  const review = useQuery(requestsQuery('IN_REVIEW', 25));
  const quoted = useQuery(requestsQuery('QUOTED', 50));
  const all = [submitted, review, quoted];
  const failed = all.find(q => q.error);
  const items = buildInbox([...(quoted.data?.items ?? []), ...(submitted.data?.items ?? []), ...(review.data?.items ?? [])], new Date());

  return (
    <Panel
      title={t('admin.dashboard.openRequests')}
      action={
        <ButtonLink to="/admin/requests" variant="link" iconAfter={ArrowRight}>
          {t('admin.dashboard.seeAll')}
        </ButtonLink>
      }
    >
      {all.some(q => q.isPending) ? (
        <Skeleton lines={4} />
      ) : failed?.error ? (
        <ErrorPage error={failed.error} onRetry={() => all.forEach(q => void q.refetch())} />
      ) : items.length === 0 ? (
        <p className="inbox-empty">
          <Icon icon={CircleCheck} size="sm" />
          {t('admin.dashboard.inboxEmpty')}
        </p>
      ) : (
        <ul className="attention inbox">
          {items.slice(0, INBOX_SIZE).map(r => {
            const quote = r.reason === 'QUOTE_EXPIRING' || r.reason === 'QUOTE_EXPIRED';
            return (
              <li key={r.id}>
                <Link to={`/admin/requests/${r.id}`} className="attention__row">
                  <span>
                    <span className="staff-strong">{r.customerName}</span>
                    <span className="staff-sub">
                      {r.saunaName} · <span className="mono">{fmt.money(r.finalPriceMinor, r.currency)}</span>
                    </span>
                  </span>
                  <Badge tone={r.reason === 'QUOTE_EXPIRED' || r.reason === 'NEW' ? 'solid' : 'outline'} dot={quote}>
                    {t(`admin.dashboard.reason.${r.reason}` as TKey, { when: quote ? fmt.relative(r.quoteValidUntil!) : '' })}
                  </Badge>
                  <span className="mono staff-muted">{fmt.relative(r.createdAt)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {items.length > INBOX_SIZE && <p className="staff-sub inbox-more">{t('admin.dashboard.more', { count: items.length - INBOX_SIZE })}</p>}
    </Panel>
  );
}

function Numbers() {
  const { t } = useT();
  const fmt = useFormat();
  const [days, setDays] = useState<(typeof RANGES)[number]>('30');
  const q = useQuery({ queryKey: ['admin', 'analytics', days], queryFn: () => api('adminAnalytics', { query: { days: Number(days) } }), placeholderData: prev => prev });
  const tick = (d: { label: string }) => fmt.date(d.label, 'short').replace(/\.?\d{2,4}$/, '').replace(/[./-]$/, '');
  return (
    <section className="staff-grid" aria-labelledby="dash-numbers">
      <div className="dash-numbers__head">
        <h2 id="dash-numbers" className="staff-panel__title">
          {t('admin.dashboard.numbers')}
        </h2>
        <Segmented label={t('staff.range')} hideLabel size="sm" value={days} onChange={setDays} options={RANGES.map(r => ({ value: r, label: t('staff.lastDays', { count: Number(r) }) }))} />
      </div>
      {q.isPending ? (
        <div aria-hidden="true" className="staff-grid">
          <Skeleton height="7rem" />
          <Skeleton height="12rem" />
        </div>
      ) : q.error ? (
        <ErrorPage error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="staff-grid" style={{ opacity: q.isPlaceholderData ? 0.6 : 1, transition: 'opacity 200ms' }}>
          <StatGrid>
            <StatTile label={t('admin.dashboard.open')} value={openCount(q.data.requestsByStatus)} hint={t('admin.dashboard.ofRequests', { count: q.data.totals.requests })} />
            <StatTile label={t('admin.dashboard.accepted')} value={q.data.totals.acceptedRequests} />
            <StatTile label={t('admin.dashboard.customers')} value={q.data.totals.customers} />
          </StatGrid>
          <div className="staff-grid staff-grid--2">
            <Panel title={t('admin.dashboard.byStatus')}>
              <HBarList label={t('admin.dashboard.byStatus')} items={REQUEST_STATUSES.map(s => ({ key: s, label: t(`status.${s}` as TKey), value: q.data.requestsByStatus[s] ?? 0 }))} />
            </Panel>
            <BarChart label={t('admin.dashboard.daily')} data={q.data.daily.map(d => ({ label: d.date, value: d.requests }))} tickLabel={tick} emptyText={t('admin.dashboard.empty')} />
          </div>
        </div>
      )}
    </section>
  );
}
