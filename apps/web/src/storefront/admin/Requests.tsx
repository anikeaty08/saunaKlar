import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone, Search } from 'lucide-react';
import { REQUEST_STATUSES, type RequestStatus } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { StatusBadge } from '../../design/components/Badge.tsx';
import { Input, Select, Textarea } from '../../design/components/Field.tsx';
import { Button } from '../../design/components/Button.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { LoadMore } from '../../design/components/LoadMore.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useCursorList } from '../../staff/useCursorList.ts';
import { dateInput, endOfDayIso, minorToInput, parseMoney, useAdminMutation, fullName } from './helpers.ts';
import type { ResponseOf } from '@saunaklar/shared';

type Summary = ResponseOf<'adminRequests'>['items'][number];
type AdminRequest = ResponseOf<'adminRequest'>;

/** Debounced copy of a value (search fields). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function RequestsList() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.nav.requests'));
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? '') as RequestStatus | '';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebounced(search.trim());
  useEffect(() => {
    setParams(
      p => {
        if (q) p.set('q', q);
        else p.delete('q');
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  }, [q, setParams]);

  const list = useCursorList<Summary>(['admin', 'requests', { status, q }], cursor =>
    api('adminRequests', { query: { limit: 25, ...(status ? { status } : {}), ...(q ? { q } : {}), ...(cursor ? { cursor } : {}) } }),
  );

  const columns: Column<Summary>[] = [
    {
      key: 'customer',
      header: t('admin.requests.customer'),
      cell: r => (
        <Link to={`/admin/requests/${r.id}`} className="row-link">
          <span className="staff-strong">{r.customerName}</span>
          <span className="staff-sub">{r.customerEmail}</span>
        </Link>
      ),
      sortValue: r => r.customerName,
    },
    {
      key: 'sauna',
      header: t('admin.requests.sauna'),
      cell: r => (
        <span className="cell-stack">
          {r.saunaName}
          <span className="staff-sub">{r.configurationName}</span>
        </span>
      ),
      sortValue: r => r.saunaName,
    },
    { key: 'status', header: t('staff.status'), cell: r => <StatusBadge status={r.status} />, sortValue: r => REQUEST_STATUSES.indexOf(r.status) },
    { key: 'price', header: t('admin.requests.price'), align: 'end', cell: r => <span className="mono">{fmt.money(r.finalPriceMinor, r.currency)}</span>, sortValue: r => r.finalPriceMinor },
    { key: 'created', header: t('admin.requests.submitted'), align: 'end', cell: r => <span className="mono staff-muted" title={fmt.dateTime(r.createdAt)}>{fmt.date(r.createdAt, 'short')}</span>, sortValue: r => r.createdAt, hideOnMobile: true },
  ];

  return (
    <>
      <PageHead title={t('admin.nav.requests')} lede={t('admin.requests.lede')} />
      <div className="staff-toolbar" role="search">
        <Input label={t('staff.search')} type="search" placeholder={t('admin.requests.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
        <Select
          label={t('staff.status')}
          value={status}
          onChange={e =>
            setParams(
              p => {
                if (e.target.value) p.set('status', e.target.value);
                else p.delete('status');
                return p;
              },
              { replace: true },
            )
          }
          options={[{ value: '', label: t('staff.all') }, ...REQUEST_STATUSES.map(s => ({ value: s, label: t(`status.${s}` as TKey) }))]}
        />
      </div>
      <Table
        columns={columns}
        rows={list.rows}
        rowKey={r => r.id}
        loading={list.isPending}
        caption={t('admin.nav.requests')}
        empty={
          <span className="cluster">
            <Icon icon={Search} size="sm" /> {t('admin.requests.empty')}
          </span>
        }
        onRowClick={r => navigate(`/admin/requests/${r.id}`)}
      />
      {list.rows.length > 0 && <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} shown={list.rows.length} />}
    </>
  );
}

export function RequestDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'request', id], queryFn: () => api('adminRequest', { params: { id } }) });
  useDocumentTitle(q.data ? `${fullName(q.data.customer)} · ${q.data.configuration.name}` : t('admin.nav.requests'));

  const apply = (r: AdminRequest) => {
    qc.setQueryData(['admin', 'request', id], r);
    void qc.invalidateQueries({ queryKey: ['admin', 'requests'] });
    void qc.invalidateQueries({ queryKey: ['admin', 'analytics'] });
  };

  if (q.isPending)
    return (
      <div aria-hidden="true" className="staff-grid">
        <Skeleton width="50%" height="3rem" />
        <Skeleton lines={8} />
      </div>
    );
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const s = r.snapshot;

  return (
    <>
      <PageHead
        crumbs={[{ label: t('admin.nav.requests'), to: '/admin/requests' }, { label: fullName(r.customer) }]}
        title={r.configuration.name}
        meta={
          <>
            <StatusBadge status={r.status} />
            <span>{r.configuration.sauna.name}</span>
            <span className="mono">{fmt.dateTime(r.createdAt)}</span>
          </>
        }
      />
      <div className="staff-grid staff-grid--main-side">
        <div>
          <Panel title={t('admin.requests.configuration')}>
            <dl className="kv">
              {r.configuration.selections.map(o => (
                <div key={o.optionId} style={{ display: 'contents' }}>
                  <dt>{o.groupName}</dt>
                  <dd className="price-row">
                    <span>{o.optionName}</span>
                    <span className="mono staff-muted">{o.priceDeltaMinor ? `+ ${fmt.money(o.priceDeltaMinor, s.currency)}` : '—'}</span>
                  </dd>
                </div>
              ))}
              <dt>{t('configure.basePrice')}</dt>
              <dd className="mono">{fmt.money(s.listPriceMinor, s.currency)}</dd>
              {s.discountMinor > 0 && (
                <>
                  <dt>{t('configure.discount')}</dt>
                  <dd className="mono">− {fmt.money(s.discountMinor, s.currency)}</dd>
                </>
              )}
              <dt>{t('admin.requests.snapshot')}</dt>
              <dd>
                <Price minor={s.finalPriceMinor} currency={s.currency} size="md" />
              </dd>
            </dl>
          </Panel>
          <Panel title={t('admin.requests.message')}>{r.message ? <p className="prose admin-message">{r.message}</p> : <p className="staff-muted">{t('admin.requests.noMessage')}</p>}</Panel>
          <Notes request={r} onDone={apply} />
          <Panel title={t('admin.requests.history')}>
            <ol className="timeline">
              {[...r.history].reverse().map((h, i) => (
                <li key={i} className="timeline__item">
                  <span>
                    {h.fromStatus ? `${t(`status.${h.fromStatus}` as TKey)} → ` : ''}
                    <strong>{t(`status.${h.toStatus}` as TKey)}</strong>
                  </span>
                  {h.note && <span>{h.note}</span>}
                  <span className="timeline__meta">
                    {fmt.dateTime(h.at)} · {h.actorName ?? t(`admin.requests.by.${h.actor}` as TKey)}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
        <div className="admin-side">
          <Panel title={t('admin.requests.contact')}>
            <div className="admin-contact">
              <Link to={`/admin/customers/${r.customer.id}`} className="staff-strong">
                {fullName(r.customer)}
              </Link>
              <a href={`mailto:${r.customer.email}`}>
                <Icon icon={Mail} size="sm" /> {r.customer.email}
              </a>
              {r.customer.phone && (
                <a href={`tel:${r.customer.phone.replace(/\s/g, '')}`}>
                  <Icon icon={Phone} size="sm" /> {r.customer.phone}
                </a>
              )}
            </div>
          </Panel>
          <QuotePanel request={r} onDone={apply} />
          <Transitions request={r} onDone={apply} />
        </div>
      </div>
    </>
  );
}

function Notes({ request: r, onDone }: { request: AdminRequest; onDone: (r: AdminRequest) => void }) {
  const { t } = useT();
  const fmt = useFormat();
  const [body, setBody] = useState('');
  const add = useAdminMutation((b: string) => api('adminNote', { params: { id: r.id }, body: { body: b } }), {
    success: 'admin.requests.noteAdded',
    onSuccess: d => {
      setBody('');
      onDone(d);
    },
  });
  return (
    <Panel title={t('admin.requests.notes')} lede={t('admin.requests.notesHint')}>
      {r.notes.length > 0 && (
        <ul className="notes">
          {r.notes.map(n => (
            <li key={n.id} className="note">
              <p>{n.body}</p>
              <span className="timeline__meta">
                {n.authorName} · {fmt.dateTime(n.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <form
        className="staff-form"
        onSubmit={e => {
          e.preventDefault();
          if (body.trim()) add.mutate(body.trim());
        }}
      >
        <Textarea label={t('admin.requests.addNote')} rows={3} placeholder={t('admin.requests.notePlaceholder')} value={body} onChange={e => setBody(e.target.value)} maxLength={4000} />
        <div className="staff-form__actions">
          <Button type="submit" variant="ghost" size="sm" loading={add.isPending} disabled={!body.trim()}>
            {t('admin.requests.addNote')}
          </Button>
        </div>
      </form>
    </Panel>
  );
}

const QUOTABLE: RequestStatus[] = ['SUBMITTED', 'IN_REVIEW', 'QUOTED'];

function QuotePanel({ request: r, onDone }: { request: AdminRequest; onDone: (r: AdminRequest) => void }) {
  const { t } = useT();
  const fmt = useFormat();
  const currency = r.snapshot.currency;
  const [amount, setAmount] = useState(minorToInput(r.activeQuote?.amountMinor ?? r.snapshot.finalPriceMinor));
  const [validUntil, setValidUntil] = useState(dateInput(30));
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useAdminMutation((body: { amountMinor: number; validUntil: string; note?: string }) => api('adminQuote', { params: { id: r.id }, body }), {
    success: 'admin.requests.quoteSent',
    onSuccess: d => {
      setNote('');
      onDone(d);
    },
  });
  const canQuote = QUOTABLE.includes(r.status) && (r.status !== 'SUBMITTED' || r.allowedTransitions.includes('QUOTED') || r.allowedTransitions.includes('IN_REVIEW'));
  const earlier = r.quotes.filter(q => q.id !== r.activeQuote?.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const minor = parseMoney(amount);
    if (minor === null || minor <= 0) return setError(t('validation.required'));
    if (!validUntil || new Date(endOfDayIso(validUntil)) <= new Date()) return setError(t('validation.required'));
    setError(null);
    send.mutate({ amountMinor: minor, validUntil: endOfDayIso(validUntil), ...(note.trim() ? { note: note.trim() } : {}) });
  };

  return (
    <Panel title={t('admin.requests.quote')} lede={canQuote ? t('admin.requests.quoteLede') : undefined}>
      {r.activeQuote && (
        <div className="admin-quote">
          <span className="eyebrow">{t('admin.requests.currentQuote')}</span>
          <Price minor={r.activeQuote.amountMinor} currency={r.activeQuote.currency} size="lg" />
          <span className="staff-muted">{t('account.quoteValid', { date: fmt.date(r.activeQuote.validUntil) })}</span>
          {r.activeQuote.note && <p>{r.activeQuote.note}</p>}
        </div>
      )}
      {canQuote && (
        <form className="staff-form" onSubmit={submit} noValidate>
          <div className="staff-form__row">
            <Input label={t('admin.requests.amount', { currency })} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} error={error && parseMoney(amount) === null ? error : null} required />
            <Input label={t('admin.requests.validUntil')} type="date" min={dateInput(1)} value={validUntil} onChange={e => setValidUntil(e.target.value)} required />
          </div>
          <Textarea label={t('admin.requests.quoteNote')} rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
          <div className="staff-form__actions">
            <Button type="submit" loading={send.isPending}>
              {t('admin.requests.sendQuote')}
            </Button>
          </div>
        </form>
      )}
      {earlier.length > 0 && (
        <details className="admin-earlier">
          <summary>{t('admin.requests.previousQuotes')}</summary>
          <ul>
            {earlier.map(qt => (
              <li key={qt.id} className="price-row">
                <span className="mono">{fmt.money(qt.amountMinor, qt.currency)}</span>
                <span className="staff-muted">{qt.supersededAt ? t('admin.requests.superseded', { date: fmt.date(qt.supersededAt) }) : fmt.date(qt.createdAt)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}

function Transitions({ request: r, onDone }: { request: AdminRequest; onDone: (r: AdminRequest) => void }) {
  const { t } = useT();
  const [target, setTarget] = useState<RequestStatus | null>(null);
  const [note, setNote] = useState('');
  // QUOTED is reached by sending a quote, not by a bare status change.
  const options = r.allowedTransitions.filter(s => s !== 'QUOTED');
  const move = useAdminMutation((body: { toStatus: RequestStatus; note?: string }) => api('adminTransition', { params: { id: r.id }, body }), {
    success: d => t('admin.requests.moved', { status: t(`status.${d.status}` as TKey) }),
    onSuccess: d => {
      setTarget(null);
      setNote('');
      onDone(d);
    },
  });
  if (options.length === 0) return null;
  return (
    <Panel title={t('admin.requests.move')}>
      <div className="cluster">
        {options.map(s => (
          <Button key={s} variant={s === 'REJECTED' || s === 'CANCELLED' ? 'quiet' : 'ghost'} size="sm" onClick={() => setTarget(s)}>
            {t(`status.${s}` as TKey)}
          </Button>
        ))}
      </div>
      <Dialog
        open={target !== null}
        onClose={() => setTarget(null)}
        size="sm"
        title={target ? `${t('admin.requests.move')}: ${t(`status.${target}` as TKey)}` : ''}
        footer={
          <>
            <Button variant="quiet" onClick={() => setTarget(null)}>
              {t('staff.cancel')}
            </Button>
            <Button onClick={() => target && move.mutate({ toStatus: target, ...(note.trim() ? { note: note.trim() } : {}) })} loading={move.isPending}>
              {target ? t(`status.${target}` as TKey) : ''}
            </Button>
          </>
        }
      >
        <Textarea label={t('admin.requests.transitionNote')} rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={2000} />
      </Dialog>
    </Panel>
  );
}
