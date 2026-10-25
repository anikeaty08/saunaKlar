import { useNavigate, Link } from 'react-router';
import { Boxes } from 'lucide-react';
import { useT, type TKey } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { errorText } from '../i18n/errorText.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Table, type Column } from '../design/components/Table.tsx';
import { Badge } from '../design/components/Badge.tsx';
import { Button } from '../design/components/Button.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { LazyImage } from '../design/components/LazyImage.tsx';
import { PageHead } from '../staff/index.ts';
import { CURRENCIES, useSaunas, type SaunaSummary } from './data.ts';
import { MODEL_TONE, TableSkeletonRows } from './ui.tsx';


export function Saunas() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('manufacturer.saunas'));
  const q = useSaunas();

  const cols: Column<SaunaSummary>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: s => (
        <span className="mfr-model">
          <span className="mfr-model__thumb" aria-hidden="true">
            {s.thumbnailUrl && <LazyImage src={s.thumbnailUrl} alt="" width={96} height={96} sizes="48px" />}
          </span>
          <span>
            <Link to={`/saunas/${s.id}`} className="staff-strong" onClick={e => e.stopPropagation()}>
              {s.name}
            </Link>
            <span className="staff-sub mono">{s.sku}</span>
          </span>
        </span>
      ),
      sortValue: s => s.name,
    },
    { key: 'status', header: t('staff.status'), cell: s => <Badge tone={MODEL_TONE[s.status]}>{t(`manufacturer.modelStatus.${s.status}` as TKey)}</Badge>, sortValue: s => s.status },
    ...CURRENCIES.map(
      (c): Column<SaunaSummary> => ({
        key: `price-${c}`,
        header: c,
        label: `${t('manufacturer.listPrice')} ${c}`,
        align: 'end',
        hideOnMobile: c !== 'EUR',
        sortValue: s => s.prices.find(p => p.currency === c)?.listPriceMinor ?? -1,
        cell: s => {
          const p = s.prices.find(x => x.currency === c);
          return p ? (
            <span className="mono">
              {fmt.money(p.listPriceMinor, c)}
              <span className="staff-sub">−{fmt.percentBps(p.maxDiscountBps)}</span>
            </span>
          ) : (
            <span className="staff-muted">{t('manufacturer.noPrice')}</span>
          );
        },
      }),
    ),
    { key: 'resellers', header: t('manufacturer.resellers'), cell: s => <span className="mono">{fmt.number(s.resellersAssigned)}</span>, sortValue: s => s.resellersAssigned, align: 'end', hideOnMobile: true },
  ];

  return (
    <>
      <PageHead title={t('manufacturer.saunas')} lede={t('manufacturer.saunasLede')} />
      <Table
        columns={cols}
        rows={q.data?.items ?? []}
        rowKey={s => s.id}
        loading={q.isPending}
        caption={t('manufacturer.saunas')}
        onRowClick={s => navigate(`/saunas/${s.id}`)}
        empty={
          q.error ? (
            <EmptyState icon={Boxes} title={errorText(t, q.error)} action={<Button variant="ghost" onClick={() => void q.refetch()}>{t('common.retry')}</Button>} compact />
          ) : (
            <EmptyState icon={Boxes} title={t('manufacturer.noSaunas')} body={t('manufacturer.noSaunasBody')} compact />
          )
        }
      />
      {q.isPending && <TableSkeletonRows rows={6} />}
    </>
  );
}
