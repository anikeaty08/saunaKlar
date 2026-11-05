import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, CircleCheck, Store } from 'lucide-react';
import { api } from '../api/client.ts';
import { useT, type TKey } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Segmented } from '../design/components/Segmented.tsx';
import { Skeleton } from '../design/components/Skeleton.tsx';
import { Table, type Column } from '../design/components/Table.tsx';
import { Badge, StatusBadge } from '../design/components/Badge.tsx';
import { ButtonLink } from '../design/components/Button.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { PageHead, Panel, StatGrid, StatTile } from '../staff/index.ts';
import { useAnalytics, useResellers, type ResellerSummary } from './data.ts';
import { attentionItems, healthRows, statusCounts, type HealthRow } from './overview.ts';
import { TableSkeletonRows } from './ui.tsx';

const RANGES = ['7', '30', '90', '365'] as const;
type Range = (typeof RANGES)[number];

/**
 * Landing of the manufacturer admin: what needs attention, reseller health and the latest
 * audit entries. Reseller-level aggregates only; customer data stays with the resellers.
 */
export function Overview() {
  const { t } = useT();
  const fmt = useFormat();
  useDocumentTitle(t('manufacturer.overview'));
  const [params, setParams] = useSearchParams();
  const range: Range = (RANGES as readonly string[]).includes(params.get('days') ?? '') ? (params.get('days') as Range) : '30';
  const resellers = useResellers();
  const analytics = useAnalytics(Number(range));
  const audit = useQuery({ queryKey: ['m', 'audit', 'recent'], queryFn: ({ signal }) => api('mAudit', { query: { limit: 6 }, signal }), staleTime: 30_000 });

  const list = resellers.data?.items ?? [];
  const rows = healthRows(list, analytics.data?.resellers ?? []);
  const attention = attentionItems(list);
  const counts = statusCounts(list);
  const names = new Map(list.map(r => [r.id, r.name]));
  const sum = (k: 'requests' | 'acceptedRequests') => rows.reduce((n, r) => n + r[k], 0);
  const rate = sum('requests') ? sum('acceptedRequests') / sum('requests') : 0;
  const n = (v: number) => fmt.number(Math.round(v));

  const cols: Column<HealthRow<ResellerSummary>>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: r => (
        <>
          <Link to={`/resellers/${r.id}`} className="staff-strong">
            {r.name}
          </Link>
          <span className="staff-sub mono">{r.slug}</span>
        </>
      ),
      sortValue: r => r.name,
    },
    { key: 'status', header: t('staff.status'), cell: r => <StatusBadge status={r.status} />, sortValue: r => r.status, hideOnMobile: true },
    {
      key: 'saunas',
      header: t('manufacturer.saunasAssigned'),
      align: 'end',
      cell: r => (
        <span className="mono" title={t('manufacturer.saunasVisibleOf', { visible: r.saunasVisible, assigned: r.saunasAssigned })}>
          {fmt.number(r.saunasVisible)}/{fmt.number(r.saunasAssigned)}
        </span>
      ),
      sortValue: r => r.saunasAssigned,
    },
    { key: 'open', header: t('manufacturer.openRequests'), align: 'end', cell: r => <span className="mono">{fmt.number(r.openRequests)}</span>, sortValue: r => r.openRequests, hideOnMobile: true },
    { key: 'requests', header: t('manufacturer.requests'), align: 'end', cell: r => <span className="mono">{fmt.number(r.requests)}</span>, sortValue: r => r.requests },
    { key: 'accepted', header: t('manufacturer.accepted'), align: 'end', cell: r => <span className="mono">{fmt.number(r.acceptedRequests)}</span>, sortValue: r => r.acceptedRequests },
  ];

  return (
    <>
      <PageHead
        title={t('manufacturer.overview')}
        lede={t('manufacturer.overviewLede')}
        actions={
          <Segmented
            label={t('staff.range')}
            hideLabel
            size="sm"
            value={range}
            options={RANGES.map(d => ({ value: d, label: t('staff.days', { count: Number(d) }) }))}
            onChange={d => setParams(p => (p.set('days', d), p), { replace: true })}
          />
        }
      />
      {resellers.error ? (
        <ErrorPage error={resellers.error} onRetry={() => void resellers.refetch()} />
      ) : (
        <div className="staff-grid">
          <Panel title={t('manufacturer.attention')}>
            {resellers.isPending ? (
              <Skeleton lines={2} />
            ) : attention.length === 0 ? (
              <p className="mfr-calm">
                <Icon icon={CircleCheck} size="sm" />
                {t('manufacturer.attentionNone')}
              </p>
            ) : (
              <ul className="mfr-attention">
                {attention.map(a => (
                  <li key={`${a.id}-${a.reason}`}>
                    <Link to={`/resellers/${a.id}`} className="mfr-attention__row">
                      <span className="staff-strong">{a.name}</span>
                      <Badge tone={a.reason === 'NO_SAUNAS' ? 'solid' : 'outline'}>{t(`manufacturer.attentionReason.${a.reason}` as TKey)}</Badge>
                      <Icon icon={ArrowRight} size="sm" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('staff.lastDays', { count: Number(range) })}>
            {resellers.isPending || analytics.isPending ? (
              <Skeleton height="6rem" />
            ) : (
              <StatGrid>
                <StatTile label={t('manufacturer.activeResellers')} value={counts.active} format={n} hint={counts.suspended ? t('manufacturer.suspendedCount', { count: counts.suspended }) : undefined} />
                <StatTile label={t('manufacturer.requests')} value={sum('requests')} format={n} />
                <StatTile label={t('manufacturer.accepted')} value={sum('acceptedRequests')} format={n} hint={t('manufacturer.acceptRate', { rate: fmt.number(rate, { style: 'percent', maximumFractionDigits: 0 }) })} />
              </StatGrid>
            )}
          </Panel>

          <div className="staff-grid staff-grid--main-side">
            <Panel
              title={t('manufacturer.health')}
              action={
                <ButtonLink to="/resellers" variant="link" iconAfter={ArrowRight}>
                  {t('manufacturer.resellers')}
                </ButtonLink>
              }
            >
              {analytics.error ? (
                <ErrorPage error={analytics.error} onRetry={() => void analytics.refetch()} />
              ) : (
                <>
                  <Table
                    columns={cols}
                    rows={rows}
                    rowKey={r => r.id}
                    loading={resellers.isPending}
                    caption={t('manufacturer.health')}
                    initialSort={{ key: 'requests', dir: 'desc' }}
                    empty={<EmptyState icon={Store} title={t('manufacturer.noResellers')} body={t('manufacturer.noResellersBody')} compact />}
                  />
                  {resellers.isPending && <TableSkeletonRows />}
                </>
              )}
            </Panel>
            <Panel
              title={t('manufacturer.recentAudit')}
              action={
                <ButtonLink to="/audit" variant="link" iconAfter={ArrowRight}>
                  {t('manufacturer.audit')}
                </ButtonLink>
              }
            >
              {audit.isPending ? (
                <Skeleton lines={4} />
              ) : audit.error ? (
                <p className="staff-muted">{t('errors.title')}</p>
              ) : audit.data.items.length === 0 ? (
                <p className="staff-muted">{t('manufacturer.noEvents')}</p>
              ) : (
                <ul className="timeline">
                  {audit.data.items.map(e => (
                    <li key={e.id} className="timeline__item">
                      <span>
                        <Badge tone="outline">{e.action}</Badge> <span className="mono">{e.entityType}</span>
                      </span>
                      <span className="timeline__meta">
                        <time dateTime={e.occurredAt} title={fmt.dateTime(e.occurredAt)}>
                          {fmt.relative(e.occurredAt)}
                        </time>
                        {' · '}
                        {e.resellerId ? <Link to={`/resellers/${e.resellerId}`}>{names.get(e.resellerId) ?? t('manufacturer.resellers')}</Link> : (e.actorName ?? t('manufacturer.system'))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
