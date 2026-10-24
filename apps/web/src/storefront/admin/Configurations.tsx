import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Link2, Plus, X } from 'lucide-react';
import { toggle } from '@saunaklar/rules';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { saunaQuery, useTenantData } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Table, type Column } from '../../design/components/Table.tsx';
import { Badge, StatusBadge } from '../../design/components/Badge.tsx';
import { Checkbox, Input, Radio, Select } from '../../design/components/Field.tsx';
import { Button, ButtonLink, IconButton } from '../../design/components/Button.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { LoadMore } from '../../design/components/LoadMore.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Price } from '../../design/components/Price.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useCursorList } from '../../staff/useCursorList.ts';
import { rulesOf } from '../components/sauna-helpers.ts';
import { useDebounced } from './Requests.tsx';
import { fullName, useAdminMutation } from './helpers.ts';

type Summary = ResponseOf<'adminConfigurations'>['items'][number];
type Config = ResponseOf<'adminConfiguration'>;

export function ConfigurationsList() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('admin.nav.configurations'));
  const list = useCursorList<Summary>(['admin', 'configurations'], cursor => api('adminConfigurations', { query: { limit: 25, ...(cursor ? { cursor } : {}) } }));
  const columns: Column<Summary>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: c => (
        <Link to={`/admin/configurations/${c.id}`} className="row-link">
          <span className="staff-strong">{c.name}</span>
          <span className="staff-sub">{c.sauna.name}</span>
        </Link>
      ),
      sortValue: c => c.name,
    },
    { key: 'owner', header: t('admin.configurations.ownerLabel'), cell: c => <Badge tone={c.owner === 'STAFF' ? 'soft' : 'outline'}>{t(`admin.configurations.owner.${c.owner}` as TKey)}</Badge>, sortValue: c => c.owner, hideOnMobile: true },
    { key: 'status', header: t('staff.status'), cell: c => (c.request ? <StatusBadge status={c.request.status} /> : <StatusBadge status={c.locked ? 'LOCKED' : 'DRAFT'} />) },
    { key: 'price', header: t('admin.configurations.price'), align: 'end', cell: c => <span className="mono">{fmt.money(c.finalPriceMinor, c.currency)}</span>, sortValue: c => c.finalPriceMinor },
    { key: 'updated', header: t('staff.updated'), align: 'end', cell: c => <span className="mono staff-muted">{fmt.date(c.updatedAt, 'short')}</span>, sortValue: c => c.updatedAt, hideOnMobile: true },
  ];
  return (
    <>
      <PageHead
        title={t('admin.nav.configurations')}
        lede={t('admin.configurations.lede')}
        actions={
          <ButtonLink to="/admin/configurations/new" icon={Plus} size="sm">
            {t('admin.configurations.new')}
          </ButtonLink>
        }
      />
      <Table columns={columns} rows={list.rows} rowKey={c => c.id} loading={list.isPending} caption={t('admin.nav.configurations')} empty={t('admin.configurations.empty')} onRowClick={c => navigate(`/admin/configurations/${c.id}`)} />
      {list.rows.length > 0 && <LoadMore hasMore={Boolean(list.hasNextPage)} loading={list.isFetchingNextPage} onLoad={() => void list.fetchNextPage()} shown={list.rows.length} />}
    </>
  );
}

/** Picks a customer by searching name or e-mail; an empty value means "for a share link". */
function CustomerPicker({ value, onChange }: { value: { id: string; label: string } | null; onChange: (v: { id: string; label: string } | null) => void }) {
  const { t } = useT();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const results = useQuery({ queryKey: ['admin', 'customers', { q, limit: 6 }], queryFn: () => api('adminCustomers', { query: { q, limit: 6 } }), enabled: q.length >= 2 });
  if (value)
    return (
      <div className="picker__chosen">
        <span className="staff-strong">{value.label}</span>
        <IconButton icon={X} label={t('admin.configurations.noCustomer')} variant="quiet" size="sm" onClick={() => onChange(null)} />
      </div>
    );
  return (
    <div className="picker">
      <Input label={t('admin.configurations.customer')} hint={t('admin.configurations.customerHint')} type="search" placeholder={t('admin.customers.searchPlaceholder')} value={search} onChange={e => setSearch(e.target.value)} />
      {q.length >= 2 && (results.data?.items.length ?? 0) > 0 && (
        <ul className="picker__list">
          {results.data!.items
            .filter(c => c.status !== 'ANONYMISED')
            .map(c => (
              <li key={c.id}>
                <button type="button" onClick={() => onChange({ id: c.id, label: `${fullName(c)} · ${c.email}` })}>
                  <span className="staff-strong">{fullName(c)}</span>
                  <span className="staff-sub">{c.email}</span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function NewConfiguration() {
  const { t } = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  useDocumentTitle(t('admin.configurations.new'));
  const saunas = useQuery({ queryKey: ['admin', 'saunas'], queryFn: () => api('adminSaunas') });
  const preset = params.get('customer');
  const presetCustomer = useQuery({ queryKey: ['admin', 'customer', preset], queryFn: () => api('adminCustomer', { params: { id: preset! } }), enabled: Boolean(preset) });
  const [saunaId, setSaunaId] = useState('');
  const [name, setName] = useState('');
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (presetCustomer.data) setCustomer({ id: presetCustomer.data.id, label: `${fullName(presetCustomer.data)} · ${presetCustomer.data.email}` });
  }, [presetCustomer.data]);
  useEffect(() => {
    if (!saunaId && saunas.data?.items[0]) setSaunaId(saunas.data.items[0].id);
  }, [saunas.data, saunaId]);

  const create = useAdminMutation(
    () => api('adminCreateConfiguration', { body: { saunaModelId: saunaId, ...(name.trim() ? { name: name.trim() } : {}), ...(customer ? { customerId: customer.id } : {}) } }),
    { success: 'admin.configurations.createdToast', invalidate: [['admin', 'configurations']], onSuccess: c => navigate(`/admin/configurations/${c.id}`, { replace: true }) },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saunaId) create.mutate(undefined);
  };
  return (
    <>
      <PageHead crumbs={[{ label: t('admin.nav.configurations'), to: '/admin/configurations' }, { label: t('admin.configurations.new') }]} title={t('admin.configurations.new')} lede={t('admin.configurations.newLede')} />
      {saunas.isPending ? (
        <Skeleton lines={5} />
      ) : (
        <form className="staff-form" onSubmit={submit}>
          <Select label={t('admin.configurations.sauna')} value={saunaId} onChange={e => setSaunaId(e.target.value)} options={(saunas.data?.items ?? []).map(s => ({ value: s.id, label: s.isVisible ? s.name : `${s.name} (${t('admin.saunas.hidden')})` }))} required />
          <Input label={t('admin.configurations.new') + ' · ' + t('staff.name')} value={name} onChange={e => setName(e.target.value)} maxLength={120} />
          <CustomerPicker value={customer} onChange={setCustomer} />
          <div className="staff-form__actions">
            <Button type="submit" loading={create.isPending} disabled={!saunaId}>
              {t('staff.create')}
            </Button>
            <ButtonLink to="/admin/configurations" variant="quiet">
              {t('staff.cancel')}
            </ButtonLink>
          </div>
        </form>
      )}
    </>
  );
}

export function ConfigurationDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const tenant = useTenantData();
  const q = useQuery({ queryKey: ['admin', 'configuration', id], queryFn: () => api('adminConfiguration', { params: { id } }) });
  const slug = q.data?.sauna.slug;
  const sauna = useQuery({ ...saunaQuery(qc, tenant.catalogVersion, slug ?? ''), enabled: Boolean(slug), retry: false });
  useDocumentTitle(q.data?.name ?? t('admin.nav.configurations'));
  if (q.isPending) return <Skeleton lines={8} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const c = q.data;
  const p = c.snapshot ?? c.price;
  const names = new Map(sauna.data?.groups.flatMap(g => g.options.map(o => [o.id, { group: g.name, name: o.name }] as const)) ?? []);
  return (
    <>
      <PageHead
        crumbs={[{ label: t('admin.nav.configurations'), to: '/admin/configurations' }, { label: c.name }]}
        title={c.name}
        meta={
          <>
            {c.request ? <StatusBadge status={c.request.status} /> : <StatusBadge status={c.locked ? 'LOCKED' : 'DRAFT'} />}
            <span>{c.sauna.name}</span>
            <Badge tone={c.owner === 'STAFF' ? 'soft' : 'outline'}>{t(`admin.configurations.owner.${c.owner}` as TKey)}</Badge>
            {c.customerId && <Link to={`/admin/customers/${c.customerId}`}>{t('admin.requests.customer')}</Link>}
            {c.request && <Link to={`/admin/requests/${c.request.id}`}>{t('admin.nav.requests')}</Link>}
          </>
        }
      />
      <div className="staff-grid staff-grid--main-side">
        <div>
          {sauna.data && !c.locked ? (
            <OptionsEditor config={c} sauna={sauna.data} />
          ) : (
            <Panel title={t('admin.configurations.options')} lede={c.locked ? t('admin.configurations.lockedHint') : undefined}>
              <dl className="kv">
                {c.selections.map(o => (
                  <div key={o} style={{ display: 'contents' }}>
                    <dt>{names.get(o)?.group ?? '—'}</dt>
                    <dd>{names.get(o)?.name ?? <span className="mono staff-muted">{o.slice(0, 8)}</span>}</dd>
                  </div>
                ))}
              </dl>
            </Panel>
          )}
          <ShareLinks configurationId={c.id} />
        </div>
        <div className="admin-side">
          <Panel title={t('admin.configurations.price')}>
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
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

type SaunaDetailT = ResponseOf<'sauna'>;

function OptionsEditor({ config, sauna }: { config: Config; sauna: SaunaDetailT }) {
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const rules = useMemo(() => rulesOf(sauna), [sauna]);
  const [sel, setSel] = useState<string[]>(config.selections);
  useEffect(() => setSel(config.selections), [config.selections]);
  const dirty = sel.length !== config.selections.length || sel.some(s => !config.selections.includes(s));
  const save = useAdminMutation(() => api('adminPutSelections', { params: { id: config.id }, body: { optionIds: sel } }), {
    success: 'staff.saved',
    invalidate: [['admin', 'configurations']],
    onSuccess: d => qc.setQueryData(['admin', 'configuration', config.id], d),
  });
  const flip = (optionId: string, on: boolean) => {
    const r = toggle(rules, sel, optionId, on);
    if (r.rejected) return toast.error(r.rejected);
    setSel(r.selection);
  };
  return (
    <Panel
      title={t('admin.configurations.editOptions')}
      action={
        dirty && (
          <Button size="sm" onClick={() => save.mutate(undefined)} loading={save.isPending}>
            {t('admin.configurations.saveOptions')}
          </Button>
        )
      }
    >
      <div className="admin-groups">
        {sauna.groups.map(g => (
          <fieldset key={g.id} className="admin-group">
            <legend>{g.name}</legend>
            {g.options.map(o => {
              const props = {
                label: (
                  <span className="price-row">
                    <span>{o.name}</span>
                    <span className="mono staff-muted">{o.priceDeltaMinor ? `+ ${fmt.money(o.priceDeltaMinor, config.price.currency)}` : ''}</span>
                  </span>
                ),
                checked: sel.includes(o.id),
                onChange: (e: React.ChangeEvent<HTMLInputElement>) => flip(o.id, e.target.checked),
              };
              return g.selectionType === 'SINGLE' ? <Radio key={o.id} name={g.id} {...props} /> : <Checkbox key={o.id} {...props} />;
            })}
          </fieldset>
        ))}
      </div>
    </Panel>
  );
}

function ShareLinks({ configurationId }: { configurationId: string }) {
  const { t } = useT();
  const fmt = useFormat();
  const settings = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api('adminSettings') });
  const links = useQuery({ queryKey: ['admin', 'share-links', configurationId], queryFn: () => api('adminShareLinks', { params: { id: configurationId } }) });
  const [days, setDays] = useState<string>('');
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const expiry = days || String(settings.data?.defaultShareExpiryDays ?? 14);

  const create = useAdminMutation(() => api('adminCreateShareLink', { params: { id: configurationId }, body: { expiresInDays: Number(expiry) } }), {
    success: 'admin.configurations.linkCreated',
    invalidate: [['admin', 'share-links', configurationId]],
    onSuccess: d => {
      setCopied(false);
      setCreated({ url: d.url, expiresAt: d.expiresAt });
    },
  });
  const revoke = useAdminMutation((linkId: string) => api('adminRevokeShareLink', { params: { id: configurationId, linkId } }), {
    success: 'admin.configurations.revoked',
    invalidate: [['admin', 'share-links', configurationId]],
    onSuccess: () => setRevoking(null),
  });
  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
      toast(t('staff.copied'));
    } catch {
      /* the URL stays selectable */
    }
  };
  const dayOptions = [1, 3, 7, 14, 30, 60, 90].map(d => ({ value: String(d), label: t('staff.days', { count: d }) }));
  if (!dayOptions.some(o => o.value === expiry)) dayOptions.push({ value: expiry, label: t('staff.days', { count: Number(expiry) }) });

  return (
    <Panel title={t('admin.configurations.shareLinks')} lede={t('admin.configurations.shareLinksLede')}>
      {created && (
        <div className="once-box" role="status">
          <p className="once-box__note">{t('admin.configurations.linkOnce')}</p>
          <div className="once-box__url">
            <code className="mono" onClick={e => window.getSelection()?.selectAllChildren(e.currentTarget)}>
              {created.url}
            </code>
            <Button size="sm" icon={copied ? Check : Copy} onClick={() => void copy()}>
              {t('staff.copy')}
            </Button>
          </div>
          <p className="once-box__note">
            {t('admin.configurations.expires')}: {fmt.date(created.expiresAt)}
          </p>
        </div>
      )}
      <div className="staff-toolbar">
        <Select label={t('admin.configurations.expiresIn')} value={expiry} onChange={e => setDays(e.target.value)} options={dayOptions} />
        <Button icon={Link2} variant="ghost" onClick={() => create.mutate(undefined)} loading={create.isPending}>
          {t('admin.configurations.newLink')}
        </Button>
      </div>
      {links.isPending ? (
        <Skeleton lines={3} />
      ) : (
        <Table
          caption={t('admin.configurations.shareLinks')}
          rows={links.data?.items ?? []}
          rowKey={l => l.id}
          empty={t('admin.configurations.noLinks')}
          columns={[
            { key: 'created', header: t('staff.created'), cell: l => <span className="mono">{fmt.date(l.createdAt, 'short')}</span>, sortValue: l => l.createdAt },
            { key: 'state', header: t('staff.status'), cell: l => <Badge tone={l.state === 'ACTIVE' ? 'solid' : 'muted'}>{t(`admin.configurations.linkState.${l.state}` as TKey)}</Badge> },
            { key: 'expires', header: t('admin.configurations.expires'), cell: l => <span className="mono staff-muted">{fmt.date(l.revokedAt ?? l.expiresAt, 'short')}</span>, hideOnMobile: true },
            { key: 'views', header: t('admin.configurations.views'), align: 'end', cell: l => <span className="mono" title={l.lastViewedAt ? `${t('admin.configurations.lastViewed')}: ${fmt.dateTime(l.lastViewedAt)}` : undefined}>{l.views}</span>, sortValue: l => l.views },
            {
              key: 'actions',
              header: <span className="sr-only">{t('staff.actions')}</span>,
              label: t('staff.actions'),
              align: 'end',
              cell: l =>
                l.state === 'ACTIVE' ? (
                  <Button size="sm" variant="quiet" onClick={() => setRevoking(l.id)}>
                    {t('admin.configurations.revoke')}
                  </Button>
                ) : null,
            },
          ]}
        />
      )}
      <Dialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        size="sm"
        title={t('admin.configurations.revokeTitle')}
        description={t('admin.configurations.revokeBody')}
        footer={
          <>
            <Button variant="quiet" onClick={() => setRevoking(null)}>
              {t('staff.cancel')}
            </Button>
            <Button onClick={() => revoking && revoke.mutate(revoking)} loading={revoke.isPending}>
              {t('admin.configurations.revoke')}
            </Button>
          </>
        }
      />
    </Panel>
  );
}
