import { useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Download, FileText, Inbox, Pencil } from 'lucide-react';
import { api, isApiError } from '../../api/client.ts';
import { sessionQuery, useTenantData } from '../../api/queries.ts';
import type { ConfigurationSummary, RequestSummary } from '../../api/types.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Reveal } from '../../motion/Reveal.tsx';
import { Table, type Column } from '../../design/components/Table.tsx';
import { StatusBadge } from '../../design/components/Badge.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { LoadMore } from '../../design/components/LoadMore.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Input } from '../../design/components/Field.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { FlipText } from '../../motion/FlipText.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { RequireCustomer } from './RequireCustomer.tsx';
import './Account.css';

function errorText(t: (k: TKey) => string, e: unknown) {
  if (isApiError(e)) {
    const key = `errors.codes.${e.code}` as TKey;
    const m = t(key);
    return m === key ? e.message : m;
  }
  return t('errors.body');
}

function AccountSkeleton() {
  return (
    <div className="page container" aria-hidden="true">
      <Skeleton width="30%" height="0.8rem" />
      <Skeleton width="55%" height="4rem" style={{ marginTop: '1rem' }} />
      <Skeleton lines={6} style={{ marginTop: '3rem' }} />
    </div>
  );
}

export function AccountLayout() {
  const { t } = useT();
  return (
    <RequireCustomer fallback={<AccountSkeleton />}>
      {s => (
        <div className="page container account">
          <header className="account__head">
            <ScrambleText as="p" className="eyebrow" text={t('account.eyebrow')} />
            <ScrambleText as="h1" className="page-title page-title--md" text={t('account.hello', { name: s.customer.firstName })} />
            <nav className="account__nav" aria-label={t('nav.account')}>
              {[
                { to: '/account', label: t('nav.account'), end: true },
                { to: '/account/configurations', label: t('account.configurations') },
                { to: '/account/requests', label: t('account.requests') },
                { to: '/account/profile', label: t('account.profile') },
              ].map(l => (
                <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => ['account__tab', isActive && 'is-active'].filter(Boolean).join(' ')}>
                  <FlipText text={l.label} />
                </NavLink>
              ))}
            </nav>
          </header>
          <Outlet />
        </div>
      )}
    </RequireCustomer>
  );
}

function useConfigurationsList() {
  return useInfiniteQuery({
    queryKey: ['configurations'],
    queryFn: ({ pageParam }) => api('configurations', { query: pageParam ? { cursor: pageParam, limit: 10 } : { limit: 10 } }),
    initialPageParam: '' as string,
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
}

function useRequestsList() {
  return useInfiniteQuery({
    queryKey: ['requests'],
    queryFn: ({ pageParam }) => api('myRequests', { query: pageParam ? { cursor: pageParam, limit: 10 } : { limit: 10 } }),
    initialPageParam: '' as string,
    getNextPageParam: last => last.nextCursor ?? undefined,
  });
}

function ConfigurationsTable({ rows, loading }: { rows: ConfigurationSummary[]; loading: boolean }) {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const cols: Column<ConfigurationSummary>[] = [
    { key: 'name', header: t('account.columns.name'), cell: r => <Link to={`/account/configurations/${r.id}`}>{r.name}</Link>, sortValue: r => r.name },
    { key: 'sauna', header: t('account.columns.sauna'), cell: r => r.sauna.name, sortValue: r => r.sauna.name, hideOnMobile: true },
    { key: 'status', header: t('account.columns.status'), cell: r => (r.request ? <StatusBadge status={r.request.status} /> : <StatusBadge status={r.locked ? 'LOCKED' : 'DRAFT'} />) },
    { key: 'price', header: t('account.columns.price'), cell: r => <span className="mono">{fmt.money(r.finalPriceMinor, r.currency)}</span>, sortValue: r => r.finalPriceMinor, align: 'end' },
    { key: 'updated', header: t('account.columns.updated'), cell: r => <span className="mono muted">{fmt.relative(r.updatedAt)}</span>, sortValue: r => r.updatedAt, align: 'end', hideOnMobile: true },
  ];
  return (
    <Table
      columns={cols}
      rows={rows}
      rowKey={r => r.id}
      loading={loading}
      caption={t('account.configurations')}
      onRowClick={r => navigate(`/account/configurations/${r.id}`)}
      empty={<EmptyState icon={FileText} title={t('account.noConfigurations')} body={t('account.noConfigurationsBody')} action={<ButtonLink to="/saunas">{t('home.ctaPrimary')}</ButtonLink>} compact />}
    />
  );
}

function RequestsTable({ rows, loading }: { rows: RequestSummary[]; loading: boolean }) {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  const cols: Column<RequestSummary>[] = [
    { key: 'name', header: t('account.columns.name'), cell: r => <Link to={`/account/requests/${r.id}`}>{r.configurationName}</Link>, sortValue: r => r.configurationName },
    { key: 'sauna', header: t('account.columns.sauna'), cell: r => r.saunaName, sortValue: r => r.saunaName, hideOnMobile: true },
    { key: 'status', header: t('account.columns.status'), cell: r => <StatusBadge status={r.status} />, sortValue: r => r.status },
    { key: 'price', header: t('account.columns.price'), cell: r => <span className="mono">{fmt.money(r.finalPriceMinor, r.currency)}</span>, sortValue: r => r.finalPriceMinor, align: 'end' },
    { key: 'created', header: t('account.columns.created'), cell: r => <span className="mono muted">{fmt.date(r.createdAt)}</span>, sortValue: r => r.createdAt, align: 'end', hideOnMobile: true },
  ];
  return (
    <Table
      columns={cols}
      rows={rows}
      rowKey={r => r.id}
      loading={loading}
      caption={t('account.requests')}
      onRowClick={r => navigate(`/account/requests/${r.id}`)}
      empty={<EmptyState icon={Inbox} title={t('account.noRequests')} body={t('account.noRequestsBody')} compact />}
    />
  );
}

export function Overview() {
  const { t } = useT();
  useDocumentTitle(t('nav.account'));
  const configs = useConfigurationsList();
  const requests = useRequestsList();
  return (
    <Reveal className="account__overview" stagger={0.1}>
      <section>
        <header className="account__section-head">
          <h2>{t('account.requests')}</h2>
          <ButtonLink to="/account/requests" variant="link" iconAfter={ArrowRight}>
            {t('nav.requests')}
          </ButtonLink>
        </header>
        <RequestsTable rows={(requests.data?.pages.flatMap(p => p.items) ?? []).slice(0, 3)} loading={requests.isPending} />
      </section>
      <section>
        <header className="account__section-head">
          <h2>{t('account.configurations')}</h2>
          <ButtonLink to="/account/configurations" variant="link" iconAfter={ArrowRight}>
            {t('nav.configurations')}
          </ButtonLink>
        </header>
        <ConfigurationsTable rows={(configs.data?.pages.flatMap(p => p.items) ?? []).slice(0, 5)} loading={configs.isPending} />
      </section>
    </Reveal>
  );
}

export function Configurations() {
  const { t } = useT();
  useDocumentTitle(t('account.configurations'));
  const q = useConfigurationsList();
  const rows = q.data?.pages.flatMap(p => p.items) ?? [];
  return (
    <>
      <ConfigurationsTable rows={rows} loading={q.isPending} />
      {rows.length > 0 && <LoadMore hasMore={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} onLoad={() => void q.fetchNextPage()} shown={rows.length} />}
    </>
  );
}

export function Requests() {
  const { t } = useT();
  useDocumentTitle(t('account.requests'));
  const q = useRequestsList();
  const rows = q.data?.pages.flatMap(p => p.items) ?? [];
  return (
    <>
      <RequestsTable rows={rows} loading={q.isPending} />
      {rows.length > 0 && <LoadMore hasMore={Boolean(q.hasNextPage)} loading={q.isFetchingNextPage} onLoad={() => void q.fetchNextPage()} shown={rows.length} />}
    </>
  );
}

export function ConfigurationDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const q = useQuery({ queryKey: ['configuration', id], queryFn: () => api('configuration', { params: { id } }) });
  useDocumentTitle(q.data?.name);
  if (q.isPending) return <Skeleton lines={6} />;
  if (q.error) return <ErrorPage error={q.error} />;
  const c = q.data;
  const p = c.snapshot ?? c.price;
  return (
    <div className="split">
      <div className="stack">
        <p className="eyebrow">{c.sauna.name}</p>
        <h2 className="account__h2">{c.name}</h2>
        {c.request ? <StatusBadge status={c.request.status} /> : <StatusBadge status={c.locked ? 'LOCKED' : 'DRAFT'} />}
        <div className="cluster" style={{ marginTop: 'var(--space-5)' }}>
          <ButtonLink to={`/saunas/${c.sauna.slug}/configure?id=${c.id}`} icon={Pencil}>
            {c.locked ? t('configure.clone') : t('common.edit')}
          </ButtonLink>
          {c.request && (
            <ButtonLink to={`/account/requests/${c.request.id}`} variant="ghost" iconAfter={ArrowRight}>
              {t('nav.requests')}
            </ButtonLink>
          )}
        </div>
      </div>
      <div>
        <dl className="kv">
          <dt>{t('configure.basePrice')}</dt>
          <dd className="mono">{fmt.money(p.listPriceMinor, p.currency)}</dd>
          <dt>{t('configure.optionsTotal')}</dt>
          <dd className="mono">+ {fmt.money(p.optionsTotalMinor, p.currency)}</dd>
          {p.discountMinor > 0 && (
            <>
              <dt>{t('configure.discount')}</dt>
              <dd className="mono">− {fmt.money(p.discountMinor, p.currency)}</dd>
            </>
          )}
          <dt>{t('configure.total')}</dt>
          <dd>
            <Price minor={p.finalPriceMinor} currency={p.currency} size="md" />
          </dd>
          {c.snapshot && (
            <>
              <dt>{t('account.snapshot')}</dt>
              <dd className="mono">
                {t('shared.priceAsOf', { date: fmt.date(c.snapshot.computedAt) })} · {t('shared.validUntil', { date: fmt.date(c.snapshot.priceValidUntil) })}
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

export function RequestDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const q = useQuery({ queryKey: ['request', id], queryFn: () => api('myRequest', { params: { id } }) });
  useDocumentTitle(q.data?.configuration.name);
  const onDone = (r: Awaited<ReturnType<typeof api<'myRequest'>>>) => {
    qc.setQueryData(['request', id], r);
    void qc.invalidateQueries({ queryKey: ['requests'] });
    setConfirmCancel(false);
    toast(t(`status.${r.status}` as TKey));
  };
  const cancel = useMutation({
    mutationFn: () => api('cancelRequest', { params: { id } }),
    onSuccess: onDone,
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
  // The quote the customer is looking at is sent along; if staff re-quoted in
  // the meantime the API answers 409 and the new quote is shown for review.
  const accept = useMutation({
    mutationFn: (quoteId: string) => api('acceptRequest', { params: { id }, body: { quoteId } }),
    onSuccess: onDone,
    onError: e => {
      if (isApiError(e, 'CONFLICT') || isApiError(e, 'QUOTE_MISSING')) {
        void q.refetch();
        toast.error(t('account.quoteChanged'));
      } else toast.error(t('errors.title'), errorText(t, e));
    },
  });
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} />;
  const r = q.data;
  const s = r.snapshot;
  const canCancel = ['SUBMITTED', 'IN_REVIEW', 'QUOTED'].includes(r.status);
  const canAccept = r.status === 'QUOTED' && r.activeQuote && new Date(r.activeQuote.validUntil) > new Date();
  return (
    <div className="split">
      <div className="stack" style={{ ['--stack' as string]: 'var(--space-5)' }}>
        <div className="cluster">
          <StatusBadge status={r.status} />
          <span className="mono muted">{fmt.dateTime(r.createdAt)}</span>
        </div>
        <h2 className="account__h2">{r.configuration.name}</h2>
        <p className="muted">{r.configuration.sauna.name}</p>
        {r.activeQuote && (
          <div className="account__quote">
            <p className="eyebrow">{t('account.quote')}</p>
            <Price minor={r.activeQuote.amountMinor} currency={r.activeQuote.currency} size="lg" />
            <p className="muted">{t('account.quoteValid', { date: fmt.date(r.activeQuote.validUntil) })}</p>
            {r.activeQuote.note && <p>{r.activeQuote.note}</p>}
            {canAccept && (
              <Button onClick={() => accept.mutate(r.activeQuote!.id)} loading={accept.isPending}>
                {t('account.accept')}
              </Button>
            )}
          </div>
        )}
        <section>
          <h3 className="account__h3">{t('account.history')}</h3>
          <ol className="history">
            {[...r.history].reverse().map((h, i) => (
              <li key={i}>
                <StatusBadge status={h.toStatus} />
                <span className="mono muted">{fmt.dateTime(h.at)}</span>
                {h.note && <p>{h.note}</p>}
              </li>
            ))}
          </ol>
        </section>
        {r.message && (
          <section>
            <h3 className="account__h3">{t('account.message')}</h3>
            <p className="muted">{r.message}</p>
          </section>
        )}
        {canCancel && (
          <div>
            <Button variant="ghost" onClick={() => setConfirmCancel(true)}>
              {t('account.cancelRequest')}
            </Button>
          </div>
        )}
      </div>
      <div className="stack">
        <h3 className="account__h3">{t('account.selections')}</h3>
        <dl className="kv">
          {r.configuration.selections.map(o => (
            <div key={o.optionId} style={{ display: 'contents' }}>
              <dt>{o.groupName}</dt>
              <dd style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem' }}>
                <span>{o.optionName}</span>
                <span className="mono muted">{o.priceDeltaMinor ? fmt.money(o.priceDeltaMinor, s.currency) : t('common.included')}</span>
              </dd>
            </div>
          ))}
        </dl>
        <div className="account__snapshot">
          <Price minor={s.finalPriceMinor} currency={s.currency} listMinor={s.discountMinor ? s.subtotalMinor : null} size="lg" label={t('account.snapshot')} />
          <p className="muted mono" style={{ fontSize: 'var(--step--2)' }}>
            {t('shared.priceAsOf', { date: fmt.date(s.computedAt) })} · {t('shared.validUntil', { date: fmt.date(s.priceValidUntil) })}
          </p>
        </div>
      </div>
      <Dialog
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('account.cancelRequest')}
        description={t('account.cancelConfirm')}
        size="sm"
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirmCancel(false)}>
              {t('common.back')}
            </Button>
            <Button onClick={() => cancel.mutate()} loading={cancel.isPending}>
              {t('common.confirm')}
            </Button>
          </>
        }
      />
    </div>
  );
}

export function Profile() {
  const { t } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tenant = useTenantData();
  useDocumentTitle(t('account.profile'));
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('me') });
  const [edit, setEdit] = useState<{ firstName: string; lastName: string; phone: string } | null>(null);
  const [del, setDel] = useState(false);
  const [password, setPassword] = useState('');
  const save = useMutation({
    mutationFn: (body: { firstName: string; lastName: string; phone: string | null }) => api('patchMe', { body }),
    onSuccess: p => {
      qc.setQueryData(['me'], p);
      void qc.invalidateQueries({ queryKey: sessionQuery.queryKey });
      toast(t('account.profileSaved'));
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
  const remove = useMutation({
    mutationFn: () => api('deleteMe', { body: { password } }),
    onSuccess: () => {
      qc.clear();
      navigate('/');
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
  const exportData = async () => {
    const data = await api('exportMe');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'my-data.json';
    a.click();
    URL.revokeObjectURL(url);
  };
  if (me.isPending) return <Skeleton lines={6} />;
  if (me.error) return <ErrorPage error={me.error} />;
  const p = me.data;
  const f = edit ?? { firstName: p.firstName, lastName: p.lastName, phone: p.phone ?? '' };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({ firstName: f.firstName, lastName: f.lastName, phone: f.phone || null });
  };
  return (
    <div className="split">
      <form className="stack" style={{ ['--stack' as string]: 'var(--space-5)' }} onSubmit={submit}>
        <Input label={t('auth.email')} value={p.email} readOnly disabled />
        <div className="auth__pair" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 'var(--space-4)' }}>
          <Input label={t('auth.firstName')} required value={f.firstName} onChange={e => setEdit({ ...f, firstName: e.target.value })} />
          <Input label={t('auth.lastName')} required value={f.lastName} onChange={e => setEdit({ ...f, lastName: e.target.value })} />
        </div>
        <Input label={t('auth.phone')} type="tel" value={f.phone} onChange={e => setEdit({ ...f, phone: e.target.value })} />
        <div>
          <Button type="submit" loading={save.isPending}>
            {t('common.save')}
          </Button>
        </div>
      </form>
      <div className="stack" style={{ ['--stack' as string]: 'var(--space-5)' }}>
        <div className="account__danger">
          <Button variant="ghost" icon={Download} onClick={() => void exportData()}>
            {t('account.export')}
          </Button>
        </div>
        <div className="account__danger">
          <h3 className="account__h3">{t('account.deleteAccount')}</h3>
          <p className="muted">{t('account.deleteBody', { name: tenant.branding.displayName })}</p>
          <Button variant="ghost" onClick={() => setDel(true)}>
            {t('account.deleteAccount')}
          </Button>
        </div>
      </div>
      <Dialog
        open={del}
        onClose={() => setDel(false)}
        title={t('account.deleteAccount')}
        description={t('account.deleteBody', { name: tenant.branding.displayName })}
        size="sm"
        footer={
          <>
            <Button variant="quiet" onClick={() => setDel(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => remove.mutate()} loading={remove.isPending} disabled={!password}>
              {t('common.delete')}
            </Button>
          </>
        }
      >
        <Input label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required />
      </Dialog>
    </div>
  );
}
