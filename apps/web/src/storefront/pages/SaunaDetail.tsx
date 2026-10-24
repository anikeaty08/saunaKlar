import { useMemo } from 'react';
import { useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Lock } from 'lucide-react';
import { useSauna, useSession, useTenantData } from '../../api/queries.ts';
import { isApiError } from '../../api/client.ts';
import type { SaunaDetail as Sauna } from '../../api/types.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Reveal } from '../../motion/Reveal.tsx';
import { Magnetic } from '../../motion/Magnetic.tsx';
import { Breadcrumbs } from '../../design/components/Breadcrumbs.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Badge } from '../../design/components/Badge.tsx';
import { Swatch } from '../../design/components/Swatch.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { SectionHeading } from '../../design/components/SectionHeading.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { ArButton } from '../../three/ArButton.tsx';
import { specsOf } from '../components/specs.ts';
import { defaultSelectionOf, viewerOptionsOf } from '../components/sauna-helpers.ts';
import './SaunaDetail.css';

function SpecTable({ sauna }: { sauna: Sauna }) {
  const fmt = useFormat();
  return (
    <dl className="kv">
      {sauna.attributes
        .filter(a => a.code !== 'form')
        .map(a => {
          let v: string;
          if (typeof a.value === 'number') v = a.unit === 'mm' ? fmt.mm(a.value, 'mm') : `${fmt.number(a.value)}${a.unit ? ` ${a.unit}` : ''}`;
          else if (typeof a.value === 'boolean') v = a.value ? '✓' : '—';
          else v = a.value;
          return (
            <div key={a.code} style={{ display: 'contents' }}>
              <dt>{a.label}</dt>
              <dd>{v}</dd>
            </div>
          );
        })}
    </dl>
  );
}

function OptionList({ sauna, currency }: { sauna: Sauna; currency: string }) {
  const { t } = useT();
  const fmt = useFormat();
  const names = useMemo(() => new Map(sauna.groups.flatMap(g => g.options.map(o => [o.id, o.name] as const))), [sauna]);
  const notes = (id: string) => [
    ...sauna.rules.requires.filter(r => r.optionId === id).map(r => t('detail.requires', { option: names.get(r.requiredOptionId) ?? '' })),
    ...sauna.rules.excludes.filter(x => x.optionAId === id || x.optionBId === id).map(x => t('detail.excludes', { option: names.get(x.optionAId === id ? x.optionBId : x.optionAId) ?? '' })),
  ];
  return (
    <Reveal className="optlist" stagger={0.05}>
      {sauna.groups.map((g, gi) => (
        <section key={g.id} className="optgroup" aria-labelledby={`g-${g.id}`}>
          <header className="optgroup__head">
            <span className="mono optgroup__num">{String(gi + 1).padStart(2, '0')}</span>
            <h3 id={`g-${g.id}`}>{g.name}</h3>
            <span className="optgroup__rule">
              {g.selectionType === 'SINGLE' ? t('detail.chooseOne') : t('detail.chooseAny')}
              {g.required && <Badge tone="outline">{t('detail.required')}</Badge>}
            </span>
          </header>
          <ul>
            {g.options.map(o => {
              const n = notes(o.id);
              return (
                <li key={o.id} className="opt">
                  {o.swatchColor ? <Swatch as="chip" color={o.swatchColor} label={o.name} size="sm" /> : <span className="opt__dot" aria-hidden="true" />}
                  <span className="opt__text">
                    <span className="opt__name">
                      {o.name}
                      {o.isDefault && <span className="opt__default mono">{t('common.included')}</span>}
                    </span>
                    {o.description && <span className="opt__desc">{o.description}</span>}
                    {n.length > 0 && <span className="opt__rule mono">{n.join(' · ')}</span>}
                  </span>
                  <span className="opt__price mono">{o.priceDeltaMinor === 0 ? t('common.included') : `+ ${fmt.money(o.priceDeltaMinor, currency)}`}</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <p className="muted optlist__note">{t('detail.rulesNote')}</p>
    </Reveal>
  );
}

function DetailSkeleton() {
  return (
    <div className="page container" aria-hidden="true">
      <Skeleton width="12rem" height="0.8rem" />
      <div className="detail">
        <Skeleton className="detail__stage" height="auto" style={{ aspectRatio: '4 / 3.2' }} />
        <div className="detail__aside">
          <Skeleton width="40%" height="0.8rem" />
          <Skeleton width="90%" height="4rem" style={{ marginTop: '1rem' }} />
          <Skeleton lines={4} style={{ marginTop: '2rem' }} />
          <Skeleton width="60%" height="3rem" style={{ marginTop: '2rem' }} />
        </div>
      </div>
    </div>
  );
}

export default function SaunaDetail() {
  const { slug = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const sauna = useSauna(slug);
  const session = useSession().data;
  useDocumentTitle(sauna.data?.name);

  if (sauna.isPending) return <DetailSkeleton />;
  if (sauna.error) {
    if (isApiError(sauna.error, 'SAUNA_NOT_OFFERED') || isApiError(sauna.error, 'NOT_FOUND')) {
      return (
        <div className="page container">
          <EmptyState
            title={t('detail.notFoundTitle')}
            body={t('detail.notFoundBody')}
            action={
              <ButtonLink to="/saunas" icon={ArrowLeft} variant="ghost">
                {t('detail.back')}
              </ButtonLink>
            }
          />
        </div>
      );
    }
    return <ErrorPage error={sauna.error} onRetry={() => void sauna.refetch()} />;
  }

  const s = sauna.data;
  const specs = specsOf(s);
  const currency = tenant.currency;
  const saving = s.listPriceMinor - s.priceFromMinor;
  const signedIn = session?.kind === 'customer';
  const configureTo = `/saunas/${s.slug}/configure`;
  const defaults = defaultSelectionOf(s);

  return (
    <div className="page container">
      <Breadcrumbs items={[{ label: t('nav.home'), to: '/' }, { label: t('nav.saunas'), to: '/saunas' }, { label: s.name }]} />
      <div className="detail">
        <div className="detail__stage">
          <ViewerSlot
            name={s.name}
            specs={specs}
            lowUrl={s.assets.lowGlbUrl}
            highUrl={s.assets.highGlbUrl}
            allowHigh={signedIn}
            thumbnailUrl={s.assets.thumbnailUrl}
            options={viewerOptionsOf(s, defaults)}
          />
          {s.assets.hasAr && (
            <div className="detail__ar">
              <ArButton saunaModelId={s.id} name={s.name} enabled={signedIn} />
            </div>
          )}
        </div>

        <aside className="detail__aside">
          <div className="detail__sticky">
            <p className="eyebrow">
              {s.sku} · {t('saunas.seats', { count: specs.persons })}
            </p>
            <ScrambleText as="h1" className="detail__title" text={s.name} />
            {s.description && <p className="detail__desc">{s.description}</p>}
            <p className="detail__dims mono">{t('saunas.dimensions', { w: fmt.mm(specs.widthMm), d: fmt.mm(specs.depthMm), h: fmt.mm(specs.heightMm) })}</p>

            <div className="pricecard">
              <div className="pricecard__row">
                <Price minor={s.priceFromMinor} currency={currency} listMinor={saving > 0 ? s.listPriceMinor : null} size="lg" label={t('detail.priceFrom')} />
                {s.discount && saving > 0 && (
                  <Badge tone="solid">
                    {s.discount.type === 'PERCENT' ? t('detail.discountPercent', { percent: fmt.percentBps(s.discount.value) }) : t('detail.youSave', { amount: fmt.money(saving, currency) })}
                  </Badge>
                )}
              </div>
              {saving > 0 && <p className="pricecard__save mono">{t('detail.youSave', { amount: fmt.money(saving, currency) })}</p>}
              <p className="pricecard__vat">{t(`vat.${tenant.branding.vatDisplay}`)}</p>
              <Magnetic className="pricecard__cta">
                <ButtonLink to={signedIn ? configureTo : `/account/login?next=${encodeURIComponent(configureTo)}`} size="lg" block icon={signedIn ? undefined : Lock} iconAfter={ArrowRight}>
                  {signedIn ? t('detail.configure') : t('detail.loginToConfigure')}
                </ButtonLink>
              </Magnetic>
              {!signedIn && <p className="pricecard__hint">{t('detail.loginHint')}</p>}
              <p className="pricecard__hint">
                <Icon icon={ArrowRight} size="xs" /> {t('detail.delivery', { name: tenant.branding.displayName })}
              </p>
            </div>
          </div>
        </aside>
      </div>

      <section className="section">
        <SectionHeading index="01" title={t('detail.specs')} size="md" />
        <SpecTable sauna={s} />
      </section>

      <section className="section">
        <SectionHeading index="02" title={t('detail.options')} lede={t('detail.optionsLede')} size="md" />
        <OptionList sauna={s} currency={currency} />
      </section>
    </div>
  );
}
