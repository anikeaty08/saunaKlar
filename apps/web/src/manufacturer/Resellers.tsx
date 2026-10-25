import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink as ExternalIcon, Plus, Store, X } from 'lucide-react';
import { createResellerRequest, slug as slugSchema } from '@saunaklar/shared';
import { api, isApiError } from '../api/client.ts';
import { useT } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { errorText } from '../i18n/errorText.ts';
import { RESERVED_SLUGS, hostConfig } from '../host.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Table, type Column } from '../design/components/Table.tsx';
import { StatusBadge } from '../design/components/Badge.tsx';
import { Button } from '../design/components/Button.tsx';
import { Dialog } from '../design/components/Dialog.tsx';
import { Input, Select } from '../design/components/Field.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { toast } from '../design/components/Toast.tsx';
import { PageHead } from '../staff/index.ts';
import { CURRENCIES, keys, useResellers, type ResellerSummary } from './data.ts';
import { TableSkeletonRows } from './ui.tsx';

export function Resellers() {
  const { t } = useT();
  const fmt = useFormat();
  const navigate = useNavigate();
  useDocumentTitle(t('manufacturer.resellers'));
  const q = useResellers();
  const [creating, setCreating] = useState(false);

  const cols: Column<ResellerSummary>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: r => (
        <>
          <Link to={`/resellers/${r.id}`} className="staff-strong" onClick={e => e.stopPropagation()}>
            {r.name}
          </Link>
          <span className="staff-sub mono">{r.slug}</span>
        </>
      ),
      sortValue: r => r.name,
    },
    { key: 'status', header: t('staff.status'), cell: r => <StatusBadge status={r.status} />, sortValue: r => r.status },
    { key: 'currency', header: t('manufacturer.currency'), cell: r => <span className="mono">{r.currency}</span>, sortValue: r => r.currency, hideOnMobile: true },
    { key: 'saunas', header: t('manufacturer.saunasAssigned'), cell: r => <span className="mono">{fmt.number(r.saunasAssigned)}</span>, sortValue: r => r.saunasAssigned, align: 'end', hideOnMobile: true },
    { key: 'customers', header: t('manufacturer.customers'), cell: r => <span className="mono">{fmt.number(r.customers)}</span>, sortValue: r => r.customers, align: 'end' },
    { key: 'open', header: t('manufacturer.openRequests'), cell: r => <span className="mono">{fmt.number(r.openRequests)}</span>, sortValue: r => r.openRequests, align: 'end' },
    {
      key: 'storefront',
      header: t('manufacturer.storefront'),
      cell: r => (
        <a href={r.storefrontUrl} target="_blank" rel="noreferrer" className="mfr-ext" onClick={e => e.stopPropagation()}>
          {t('staff.viewStorefront')}
          <Icon icon={ExternalIcon} size="xs" />
        </a>
      ),
      align: 'end',
      hideOnMobile: true,
    },
  ];

  return (
    <>
      <PageHead
        title={t('manufacturer.resellers')}
        lede={t('manufacturer.resellersLede')}
        actions={
          <Button icon={Plus} onClick={() => setCreating(true)}>
            {t('manufacturer.newReseller')}
          </Button>
        }
      />
      <Table
        columns={cols}
        rows={q.data?.items ?? []}
        rowKey={r => r.id}
        loading={q.isPending}
        caption={t('manufacturer.resellers')}
        initialSort={{ key: 'name', dir: 'asc' }}
        onRowClick={r => navigate(`/resellers/${r.id}`)}
        empty={
          q.error ? (
            <EmptyState icon={Store} title={errorText(t, q.error)} action={<Button variant="ghost" onClick={() => void q.refetch()}>{t('common.retry')}</Button>} compact />
          ) : (
            <EmptyState icon={Store} title={t('manufacturer.noResellers')} body={t('manufacturer.noResellersBody')} action={<Button icon={Plus} onClick={() => setCreating(true)}>{t('manufacturer.newReseller')}</Button>} compact />
          )
        }
      />
      {q.isPending && <TableSkeletonRows />}
      <CreateResellerDialog open={creating} onClose={() => setCreating(false)} taken={new Set(q.data?.items.map(r => r.slug))} />
    </>
  );
}

type SlugState = { ok: true } | { ok: false; message: string } | null;

function CreateResellerDialog({ open, onClose, taken }: { open: boolean; onClose: () => void; taken: Set<string> }) {
  const { t } = useT();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [f, setF] = useState({ slug: '', name: '', currencyCode: 'EUR', email: '', displayName: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));

  const slugState: SlugState = useMemo(() => {
    const s = f.slug.trim();
    if (!s) return null;
    if (!slugSchema.safeParse(s).success) return { ok: false, message: t('manufacturer.slugInvalid') };
    if (RESERVED_SLUGS.has(s)) return { ok: false, message: t('manufacturer.slugReserved', { slug: s }) };
    if (taken.has(s)) return { ok: false, message: t('manufacturer.slugTaken', { slug: s }) };
    return { ok: true };
  }, [f.slug, taken, t]);

  const close = () => {
    setF({ slug: '', name: '', currencyCode: 'EUR', email: '', displayName: '' });
    setErrors({});
    setFormError(null);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = createResellerRequest.safeParse({ slug: f.slug.trim(), name: f.name, currencyCode: f.currencyCode, owner: { email: f.email, displayName: f.displayName } });
    const errs: Record<string, string> = {};
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        const k = i.path.join('.');
        errs[k] ??= k === 'owner.email' ? t('validation.email') : k === 'slug' ? t('manufacturer.slugInvalid') : t('validation.required');
      }
    }
    if (slugState && !slugState.ok) errs.slug = slugState.message;
    setErrors(errs);
    if (!parsed.success || Object.keys(errs).length) return;
    setBusy(true);
    try {
      const r = await api('mCreateReseller', { body: parsed.data });
      qc.setQueryData(keys.reseller(r.id), r);
      await qc.invalidateQueries({ queryKey: keys.resellers });
      toast(t('manufacturer.created'), r.name);
      close();
      navigate(`/resellers/${r.id}`);
    } catch (err) {
      if (isApiError(err)) {
        const fe: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fieldErrors)) fe[k] = v[0] ?? '';
        if (err.code === 'SLUG_RESERVED') fe.slug = t('manufacturer.slugReserved', { slug: f.slug.trim() });
        if (err.code === 'CONFLICT') fe.slug = t('manufacturer.slugTaken', { slug: f.slug.trim() });
        setErrors(fe);
      }
      setFormError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const domain = hostConfig().platformDomain;
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('manufacturer.newReseller')}
      description={t('manufacturer.newResellerLede', { slug: f.slug.trim() || 'name', domain })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="mfr-create" loading={busy} icon={Plus}>
            {t('staff.create')}
          </Button>
        </>
      }
    >
      <form id="mfr-create" className="staff-form" onSubmit={e => void submit(e)} noValidate>
        {formError && (
          <p className="staff-login__error" role="alert">
            {formError}
          </p>
        )}
        <div className="mfr-slug">
          <Input
            label={t('manufacturer.slug')}
            required
            autoComplete="off"
            spellCheck={false}
            value={f.slug}
            onChange={e => setF(s => ({ ...s, slug: e.target.value.toLowerCase() }))}
            hint={t('manufacturer.slugHint')}
            error={errors.slug ?? (slugState && !slugState.ok ? slugState.message : null)}
          />
          <p className="mfr-slug__preview mono" aria-live="polite">
            {slugState?.ok && <Icon icon={Check} size="xs" />}
            {slugState && !slugState.ok && <Icon icon={X} size="xs" />}
            {(f.slug.trim() || '…') + '.' + domain}
          </p>
        </div>
        <Input label={t('staff.name')} required value={f.name} onChange={set('name')} error={errors.name} />
        <Select label={t('manufacturer.currency')} required value={f.currencyCode} onChange={set('currencyCode')} options={CURRENCIES.map(c => ({ value: c, label: c }))} hint={t('manufacturer.currencyHint')} />
        <div className="staff-form__row">
          <Input label={t('manufacturer.ownerEmail')} type="email" required autoComplete="off" value={f.email} onChange={set('email')} error={errors['owner.email']} />
          <Input label={t('manufacturer.ownerName')} required autoComplete="off" value={f.displayName} onChange={set('displayName')} error={errors['owner.displayName']} />
        </div>
      </form>
    </Dialog>
  );
}
