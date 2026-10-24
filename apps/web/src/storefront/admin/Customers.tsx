import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, Plus } from 'lucide-react';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { Badge, StatusBadge } from '../../design/components/Badge.tsx';
import { Input } from '../../design/components/Field.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { LoadMore } from '../../design/components/LoadMore.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useCursorList } from '../../staff/useCursorList.ts';
import { useDebounced } from './Requests.tsx';
import { fullName } from './helpers.ts';

type Customer = ResponseOf<'adminCustomers'>['items'][number];

export function CustomersList() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.nav.customers'));
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());
  useEffect(() => {
    setParams(p => (q ? p.set('q', q) : p.delete('q'), p), { replace: true, preventScrollReset: true });
  }, [q, setParams]);
  const list = useCursorList<Customer>(['admin', 'customers', { q }], cursor => api('adminCustomers', { query: { limit: 25, ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) } }));

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: c => (
        <Link to={`/admin/customers/${c.id}`} className="row-link">
          <span className="staff-strong">{c.status === 'ANONYMISED' ? '—' : fullName(c)}</span>
          <span className="staff-sub">{c.email}</span>
        </Link>
      ),
      sortValue: c => c.lastName,
    },
    { key: 'status', header: t('staff.status'), cell: c => <Badge tone={c.status === 'ACTIVE' ? 'outline' : 'muted'}>{t(`admin.customers.status.${c.status}` as TKey)}</Badge> },
    { key: 'cfg', header: t('admin.nav.configurations'), align: 'end', cell: c => <span className="mono">{c.configurations}</span>, sortValue: c => c.configurations },
    { key: 'req', header: t('admin.nav.requests'), align: 'end', cell: c => <span className="mono">{c.requests}</span>, sortValue: c => c.requests },
    { key: 'since', header: t('admin.customers.since'), align: 'end', cell: c => <span className="mono staff-muted">{fmt.date(c.createdAt, 'short')}</span>, sortValue: c => c.createdAt, hideOnMobile: true },
  ];
  return (
    <>
      <PageHead title={t('admin.nav.customers')} lede={t('admin.customers.lede')} />
      <div className="staff-toolbar" role="search">
        <Input label={t('staff.search')} type="search" placeholder={t('admin.customers.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <Table columns={columns} rows={list.rows} rowKey={c => c.id} loading={list.isPending} caption={t('admin.nav.customers')} empty={t('admin.customers.empty')} onRowClick={c => navigate(`/admin/customers/${c.id}`)} />
      {list.rows.length > 0 && <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} shown={list.rows.length} />}
    </>
  );
}

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { t, locale } = useT();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['admin', 'customer', id], queryFn: () => api('adminCustomer', { params: { id } }) });
  useDocumentTitle(q.data ? fullName(q.data) : t('admin.nav.customers'));
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  return (
    <>
      <PageHead
        crumbs={[{ label: t('admin.nav.customers'), to: '/admin/customers' }, { label: fullName(c) }]}
        title={c.status === 'ANONYMISED' ? t('admin.customers.status.ANONYMISED') : fullName(c)}
        meta={
          <>
            <Badge tone={c.status === 'ACTIVE' ? 'outline' : 'muted'}>{t(`admin.customers.status.${c.status}` as TKey)}</Badge>
            <span>
              {t('admin.customers.since')} {fmt.date(c.createdAt)}
            </span>
          </>
        }
        actions={
          c.status !== 'ANONYMISED' && (
            <ButtonLink to={`/admin/configurations/new?customer=${c.id}`} icon={Plus} size="sm">
              {t('admin.customers.createFor')}
            </ButtonLink>
          )
        }
      />
      <div className="staff-grid staff-grid--main-side">
        <div>
          <Panel title={t('admin.customers.recentRequests')}>
            {c.recentRequests.length === 0 ? (
              <p className="staff-muted">{t('admin.requests.empty')}</p>
            ) : (
              <ul className="attention">
                {c.recentRequests.map(r => (
                  <li key={r.id}>
                    <Link to={`/admin/requests/${r.id}`} className="attention__row">
                      <span>
                        <span className="staff-strong">{r.configurationName}</span>
                        <span className="staff-sub">{r.saunaName}</span>
                      </span>
                      <StatusBadge status={r.status} />
                      <span className="mono staff-muted">{fmt.money(r.finalPriceMinor, r.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t('admin.customers.recentConfigurations')}>
            {c.recentConfigurations.length === 0 ? (
              <p className="staff-muted">{t('admin.configurations.empty')}</p>
            ) : (
              <ul className="attention">
                {c.recentConfigurations.map(cf => (
                  <li key={cf.id}>
                    <Link to={`/admin/configurations/${cf.id}`} className="attention__row">
                      <span>
                        <span className="staff-strong">{cf.name}</span>
                        <span className="staff-sub">{cf.sauna.name}</span>
                      </span>
                      {cf.request ? <StatusBadge status={cf.request.status} /> : <StatusBadge status={cf.locked ? 'LOCKED' : 'DRAFT'} />}
                      <span className="mono staff-muted">{fmt.money(cf.finalPriceMinor, cf.currency)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
        <div className="admin-side">
          <Panel title={t('admin.requests.contact')}>
            <div className="admin-contact">
              <a href={`mailto:${c.email}`}>
                <Icon icon={Mail} size="sm" /> {c.email}
              </a>
              {c.phone && (
                <a href={`tel:${c.phone.replace(/\s/g, '')}`}>
                  <Icon icon={Phone} size="sm" /> {c.phone}
                </a>
              )}
            </div>
          </Panel>
          <Panel title={t('admin.customers.addresses')}>
            {c.addresses.length === 0 ? (
              <p className="staff-muted">{t('admin.customers.noAddresses')}</p>
            ) : (
              c.addresses.map(a => (
                <address key={a.id} className="admin-address">
                  <span className="eyebrow">{t(`admin.customers.addressType.${a.addressType}` as TKey)}</span>
                  <span>{a.recipient}</span>
                  <span>{a.line1}</span>
                  {a.line2 && <span>{a.line2}</span>}
                  <span>
                    {a.postalCode} {a.city}
                    {a.region ? `, ${a.region}` : ''}
                  </span>
                  <span>{new Intl.DisplayNames([locale], { type: 'region' }).of(a.countryCode) ?? a.countryCode}</span>
                </address>
              ))
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
