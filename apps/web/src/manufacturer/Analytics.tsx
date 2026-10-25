import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BarChart3 } from 'lucide-react';
import { useT } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Segmented } from '../design/components/Segmented.tsx';
import { Skeleton } from '../design/components/Skeleton.tsx';
import { Table, type Column } from '../design/components/Table.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { HBarList, PageHead, Panel, StatGrid, StatTile } from '../staff/index.ts';
import { useAnalytics, type Analytics as Data } from './data.ts';
import { TableSkeletonRows } from './ui.tsx';

type Row = Data['resellers'][number];
const RANGES = ['7', '30', '90', '365'] as const;
type Range = (typeof RANGES)[number];
const MEASURES = ['requests', 'acceptedRequests', 'configurations', 'customers', 'shareLinkViews'] as const;
type Measure = (typeof MEASURES)[number];

export function Analytics() {
  const { t } = useT();
  const fmt = useFormat();
  useDocumentTitle(t('manufacturer.analytics'));
  const [params, setParams] = useSearchParams();
  const range: Range = (RANGES as readonly string[]).includes(params.get('days') ?? '') ? (params.get('days') as Range) : '30';
  const [measure, setMeasure] = useState<Measure>('requests');
  const q = useAnalytics(Number(range));
  const rows = q.data?.resellers ?? [];

  const label: Record<Measure, string> = {
    requests: t('manufacturer.requests'),
    acceptedRequests: t('manufacturer.accepted'),
    configurations: t('manufacturer.configurations'),
    customers: t('manufacturer.newCustomers'),
    shareLinkViews: t('manufacturer.views'),
  };
  const total = (m: Measure) => rows.reduce((a, r) => a + r[m], 0);
  const rate = total('requests') ? total('acceptedRequests') / total('requests') : 0;

  const cols: Column<Row>[] = [
    { key: 'name', header: t('staff.name'), cell: r => <Link to={`/resellers/${r.resellerId}`} className="staff-strong">{r.name}</Link>, sortValue: r => r.name },
    ...MEASURES.map(
      (m): Column<Row> => ({ key: m, header: label[m], cell: r => <span className="mono">{fmt.number(r[m])}</span>, sortValue: r => r[m], align: 'end', hideOnMobile: m === 'shareLinkViews' || m === 'customers' }),
    ),
  ];

  return (
    <>
      <PageHead
        title={t('manufacturer.analytics')}
        lede={t('manufacturer.analyticsLede')}
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
      {q.error ? (
        <ErrorPage error={q.error} />
      ) : (
        <div className="staff-grid" aria-busy={q.isFetching || undefined}>
          <Panel title={t('staff.lastDays', { count: Number(range) })}>
            {q.isPending ? (
              <Skeleton height="6rem" />
            ) : (
              <StatGrid>
                <StatTile label={t('manufacturer.requests')} value={total('requests')} format={n => fmt.number(Math.round(n))} />
                <StatTile label={t('manufacturer.accepted')} value={total('acceptedRequests')} format={n => fmt.number(Math.round(n))} hint={t('manufacturer.acceptRate', { rate: fmt.number(rate, { style: 'percent', maximumFractionDigits: 0 }) })} />
                <StatTile label={t('manufacturer.configurations')} value={total('configurations')} format={n => fmt.number(Math.round(n))} />
                <StatTile label={t('manufacturer.newCustomers')} value={total('customers')} format={n => fmt.number(Math.round(n))} />
                <StatTile label={t('manufacturer.views')} value={total('shareLinkViews')} format={n => fmt.number(Math.round(n))} />
              </StatGrid>
            )}
          </Panel>
          <Panel
            title={t('manufacturer.perReseller')}
            action={<Segmented label={t('manufacturer.measure')} hideLabel size="sm" value={measure} options={MEASURES.map(m => ({ value: m, label: label[m] }))} onChange={setMeasure} />}
          >
            {q.isPending ? (
              <Skeleton lines={4} height="1.6rem" />
            ) : rows.length === 0 || total(measure) === 0 ? (
              <EmptyState icon={BarChart3} title={t('manufacturer.noActivity')} body={t('manufacturer.noActivityBody')} compact />
            ) : (
              <HBarList
                label={`${label[measure]} · ${t('manufacturer.perReseller')}`}
                format={n => fmt.number(n)}
                items={[...rows].sort((a, b) => b[measure] - a[measure]).map(r => ({ key: r.resellerId, label: r.name, value: r[measure] }))}
              />
            )}
          </Panel>
          <Panel title={t('staff.table')}>
            <Table columns={cols} rows={rows} rowKey={r => r.resellerId} loading={q.isPending} caption={t('manufacturer.perReseller')} initialSort={{ key: 'requests', dir: 'desc' }} empty={<EmptyState icon={BarChart3} title={t('manufacturer.noResellers')} compact />} />
            {q.isPending && <TableSkeletonRows />}
          </Panel>
        </div>
      )}
    </>
  );
}
