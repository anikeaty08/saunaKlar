import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ImageUp } from 'lucide-react';
import { UPLOAD_LIMITS, type ResponseOf } from '@saunaklar/shared';
import { api, isApiError } from '../../api/client.ts';
import { tenantQuery, useTenantData } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { errorText } from '../../i18n/errorText.ts';
import { applyTheme, deriveTheme } from '../../design/theme.ts';
import { Button } from '../../design/components/Button.tsx';
import { Input, Select, Textarea } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useAdminMutation } from './helpers.ts';
import { LayoutPicker } from './LayoutPicker.tsx';
import { isLayoutId } from '../layouts/registry.ts';

type Branding = ResponseOf<'adminBranding'>;
type Kind = 'LOGO' | 'FAVICON';
const HEX = /^#[0-9a-f]{6}$/i;

export function BrandingAdmin() {
  const { t } = useT();
  useDocumentTitle(t('admin.nav.branding'));
  const q = useQuery({ queryKey: ['admin', 'branding'], queryFn: () => api('adminBranding') });
  if (q.isPending) return <Skeleton lines={10} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  return <BrandingForm branding={q.data} />;
}

function BrandingForm({ branding }: { branding: Branding }) {
  const { t } = useT();
  const qc = useQueryClient();
  const tenant = useTenantData();
  const [draft, setDraft] = useState(branding);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => setDraft(branding), [branding]);
  const set = <K extends keyof Branding>(k: K, v: Branding[K]) => setDraft(d => ({ ...d, [k]: v }));

  // Live preview: the whole admin takes the colour while it is edited, and
  // returns to the saved one when leaving the page.
  useEffect(() => {
    if (HEX.test(draft.primaryColor)) applyTheme(draft.primaryColor);
  }, [draft.primaryColor]);
  useEffect(() => () => void applyTheme(qc.getQueryData<typeof tenant>(tenantQuery.queryKey)?.branding.primaryColor ?? tenant.branding.primaryColor), [qc, tenant]);

  const settle = (b: Branding) => {
    qc.setQueryData(['admin', 'branding'], b);
    void qc.invalidateQueries({ queryKey: tenantQuery.queryKey });
  };
  const save = useAdminMutation((body: Parameters<typeof api<'adminPatchBranding'>>[1] extends { body: infer B } ? B : never) => api('adminPatchBranding', { body }), {
    success: 'admin.branding.saved',
    onSuccess: settle,
  });
  const nil = (s: string | null) => (s && s.trim() ? s.trim() : null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!draft.displayName.trim()) errs.displayName = t('validation.required');
    if (!HEX.test(draft.primaryColor)) errs.primaryColor = t('validation.required');
    if (draft.supportEmail && !/^\S+@\S+\.\S+$/.test(draft.supportEmail)) errs.supportEmail = t('validation.email');
    setErrors(errs);
    if (Object.keys(errs).length) return;
    save.mutate(
      {
        displayName: draft.displayName.trim(),
        tagline: nil(draft.tagline),
        primaryColor: draft.primaryColor.toLowerCase(),
        supportEmail: nil(draft.supportEmail),
        supportPhone: nil(draft.supportPhone),
        legalName: nil(draft.legalName),
        legalAddress: nil(draft.legalAddress),
        vatDisplay: draft.vatDisplay,
        storefrontLayout: draft.storefrontLayout,
      },
      {
        onError: err => {
          if (isApiError(err)) setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])));
        },
      },
    );
  };
  const theme = HEX.test(draft.primaryColor) ? deriveTheme(draft.primaryColor) : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(branding);

  return (
    <>
      <PageHead
        title={t('admin.nav.branding')}
        lede={t('admin.branding.lede')}
        actions={
          <Button type="submit" form="branding-form" loading={save.isPending} disabled={!dirty}>
            {t('staff.save')}
          </Button>
        }
        meta={dirty ? <span className="mono">{t('staff.unsaved')}</span> : undefined}
      />
      <div className="staff-grid staff-grid--main-side">
        <form id="branding-form" onSubmit={submit} noValidate>
          <Panel title={t('admin.branding.identity')}>
            <div className="staff-form">
              <Input label={t('admin.branding.displayName')} value={draft.displayName} onChange={e => set('displayName', e.target.value)} maxLength={120} required error={errors.displayName} />
              <Input label={t('admin.branding.tagline')} value={draft.tagline ?? ''} onChange={e => set('tagline', e.target.value)} maxLength={200} error={errors.tagline} />
              <div className="color-field">
                <Input label={t('admin.branding.color')} hint={t('admin.branding.colorHint')} value={draft.primaryColor} onChange={e => set('primaryColor', e.target.value)} maxLength={7} spellCheck={false} required error={errors.primaryColor} className="color-field__hex" />
                <input type="color" aria-label={t('admin.branding.color')} value={HEX.test(draft.primaryColor) ? draft.primaryColor : '#000000'} onChange={e => set('primaryColor', e.target.value)} className="color-field__picker" />
              </div>
            </div>
          </Panel>
          <Panel title={t('admin.branding.layout')} lede={t('admin.branding.layoutHint')}>
            <LayoutPicker value={isLayoutId(draft.storefrontLayout) ? draft.storefrontLayout : 'atelier'} color={HEX.test(draft.primaryColor) ? draft.primaryColor : '#5a6b7b'} onChange={id => set('storefrontLayout', id)} />
          </Panel>
          <Panel title={t('admin.branding.contactTitle')}>
            <div className="staff-form">
              <div className="staff-form__row">
                <Input label={t('admin.branding.supportEmail')} type="email" value={draft.supportEmail ?? ''} onChange={e => set('supportEmail', e.target.value)} error={errors.supportEmail} />
                <Input label={t('admin.branding.supportPhone')} type="tel" value={draft.supportPhone ?? ''} onChange={e => set('supportPhone', e.target.value)} maxLength={40} error={errors.supportPhone} />
              </div>
              <Input label={t('admin.branding.legalName')} value={draft.legalName ?? ''} onChange={e => set('legalName', e.target.value)} maxLength={200} error={errors.legalName} />
              <Textarea label={t('admin.branding.legalAddress')} rows={3} value={draft.legalAddress ?? ''} onChange={e => set('legalAddress', e.target.value)} maxLength={500} error={errors.legalAddress} />
              <Select
                label={t('admin.branding.vatDisplay')}
                value={draft.vatDisplay}
                onChange={e => set('vatDisplay', e.target.value as Branding['vatDisplay'])}
                options={(['INCLUDED', 'EXCLUDED', 'NONE'] as const).map(v => ({ value: v, label: t(`admin.branding.vat.${v}` as TKey) }))}
              />
            </div>
          </Panel>
        </form>
        <div className="admin-side">
          <Panel title={t('admin.branding.preview')}>
            <div className="brand-preview">
              <div className="brand-preview__bar">
                {branding.logoUrl ? <img src={branding.logoUrl} alt="" height={24} /> : <span className="brand-preview__name">{draft.displayName}</span>}
              </div>
              <p className="brand-preview__tag">{draft.tagline}</p>
              {theme && (
                <ol className="brand-preview__ramp" aria-hidden="true">
                  {(['--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5', '--ink-6', '--paper-3', '--paper-2', '--paper'] as const).map(k => (
                    <li key={k} style={{ background: theme.light[k] }} title={`${k} ${theme.light[k]}`} />
                  ))}
                </ol>
              )}
              <span className="brand-preview__button">{t('detail.configure')}</span>
            </div>
          </Panel>
          <Upload kind="LOGO" current={branding.logoUrl} onDone={settle} />
          <Upload kind="FAVICON" current={branding.faviconUrl} onDone={settle} />
        </div>
      </div>
    </>
  );
}

/** Presigned upload: create → PUT straight to storage → complete. */
function Upload({ kind, current, onDone }: { kind: Kind; current: string | null; onDone: (b: Branding) => void }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const limits = UPLOAD_LIMITS[kind];
  const label = kind === 'LOGO' ? t('admin.branding.logo') : t('admin.branding.favicon');

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!(limits.contentTypes as readonly string[]).includes(file.type)) return toast.error(label, t('admin.branding.wrongType'));
    if (file.size > limits.maxBytes) return toast.error(label, t('admin.branding.tooLarge'));
    setBusy(true);
    try {
      const up = await api('adminCreateUpload', { body: { kind, contentType: file.type, byteSize: file.size } });
      const res = await fetch(up.url, { method: 'PUT', headers: { 'Content-Type': file.type, ...up.headers }, body: file });
      if (!res.ok) throw new Error(`upload failed: ${res.status}`);
      onDone(await api('adminCompleteUpload', { params: { uploadId: up.uploadId } }));
      toast(t('admin.branding.uploaded'));
    } catch (e) {
      toast.error(label, errorText(t, e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <Panel title={label} lede={kind === 'LOGO' ? t('admin.branding.logoHint') : t('admin.branding.faviconHint')}>
      <div className={`upload upload--${kind.toLowerCase()}`}>
        <span className="upload__preview">{current ? <img src={current} alt={label} /> : <Icon icon={ImageUp} size="lg" />}</span>
        <input ref={input} type="file" accept={limits.contentTypes.join(',')} className="sr-only" tabIndex={-1} onChange={e => void pick(e.target.files?.[0])} />
        <Button variant="ghost" size="sm" icon={ImageUp} loading={busy} onClick={() => input.current?.click()}>
          {busy ? t('admin.branding.uploading') : current ? t('admin.branding.replace') : t('admin.branding.upload')}
        </Button>
      </div>
    </Panel>
  );
}
