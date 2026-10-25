import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { PanelRightOpen, ScrollText } from 'lucide-react';
import { api } from '../api/client.ts';
import { useT } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Select } from '../design/components/Field.tsx';
import { Badge } from '../design/components/Badge.tsx';
import { Button } from '../design/components/Button.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { Drawer } from '../design/components/Dialog.tsx';
import { LoadMore } from '../design/components/LoadMore.tsx';
import { Table, type Column } from '../design/components/Table.tsx';
import { PageHead, useCursorList } from '../staff/index.ts';
import { keys, useResellers, type AuditEvent } from './data.ts';
import { TableSkeletonRows } from './ui.tsx';

/** Entity types the audit triggers write (migration 0008); the filter also accepts any other value from the URL. */
const ENTITY_TYPES = ['resellers', 'reseller_saunas', 'reseller_room_scenes', 'reseller_admins', 'reseller_sauna_discounts', 'reseller_default_discounts', 'sauna_model_prices', 'sauna_model_option_prices', 'configuration_requests'];

export function Audit() {
  const { t } = useT();
  const fmt = useFormat();
  useDocumentTitle(t('manufacturer.audit'));
  const [params, setParams] = useSearchParams();
  const resellerId = params.get('reseller') ?? '';
  const entityType = params.get('entity') ?? '';
  const resellers = useResellers();
  const names = new Map(resellers.data?.items.map(r => [r.id, r.name]));
  const [open, setOpen] = useState<string | null>(null);

  const q = useCursorList(keys.audit(resellerId, entityType), cursor =>
    api('mAudit', { query: { limit: 25, ...(cursor ? { cursor } : {}), ...(resellerId ? { resellerId } : {}), ...(entityType ? { entityType } : {}) } }),
  );
  const setFilter = (k: 'reseller' | 'entity', v: string) =>
    setParams(
      p => {
        if (v) p.set(k, v);
        else p.delete(k);
        return p;
      },
      { replace: true },
    );

  const types = ENTITY_TYPES.includes(entityType) || !entityType ? ENTITY_TYPES : [...ENTITY_TYPES, entityType];
  const cols: Column<AuditEvent>[] = [
    { key: 'when', header: t('manufacturer.when'), cell: e => <time dateTime={e.occurredAt} className="mono" title={fmt.dateTime(e.occurredAt)}>{fmt.dateTime(e.occurredAt)}</time>, width: '12rem' },
    { key: 'action', header: t('manufacturer.action'), cell: e => <Badge tone="outline">{e.action}</Badge> },
    {
      key: 'entity',
      header: t('manufacturer.entity'),
      cell: e => (
        <>
          <span className="mono">{e.entityType}</span>
          {e.resellerId && (
            <Link to={`/resellers/${e.resellerId}`} className="staff-sub" onClick={ev => ev.stopPropagation()}>
              {names.get(e.resellerId) ?? e.resellerId}
            </Link>
          )}
        </>
      ),
    },
    { key: 'actor', header: t('manufacturer.actor'), cell: e => e.actorName ?? <span className="staff-muted">{t('manufacturer.system')}</span>, hideOnMobile: true },
    {
      key: 'details',
      header: t('manufacturer.details'),
      align: 'end',
      cell: e =>
        e.details ? (
          <button type="button" className="mfr-disclose" aria-haspopup="dialog" onClick={() => setOpen(o => (o === e.id ? null : e.id))}>
            {t('manufacturer.showDetails')}
            <Icon icon={PanelRightOpen} size="xs" />
          </button>
        ) : (
          <span className="staff-muted">—</span>
        ),
    },
  ];
  const detail = q.rows.find(e => e.id === open);

  return (
    <>
      <PageHead title={t('manufacturer.audit')} lede={t('manufacturer.auditLede')} />
      <div className="staff-toolbar" role="search">
        <Select
          label={t('manufacturer.resellers')}
          value={resellerId}
          onChange={e => setFilter('reseller', e.target.value)}
          options={[{ value: '', label: t('manufacturer.allResellers') }, ...(resellers.data?.items ?? []).map(r => ({ value: r.id, label: r.name }))]}
        />
        <Select
          label={t('manufacturer.entityType')}
          value={entityType}
          onChange={e => setFilter('entity', e.target.value)}
          options={[{ value: '', label: t('staff.all') }, ...types.map(v => ({ value: v, label: v }))]}
        />
        {(resellerId || entityType) && (
          <Button variant="link" onClick={() => setParams({}, { replace: true })}>
            {t('common.clear')}
          </Button>
        )}
      </div>
      {q.error ? (
        <ErrorPage error={q.error} />
      ) : (
        <>
          <Table
            columns={cols}
            rows={q.rows}
            rowKey={e => e.id}
            loading={q.isPending}
            caption={t('manufacturer.audit')}
            empty={<EmptyState icon={ScrollText} title={t('manufacturer.noEvents')} body={resellerId || entityType ? t('manufacturer.noEventsFiltered') : undefined} compact />}
          />
          {q.isPending && <TableSkeletonRows rows={8} />}
          <Drawer open={Boolean(detail)} onClose={() => setOpen(null)} title={detail ? `${detail.action}` : t('manufacturer.details')} description={detail ? `${fmt.dateTime(detail.occurredAt)} · ${detail.actorName ?? t('manufacturer.system')}` : undefined}>
            {detail && (
              <div className="mfr-details">
                <header>
                  <span className="mono">{detail.entityType}</span>
                  <span className="staff-muted mono">{detail.entityId}</span>
                </header>
                <pre className="mono">{JSON.stringify(detail.details, null, 2)}</pre>
              </div>
            )}
          </Drawer>
          {q.rows.length > 0 && <LoadMore hasMore={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} onLoad={() => void q.fetchNextPage()} shown={q.rows.length} />}
        </>
      )}
    </>
  );
}
