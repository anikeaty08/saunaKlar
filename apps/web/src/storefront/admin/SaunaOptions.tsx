import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { tenantQuery } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Badge } from '../../design/components/Badge.tsx';
import { Button } from '../../design/components/Button.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { minorToInput, parseMoney, useAdminMutation } from './helpers.ts';
import { OwnerOnlyNote, useCanManageShop } from './permissions.tsx';
import '../../design/components/Field.css';

type Settings = ResponseOf<'adminSaunaOptions'>;
type Option = Settings['groups'][number]['options'][number];
interface Draft { enabled: boolean; price: string; description: string }

const draftOf = (o: Option): Draft => ({
  enabled: o.enabled,
  price: o.priceOverrideMinor === null ? '' : minorToInput(o.priceOverrideMinor),
  description: o.descriptionOverride ?? '',
});
const same = (a: Draft, b: Draft) => a.enabled === b.enabled && a.price.trim() === b.price.trim() && a.description.trim() === b.description.trim();

/**
 * Per-sauna option settings: which options customers may choose, what they pay and how they are
 * described. Empty fields fall back to the manufacturer's values. The server re-checks every rule.
 */
export function SaunaOptionsAdmin() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const canEdit = useCanManageShop();
  const key = ['admin', 'saunas', id, 'options'];
  const q = useQuery({ queryKey: key, queryFn: () => api('adminSaunaOptions', { params: { id } }) });
  const saunas = useQuery({ queryKey: ['admin', 'saunas'], queryFn: () => api('adminSaunas') });
  const name = saunas.data?.items.find(s => s.id === id)?.name ?? '';
  useDocumentTitle(name ? t('admin.saunaOptions.title', { name }) : t('admin.nav.saunas'));
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [submitted, setSubmitted] = useState(false);

  const initial = useMemo(() => new Map((q.data?.groups ?? []).flatMap(g => g.options.map(o => [o.id, draftOf(o)] as const))), [q.data]);
  useEffect(() => {
    setDraft(Object.fromEntries(initial));
    setSubmitted(false);
  }, [initial]);

  const all = useMemo(() => new Map((q.data?.groups ?? []).flatMap(g => g.options.map(o => [o.id, o] as const))), [q.data]);
  const d = (o: Option) => draft[o.id] ?? draftOf(o);
  const edit = (o: Option, patch: Partial<Draft>) => setDraft(prev => ({ ...prev, [o.id]: { ...d(o), ...patch } }));

  // Client-side checks mirror the server's: amounts, required groups, requires rules.
  const priceError = (o: Option) => {
    const p = d(o).price.trim();
    return p && parseMoney(p) === null ? t('admin.saunaOptions.invalidPrice') : null;
  };
  const groupErrors = new Map<string, string>();
  for (const g of q.data?.groups ?? []) {
    if (g.required && g.options.every(o => !d(o).enabled)) groupErrors.set(g.id, t('admin.saunaOptions.requiredEmpty', { group: g.name }));
  }
  for (const r of q.data?.requires ?? []) {
    const a = all.get(r.optionId), b = all.get(r.requiredOptionId);
    if (a && b && d(a).enabled && !d(b).enabled) {
      const g = q.data!.groups.find(x => x.options.some(o => o.id === b.id))!;
      groupErrors.set(g.id, [groupErrors.get(g.id), t('admin.saunaOptions.requires', { option: a.name, required: b.name })].filter(Boolean).join(' '));
    }
  }
  const changed = [...all.values()].filter(o => !same(d(o), initial.get(o.id)!));
  const invalid = groupErrors.size > 0 || [...all.values()].some(o => priceError(o));

  const save = useAdminMutation(
    () => api('adminPutSaunaOptions', {
      params: { id },
      body: {
        options: changed.map(o => {
          const x = d(o);
          return { optionId: o.id, enabled: x.enabled, priceOverrideMinor: x.price.trim() ? parseMoney(x.price) : null, descriptionOverride: x.description.trim() || null };
        }),
      },
    }),
    {
      success: 'admin.saunaOptions.saved',
      onSuccess: data => {
        qc.setQueryData(key, data);
        void qc.invalidateQueries({ queryKey: tenantQuery.queryKey });
        void qc.invalidateQueries({ queryKey: ['admin', 'saunas'], exact: true });
      },
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!invalid && changed.length) save.mutate(undefined);
  };

  if (q.isPending) return <Skeleton lines={12} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const currency = q.data.currency;
  const actions = (
    <>
      <Button variant="quiet" disabled={!changed.length || save.isPending} onClick={() => setDraft(Object.fromEntries(initial))}>
        {t('admin.saunaOptions.reset')}
      </Button>
      <Button type="submit" form="sauna-options" loading={save.isPending} disabled={!changed.length}>
        {t('admin.saunaOptions.save')}
      </Button>
    </>
  );

  return (
    <>
      <PageHead
        title={name ? t('admin.saunaOptions.title', { name }) : t('admin.saunaOptions.titlePlain')}
        lede={t('admin.saunaOptions.lede', { currency })}
        crumbs={[{ label: t('admin.nav.saunas'), to: '/admin/saunas' }, { label: name || t('admin.saunaOptions.titlePlain') }]}
        actions={canEdit ? actions : undefined}
        meta={!canEdit ? <OwnerOnlyNote /> : changed.length ? <Badge tone="solid">{t('admin.saunaOptions.unsaved', { count: changed.length })}</Badge> : undefined}
      />
      <form id="sauna-options" onSubmit={submit} noValidate>
        <fieldset className="admin-fieldset" disabled={!canEdit}>
        {q.data.groups.map(g => {
          const err = groupErrors.get(g.id);
          const errId = `sauna-options-${g.id}-err`;
          return (
            <Panel key={g.id} title={g.name} lede={g.required ? t('admin.saunaOptions.required') : undefined}>
              {err && (
                <p className="field__error" id={errId} role="alert">
                  {err}
                </p>
              )}
              <div className="table-wrap">
                <table className="table">
                  <caption className="sr-only">{g.name}</caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('admin.saunaOptions.offered')}</th>
                      <th scope="col">{t('admin.saunaOptions.option')}</th>
                      <th scope="col" className="is-end">{t('admin.saunaOptions.basePrice')}</th>
                      <th scope="col" className="is-end">{t('admin.saunaOptions.yourPrice', { currency })}</th>
                      <th scope="col">{t('admin.saunaOptions.description')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.options.map(o => {
                      const x = d(o);
                      const pErr = priceError(o);
                      const pErrId = `sauna-options-${o.id}-price-err`;
                      return (
                        <tr key={o.id} className={x.enabled ? undefined : 'is-hidden'}>
                          <td>
                            <label className="switch">
                              <input
                                type="checkbox"
                                role="switch"
                                checked={x.enabled}
                                aria-describedby={err ? errId : undefined}
                                onChange={e => edit(o, { enabled: e.target.checked })}
                              />
                              <span className="switch__track" aria-hidden="true" />
                              <span className="sr-only">{t('admin.saunaOptions.offeredLabel', { name: o.name })}</span>
                            </label>
                          </td>
                          <th scope="row">
                            {o.name}
                            {o.isDefault && <> <Badge tone="dashed">{t('admin.saunaOptions.default')}</Badge></>}
                            <span className="staff-sub mono">{o.code}</span>
                          </th>
                          <td className="is-end mono">{fmt.money(o.basePriceMinor, currency)}</td>
                          <td className="is-end">
                            <div className="control">
                              <input
                                className="control__input mono"
                                inputMode="decimal"
                                placeholder={minorToInput(o.basePriceMinor)}
                                value={x.price}
                                aria-label={t('admin.saunaOptions.yourPriceLabel', { name: o.name, currency })}
                                aria-invalid={(submitted || x.price !== '') && pErr ? true : undefined}
                                aria-describedby={pErr ? pErrId : undefined}
                                onChange={e => edit(o, { price: e.target.value })}
                              />
                            </div>
                            {pErr && (
                              <p className="field__error" id={pErrId}>
                                {pErr}
                              </p>
                            )}
                          </td>
                          <td>
                            <div className="control">
                              <input
                                className="control__input"
                                maxLength={2000}
                                placeholder={o.description ?? ''}
                                value={x.description}
                                aria-label={t('admin.saunaOptions.descriptionLabel', { name: o.name })}
                                onChange={e => edit(o, { description: e.target.value })}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Panel>
          );
        })}
        </fieldset>
        <div className="staff-form__actions">
          <p className="staff-sub">{t('admin.saunaOptions.hint')}</p>
          {canEdit && actions}
        </div>
      </form>
    </>
  );
}
