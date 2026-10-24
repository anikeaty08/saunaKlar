import { useEffect, useState, type KeyboardEvent } from 'react';
import { useParams } from 'react-router';
import { useT, type TKey } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { errorText } from '../i18n/errorText.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Badge } from '../design/components/Badge.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { toast } from '../design/components/Toast.tsx';
import { PageHead, Panel } from '../staff/index.ts';
import { CURRENCIES, useSaunaDetail, useSavePrice, type SaunaDetail as Detail } from './data.ts';
import { MODEL_TONE, PageSkeleton, parseMajor, parsePercent, toMajor } from './ui.tsx';

export function SaunaDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const q = useSaunaDetail(id);
  useDocumentTitle(q.data?.name ?? t('manufacturer.saunas'));
  if (q.isPending) return <PageSkeleton />;
  if (q.error) return <ErrorPage error={q.error} />;
  const s = q.data;
  return (
    <>
      <PageHead
        crumbs={[{ label: t('manufacturer.saunas'), to: '/saunas' }, { label: s.name }]}
        title={s.name}
        meta={
          <>
            <Badge tone={MODEL_TONE[s.status]}>{t(`manufacturer.modelStatus.${s.status}` as TKey)}</Badge>
            <span className="mono staff-muted">
              {t('manufacturer.sku')} {s.sku}
            </span>
            <span className="staff-muted">{t('manufacturer.resellersAssigned', { count: s.resellersAssigned })}</span>
          </>
        }
      />
      <div className="staff-grid">
        <ModelPrices sauna={s} />
        <OptionPrices sauna={s} />
      </div>
    </>
  );
}

/** One editable cell: shows the stored value, commits on Enter or blur, Esc restores. */
function EditCell({
  value,
  label,
  parse,
  display,
  onCommit,
  suffix,
}: {
  value: number | null;
  label: string;
  parse: (s: string) => number | null;
  display: (n: number) => string;
  onCommit: (n: number) => void;
  suffix?: string;
}) {
  const { t } = useT();
  const shown = value === null ? '' : display(value);
  const [draft, setDraft] = useState(shown);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(shown);
    setInvalid(false);
  }, [shown]);

  const commit = () => {
    if (draft === shown) return setInvalid(false);
    const n = parse(draft);
    if (n === null) return setInvalid(true);
    setInvalid(false);
    if (n !== value) onCommit(n);
    else setDraft(shown);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
    } else if (e.key === 'Escape') {
      setDraft(shown);
      setInvalid(false);
    }
  };
  return (
    <span className={['mfr-cell', invalid && 'is-invalid', value === null && 'is-empty'].filter(Boolean).join(' ')}>
      <input
        className="mfr-cell__input mono"
        inputMode="decimal"
        aria-label={label}
        aria-invalid={invalid || undefined}
        placeholder={value === null ? t('manufacturer.noPrice') : undefined}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKey}
        onFocus={e => e.target.select()}
      />
      {suffix && <span className="mfr-cell__suffix mono" aria-hidden="true">{suffix}</span>}
    </span>
  );
}

function ModelPrices({ sauna: s }: { sauna: Detail }) {
  const { t } = useT();
  const fmt = useFormat();
  const save = useSavePrice(s.id);
  const onError = (e: unknown) => toast.error(t('manufacturer.priceFailed'), errorText(t, e));
  const onSuccess = () => toast(t('manufacturer.priceSaved'));
  return (
    <Panel title={t('manufacturer.prices')} lede={t('manufacturer.pricesLede')}>
      <div className="table-wrap">
        <table className="table mfr-grid">
          <caption className="sr-only">{t('manufacturer.prices')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('manufacturer.currency')}</th>
              <th scope="col" className="is-end">{t('manufacturer.listPrice')}</th>
              <th scope="col" className="is-end">{t('manufacturer.maxDiscount')}</th>
              <th scope="col" className="is-end hide-sm">{t('manufacturer.lowestPrice')}</th>
            </tr>
          </thead>
          <tbody>
            {CURRENCIES.map(c => {
              const p = s.prices.find(x => x.currency === c) ?? null;
              const commit = (listPriceMinor: number, maxDiscountBps: number) =>
                save.mutate({ kind: 'model', currency: c, listPriceMinor, maxDiscountBps }, { onError, onSuccess });
              return (
                <tr key={c}>
                  <th scope="row" className="mono">{c}</th>
                  <td className="is-end">
                    <EditCell value={p?.listPriceMinor ?? null} label={`${t('manufacturer.listPrice')} ${c}`} parse={parseMajor} display={toMajor} suffix={c} onCommit={n => commit(n, p?.maxDiscountBps ?? 0)} />
                  </td>
                  <td className="is-end">
                    {p ? (
                      <EditCell value={p.maxDiscountBps} label={`${t('manufacturer.maxDiscount')} ${c}`} parse={parsePercent} display={bps => String(bps / 100)} suffix="%" onCommit={n => commit(p.listPriceMinor, n)} />
                    ) : (
                      <span className="staff-muted">—</span>
                    )}
                  </td>
                  <td className="is-end hide-sm mono staff-muted">{p ? fmt.money(p.listPriceMinor - Math.floor((p.listPriceMinor * p.maxDiscountBps) / 10_000), c) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function OptionPrices({ sauna: s }: { sauna: Detail }) {
  const { t } = useT();
  const save = useSavePrice(s.id);
  const onError = (e: unknown) => toast.error(t('manufacturer.priceFailed'), errorText(t, e));
  const onSuccess = () => toast(t('manufacturer.priceSaved'));
  if (s.groups.length === 0)
    return (
      <Panel title={t('manufacturer.optionPrices')}>
        <EmptyState title={t('manufacturer.noOptions')} compact />
      </Panel>
    );
  return (
    <Panel title={t('manufacturer.optionPrices')} lede={t('manufacturer.optionPricesLede')}>
      <div className="table-wrap">
        <table className="table mfr-grid">
          <caption className="sr-only">{t('manufacturer.optionPrices')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('manufacturer.option')}</th>
              {CURRENCIES.map(c => (
                <th key={c} scope="col" className="is-end">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          {s.groups.map(g => (
            <tbody key={g.id}>
              <tr className="mfr-grid__group">
                <th scope="colgroup" colSpan={CURRENCIES.length + 1}>
                  {g.name}
                  <span className="staff-sub">
                    {t(g.selectionType === 'SINGLE' ? 'manufacturer.single' : 'manufacturer.multi')}
                    {g.required ? ` · ${t('common.required')}` : ''}
                  </span>
                </th>
              </tr>
              {g.options.map(o => (
                <tr key={o.id}>
                  <th scope="row">
                    {o.name}
                    <span className="staff-sub mono">{o.code}</span>
                  </th>
                  {CURRENCIES.map(c => (
                    <td key={c} className="is-end">
                      <EditCell
                        value={o.prices.find(p => p.currency === c)?.priceDeltaMinor ?? null}
                        label={`${o.name} ${c}`}
                        parse={parseMajor}
                        display={toMajor}
                        onCommit={n => save.mutate({ kind: 'option', currency: c, optionId: o.id, priceDeltaMinor: n }, { onError, onSuccess })}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </Panel>
  );
}
