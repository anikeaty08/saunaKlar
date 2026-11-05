import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, Box, Check, Info, Lock, Mail, MessageCircle, RotateCcw, SlidersHorizontal, Sparkles } from 'lucide-react';
import { toggle } from '@saunaklar/rules';
import { useCatalog, useSauna, useSession, useTenantData } from '../../api/queries.ts';
import { isApiError } from '../../api/client.ts';
import type { SaunaDetail as Sauna } from '../../api/types.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { Breadcrumbs } from '../../design/components/Breadcrumbs.tsx';
import { Button, ButtonLink } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Badge } from '../../design/components/Badge.tsx';
import { ExternalLink, TextLink } from '../../design/components/TextLink.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { SectionHeading } from '../../design/components/SectionHeading.tsx';
import { ClampText } from '../../design/components/ClampText.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ArButton } from '../../three/ArButton.tsx';
import { preloadViewer, preloadViewerWhenIdle } from '../../three/preload.ts';
import { configuredSpecsOf, specsOf } from '../components/specs.ts';
import { defaultSelectionOf, rulesOf } from '../components/sauna-helpers.ts';
import { deltaAgainstCurrent, isSizeGroup, previewPrice } from '../components/product-preview.ts';
import { PhotoGallery, type GalleryPhoto } from '../components/PhotoGallery.tsx';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import { SaunaCard, SaunaGrid } from '../components/SaunaCard.tsx';
import './SaunaDetail.css';

type SpecGroup = 'size' | 'seating' | 'technical';
const SPEC_GROUP: Record<string, SpecGroup> = {
  width_mm: 'size', depth_mm: 'size', height_mm: 'size',
  capacity_persons: 'seating', bench_levels: 'seating', placement: 'seating',
};

/** Groups whose standard option is worth naming among the key features. */
const FEATURE_GROUPS = ['wood', 'heater', 'door'];

type Group = Sauna['groups'][number];
type Option = Group['options'][number];

/** Specifications in three labelled groups (dimensions, seating, technical), each a label/value list. */
function Specs({ sauna }: { sauna: Sauna }) {
  const { t } = useT();
  const fmt = useFormat();
  const s = specsOf(sauna);
  const value = (a: Sauna['attributes'][number]): string => {
    if (typeof a.value === 'boolean') return a.value ? '✓' : '—';
    if (typeof a.value !== 'number') return a.value;
    if (a.unit === 'mm') return fmt.mm(a.value, 'mm');
    // "persons" reads as a count next to the "Seats" label; other units follow the number.
    if (!a.unit || a.unit === 'persons') return fmt.number(a.value);
    return `${fmt.number(a.value)} ${a.unit}`;
  };
  const rows: Record<SpecGroup, [string, string][]> = { size: [], seating: [], technical: [] };
  for (const a of sauna.attributes) {
    if (a.code === 'form' || a.code === 'model_source') continue;
    rows[SPEC_GROUP[a.code] ?? 'technical'].push([a.label, value(a)]);
  }
  const placement = [s.indoor && t('saunas.placementIndoor'), s.outdoor && t('saunas.placementOutdoor')].filter(Boolean).join(', ');
  if (placement) rows.seating.push([t('detail.factPlacement'), placement]);
  if (s.widthMm && s.depthMm) rows.size.push([t('detail.factFootprint'), `${fmt.number(Math.round(s.footprintM2 * 10) / 10)} m²`]);
  return (
    <div className="specs">
      {(['size', 'seating', 'technical'] as const)
        .filter(g => rows[g].length > 0)
        .map(g => (
          <section key={g} className="specs__group" aria-labelledby={`spec-${g}`}>
            <h3 id={`spec-${g}`} className="specs__title">
              {t(`detail.specGroups.${g}`)}
            </h3>
            <dl className="specs__list">
              {rows[g].map(([k, v]) => (
                <div key={k} className="specs__row">
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
    </div>
  );
}

/** First sentence as a short headline, the rest as the paragraph. */
function splitLead(text: string): [string, string] {
  const m = /^(.+?[.!?])\s+(\S[\s\S]*)$/.exec(text.trim());
  return m && m[1]!.length <= 160 ? [m[1]!, m[2]!] : [text.trim(), ''];
}

const defaultOf = (g: Group | undefined): Option | undefined => g?.options.find(o => o.isDefault) ?? (g?.required ? g.options[0] : undefined);

/** Key features from the model's own data: seats, size, placement, heater and the standard wood/heater/door. */
function useFeatures(sauna: Sauna): string[] {
  const { t } = useT();
  const fmt = useFormat();
  const s = specsOf(sauna);
  const placement = [s.indoor && t('saunas.placementIndoor'), s.outdoor && t('saunas.placementOutdoor')].filter(Boolean).join(' · ');
  const bench = sauna.attributes.find(a => a.code === 'bench_levels');
  const out = [
    `${t('detail.factSeats')}: ${t('saunas.seats', { count: s.persons })}`,
    `${t('detail.factSize')}: ${t('saunas.dimensions', { w: fmt.mm(s.widthMm), d: fmt.mm(s.depthMm), h: fmt.mm(s.heightMm) })}`,
  ];
  if (bench && typeof bench.value === 'number') out.push(`${bench.label}: ${fmt.number(bench.value)}`);
  if (placement) out.push(`${t('detail.factPlacement')}: ${placement}`);
  if (s.heaterKw > 0) out.push(`${t('detail.factHeater')}: ${fmt.number(s.heaterKw)} kW`);
  for (const code of FEATURE_GROUPS) {
    const g = sauna.groups.find(x => x.code === code);
    const o = defaultOf(g);
    if (g && o) out.push(t('detail.featureStandard', { group: g.name, option: o.name }));
  }
  return out;
}

/** Inline size selector: one row of choices per dimension group, with the price difference to the current choice. */
function SizeSelector({ groups, selection, currency, onPick }: { groups: Group[]; selection: string[]; currency: string; onPick: (id: string) => void }) {
  const { t } = useT();
  const fmt = useFormat();
  if (groups.length === 0) return null;
  return (
    <div className="psize">
      {groups.map(g => (
        <fieldset key={g.id} className="psize__group">
          <legend className="psize__label">{g.name}</legend>
          <div className="psize__opts">
            {g.options.map(o => {
              const on = selection.includes(o.id);
              const d = deltaAgainstCurrent(g, selection, o.id);
              return (
                <label key={o.id} className={['psize__opt', on && 'is-on'].filter(Boolean).join(' ')}>
                  <input type="radio" name={`size-${g.id}`} checked={on} onChange={() => onPick(o.id)} className="psize__input" />
                  <span className="psize__name">{o.name}</span>
                  {!on && d !== 0 && <span className={['psize__delta mono', d < 0 && 'is-less'].filter(Boolean).join(' ')}>{d > 0 ? `+${fmt.money(d, currency)}` : `−${fmt.money(-d, currency)}`}</span>}
                  {on && <Icon icon={Check} size="xs" className="psize__check" />}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}
      <p className="psize__note">{t('detail.sizeNote')}</p>
    </div>
  );
}

/** Option cards per group: pick to preview the price. Only the reseller's options, at its prices. */
function OptionGroups({
  sauna, groups, selection, currency, onPick, customiseTo,
}: { sauna: Sauna; groups: Group[]; selection: string[]; currency: string; onPick: (id: string, on: boolean) => void; customiseTo: ((code: string) => string) | null }) {
  const { t } = useT();
  const fmt = useFormat();
  const names = useMemo(() => new Map(sauna.groups.flatMap(g => g.options.map(o => [o.id, o.name] as const))), [sauna]);
  const notes = (id: string) => [
    ...sauna.rules.requires.filter(r => r.optionId === id).map(r => t('detail.requires', { option: names.get(r.requiredOptionId) ?? '' })),
    ...sauna.rules.excludes.filter(x => x.optionAId === id || x.optionBId === id).map(x => t('detail.excludes', { option: names.get(x.optionAId === id ? x.optionBId : x.optionAId) ?? '' })),
  ];
  return (
    <div className="ogroups">
      {groups.map(g => {
        const single = g.selectionType === 'SINGLE';
        return (
          <fieldset key={g.id} className="ogroup">
            <legend className="sr-only">
              {g.name}: {single ? t('detail.chooseOne') : t('detail.chooseAny')}
            </legend>
            <div className="ogroup__head">
              <h3 className="ogroup__title" aria-hidden="true">
                {g.name}
              </h3>
              <p className="ogroup__hint">
                <span>{single ? t('detail.chooseOne') : t('detail.chooseAny')}</span>
                {g.required && <Badge tone="outline">{t('detail.required')}</Badge>}
              </p>
              {g.description && <p className="ogroup__desc">{g.description}</p>}
              {customiseTo && (
                <TextLink to={customiseTo(g.code)} tone="underline" className="ogroup__go" aria-label={t('detail.customiseGroup', { group: g.name })}>
                  {t('detail.customise3d')}
                  <Icon icon={ArrowRight} size="xs" />
                </TextLink>
              )}
            </div>
            <ul className="ogroup__options">
              {g.options.map(o => {
                const on = selection.includes(o.id);
                const n = notes(o.id);
                return (
                  <li key={o.id} className={['ocard', on && 'is-on'].filter(Boolean).join(' ')}>
                    <label className="ocard__pick">
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name={`g-${g.id}`}
                        checked={on}
                        className="ocard__input"
                        onChange={e => onPick(o.id, e.target.checked)}
                        // A selected choice in an optional single group can be cleared by clicking it again.
                        onClick={single && on && !g.required ? () => onPick(o.id, false) : undefined}
                      />
                      <span className="ocard__media" aria-hidden="true">
                        {o.swatchColor ? (
                          <span className="ocard__swatch" style={{ ['--swatch' as string]: o.swatchColor }} />
                        ) : o.thumbnailUrl ? (
                          <img src={o.thumbnailUrl} alt="" width={160} height={160} loading="lazy" decoding="async" className="ocard__img" />
                        ) : (
                          <Icon icon={Sparkles} size="sm" />
                        )}
                        {on && (
                          <span className="ocard__tick">
                            <Icon icon={Check} size="xs" />
                          </span>
                        )}
                      </span>
                      <span className="ocard__body">
                        <span className="ocard__top">
                          <span className="ocard__name">{o.name}</span>
                          <span className="ocard__price">{o.priceDeltaMinor === 0 ? t('common.included') : `+ ${fmt.money(o.priceDeltaMinor, currency)}`}</span>
                        </span>
                        {o.isDefault && (
                          <span className="ocard__tag">
                            <Badge tone="soft">{t('detail.standard')}</Badge>
                          </span>
                        )}
                        {n.map(note => (
                          <span key={note} className="ocard__note">
                            <Icon icon={Info} size="xs" />
                            {note}
                          </span>
                        ))}
                      </span>
                    </label>
                    {/* Outside the label: the "more" toggle must not pick the option. */}
                    {o.description && <ClampText as="p" text={o.description} className="ocard__desc" />}
                  </li>
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </div>
  );
}

/** Stacked description: overview from the model text, then size and heating from its data. */
function Description({ sauna }: { sauna: Sauna }) {
  const { t } = useT();
  const fmt = useFormat();
  const s = specsOf(sauna);
  const [lead, rest] = sauna.description ? splitLead(sauna.description) : ['', ''];
  const heater = sauna.groups.find(g => g.code === 'heater');
  const heaterStd = defaultOf(heater);
  const others = heater?.options.filter(o => o.id !== heaterStd?.id).map(o => o.name) ?? [];
  const placement = [s.indoor && t('saunas.placementIndoor'), s.outdoor && t('saunas.placementOutdoor')].filter(Boolean).join(', ');
  return (
    <div className="pdesc">
      {(lead || rest) && (
        <section className="pdesc__part">
          <h3 className="pdesc__title">{t('detail.descOverview')}</h3>
          {lead && <p className="pdesc__lead">{lead}</p>}
          {rest && <p className="pdesc__body">{rest}</p>}
        </section>
      )}
      <section className="pdesc__part">
        <h3 className="pdesc__title">{t('detail.descSize')}</h3>
        <p className="pdesc__body">
          {t('detail.descSizeBody', { seats: t('saunas.seats', { count: s.persons }), size: t('saunas.dimensions', { w: fmt.mm(s.widthMm), d: fmt.mm(s.depthMm), h: fmt.mm(s.heightMm) }), area: fmt.number(Math.round(s.footprintM2 * 10) / 10) })}
          {placement && ` ${t('detail.descPlacement', { placement })}`}
        </p>
      </section>
      {heaterStd && (
        <section className="pdesc__part">
          <h3 className="pdesc__title">{t('detail.descHeating')}</h3>
          <p className="pdesc__body">
            {t('detail.descHeatingBody', { option: heaterStd.name })}
            {others.length > 0 && ` ${t('detail.descHeatingAlso', { list: others.join(', ') })}`}
          </p>
        </section>
      )}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="page container" aria-hidden="true">
      <Skeleton width="12rem" height="0.8rem" />
      <div className="pdp">
        <Skeleton className="pdp__gallery" height="auto" style={{ aspectRatio: '3 / 2' }} />
        <div className="pdp__buy">
          <Skeleton width="40%" height="0.8rem" />
          <Skeleton width="90%" height="4rem" style={{ marginTop: '1rem' }} />
          <Skeleton lines={4} style={{ marginTop: '2rem' }} />
          <Skeleton width="60%" height="3rem" style={{ marginTop: '2rem' }} />
        </div>
      </div>
    </div>
  );
}

function scrollToOptions() {
  const el = document.getElementById('options');
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
  document.getElementById('d-options')?.focus({ preventScroll: true });
}

function Product({ s }: { s: Sauna }) {
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const session = useSession().data;
  const catalog = useCatalog().data;
  const signedIn = session?.kind === 'customer';
  const currency = tenant.currency;
  const specs = specsOf(s);
  const configureTo = `/saunas/${s.slug}/configure`;
  const loginTo = `/account/login?next=${encodeURIComponent(configureTo)}`;
  const threeTo = signedIn ? configureTo : loginTo;
  const rules = useMemo(() => rulesOf(s), [s]);
  const defaults = useMemo(() => defaultSelectionOf(s), [s]);
  const [selection, setSelection] = useState<string[]>(defaults);
  const [notice, setNotice] = useState('');
  const names = useMemo(() => new Map(s.groups.flatMap(g => g.options.map(o => [o.id, o.name] as const))), [s]);
  const price = useMemo(() => previewPrice(s, selection), [s, selection]);
  const features = useFeatures(s);

  // Signed-in customers can open the 3D configurator: warm its chunk once the page is idle.
  useEffect(() => {
    if (signedIn) preloadViewerWhenIdle();
  }, [signedIn]);

  const sizeGroups = s.groups.filter(g => isSizeGroup(g.code) && g.selectionType === 'SINGLE' && g.options.length > 1);
  const optionGroups = s.groups.filter(g => g.options.length > 0 && !sizeGroups.includes(g));
  const changed = selection.length !== defaults.length || selection.some(id => !defaults.includes(id));
  const sized = configuredSpecsOf(s, selection);
  const saving = s.listPriceMinor - s.priceFromMinor;

  const pick = (id: string, on: boolean) => {
    const r = toggle(rules, selection, id, on);
    if (r.rejected) return;
    setSelection(r.selection);
    const list = (ids: string[]) => ids.map(i => names.get(i) ?? '').filter(Boolean).join(', ');
    setNotice([r.added.length > 0 && t('configure.added', { list: list(r.added) }), r.removed.length > 0 && t('configure.removed', { list: list(r.removed) })].filter(Boolean).join(' '));
  };

  const photos: GalleryPhoto[] = (s.assets.gallery.length > 0 ? s.assets.gallery : s.assets.thumbnailUrl ? [s.assets.thumbnailUrl] : []).map((url, i) => ({
    url,
    view: i === 0 ? t('detail.photoOutside') : i === 1 ? t('detail.photoInside') : t('detail.photoN', { n: i + 1 }),
  }));
  const placement = [specs.indoor && t('saunas.placementIndoor'), specs.outdoor && t('saunas.placementOutdoor')].filter(Boolean);
  const [lead] = s.description ? splitLead(s.description) : [''];
  const related = (catalog?.items ?? []).filter(i => i.slug !== s.slug).slice(0, 3);
  const selected = s.groups.flatMap(g => g.options.filter(o => selection.includes(o.id)).map(o => ({ group: g.name, option: o })));
  const email = tenant.branding.supportEmail;
  const label3d = signedIn ? t('detail.open3d') : t('detail.loginToConfigure');
  const warm = signedIn ? preloadViewer : undefined;

  const open3d = (size: 'md' | 'lg', block = false) => (
    <ButtonLink to={threeTo} size={size} block={block} icon={signedIn ? Box : Lock} iconAfter={ArrowRight} onPointerEnter={warm} onFocus={warm}>
      {label3d}
    </ButtonLink>
  );

  return (
    <div className="page container">
      <Breadcrumbs items={[{ label: t('nav.home'), to: '/' }, { label: t('nav.saunas'), to: '/saunas' }, { label: s.name }]} />

      <div className="pdp">
        <div className="pdp__gallery">
          {photos.length > 0 ? (
            <PhotoGallery
              name={s.name}
              photos={photos}
              overlay={
                <Link to={threeTo} className="pdp__3d" onPointerEnter={warm} onFocus={warm} aria-label={label3d}>
                  <Icon icon={signedIn ? Box : Lock} size="xs" />
                  {t('detail.badge3d')}
                </Link>
              }
            />
          ) : (
            <div className="pdp__glyph">
              <SaunaGlyph form={specs.form} widthMm={specs.widthMm} depthMm={specs.depthMm} heightMm={specs.heightMm} />
            </div>
          )}
        </div>

        <div className="pdp__buy">
          <div className="pdp__sticky">
            <p className="eyebrow pdp__meta">
              <span>{t('detail.sku', { sku: s.sku })}</span>
              {placement.length > 0 && <span>{placement.join(' · ')}</span>}
            </p>
            <ScrambleText as="h1" className="detail__title" text={s.name} />
            {s.discount && saving > 0 && (
              <p className="pdp__badges">
                <Badge tone="solid">
                  {s.discount.type === 'PERCENT' ? t('detail.discountPercent', { percent: fmt.percentBps(s.discount.value) }) : t('detail.youSave', { amount: fmt.money(saving, currency) })}
                </Badge>
              </p>
            )}
            {lead && <p className="pdp__lead">{lead}</p>}
            <ul className="pdp__features" aria-label={t('detail.keyFacts')}>
              {features.map(f => (
                <li key={f}>
                  <Icon icon={Check} size="xs" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            <SizeSelector groups={sizeGroups} selection={selection} currency={currency} onPick={id => pick(id, true)} />
            {sizeGroups.length > 0 && (
              <p className="psize__result mono">{t('saunas.dimensions', { w: fmt.mm(sized.widthMm), d: fmt.mm(sized.depthMm), h: fmt.mm(sized.heightMm) })}</p>
            )}

            <div className="pricecard">
              <Price minor={price.finalPriceMinor} currency={currency} listMinor={price.discountMinor > 0 ? price.subtotalMinor : null} size="lg" label={changed ? t('detail.priceSelection') : t('detail.priceFrom')} />
              {price.discountMinor > 0 && <p className="pricecard__save mono">{t('detail.youSave', { amount: fmt.money(price.discountMinor, currency) })}</p>}
              <p className="pricecard__vat">{t(`vat.${tenant.branding.vatDisplay}`)}</p>
              <div className="pricecard__actions">
                {open3d('lg', true)}
                <Button variant="ghost" size="lg" block icon={SlidersHorizontal} onClick={scrollToOptions}>
                  {t('detail.jumpToOptions')}
                </Button>
              </div>
              {!signedIn && <p className="pricecard__hint">{t('detail.loginHint')}</p>}
              {s.assets.hasAr && <ArButton saunaModelId={s.id} name={s.name} enabled={signedIn} />}
              <p className="pricecard__hint">
                <Icon icon={ArrowRight} size="xs" /> {t('detail.delivery', { name: tenant.branding.displayName, manufacturer: tenant.manufacturer.name })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <section id="options" className="section dsec dsec--options" aria-labelledby="d-options">
        <SectionHeading id="d-options" title={t('detail.options')} lede={t('detail.optionsPreviewLede')} size="md" />
        <p className="sr-only" role="status">
          {notice}
        </p>
        <div className="pconf">
          <div className="pconf__groups">
            <OptionGroups sauna={s} groups={optionGroups} selection={selection} currency={currency} onPick={pick} customiseTo={signedIn ? code => `${configureTo}?step=${encodeURIComponent(code)}` : null} />
            <p className="dsec__note">{t('detail.rulesNote')}</p>
          </div>
          <aside className="psum" aria-labelledby="d-summary">
            <div className="psum__panel">
              <h3 id="d-summary" className="psum__title">
                {t('detail.summary')}
              </h3>
              <dl className="psum__lines">
                <div className="psum__row">
                  <dt>{t('configure.basePrice')}</dt>
                  <dd className="mono">{fmt.money(s.listPriceMinor, currency)}</dd>
                </div>
                {selected.map(({ group, option }) => (
                  <div key={option.id} className="psum__row psum__row--opt">
                    <dt>
                      <span className="psum__group">{group}</span>
                      {option.name}
                    </dt>
                    <dd className="mono">{option.priceDeltaMinor === 0 ? t('common.included') : `+ ${fmt.money(option.priceDeltaMinor, currency)}`}</dd>
                  </div>
                ))}
                {price.discountMinor > 0 && (
                  <div className="psum__row psum__row--discount">
                    <dt>{t('configure.discount')}</dt>
                    <dd className="mono">−{fmt.money(price.discountMinor, currency)}</dd>
                  </div>
                )}
              </dl>
              <div className="psum__total">
                <span>{t('detail.previewTotal')}</span>
                <Price minor={price.finalPriceMinor} currency={currency} size="md" />
              </div>
              <p className="psum__vat">{t(`vat.${tenant.branding.vatDisplay}`)}</p>
              <p className="psum__note">{t('detail.previewNote')}</p>
              {open3d('lg', true)}
              {changed && (
                <Button variant="quiet" size="sm" icon={RotateCcw} onClick={() => setSelection(defaults)} className="psum__reset">
                  {t('detail.resetSelection')}
                </Button>
              )}
            </div>
          </aside>
        </div>
        {/* Phones: total and the next step stay in reach while scrolling through the options. */}
        <div className="pbar">
          <div className="pbar__price">
            <span className="pbar__label">{t('detail.previewTotal')}</span>
            <span className="pbar__amount mono">{fmt.money(price.finalPriceMinor, currency)}</span>
          </div>
          {open3d('md')}
        </div>
      </section>

      <section className="section dsec" aria-labelledby="d-desc">
        <SectionHeading id="d-desc" title={t('detail.descTitle')} size="md" />
        <Description sauna={s} />
      </section>

      <section className="section dsec" aria-labelledby="d-specs">
        <SectionHeading id="d-specs" title={t('detail.specs')} lede={t('detail.specsLede')} size="md" />
        <Specs sauna={s} />
      </section>

      {related.length > 0 && (
        <section className="section dsec" aria-labelledby="d-related">
          <SectionHeading id="d-related" title={t('detail.alsoLike')} size="md" />
          <SaunaGrid className="sgrid prelated">
            {related.map((item, i) => (
              <SaunaCard key={item.id} item={item} currency={currency} index={i} />
            ))}
          </SaunaGrid>
        </section>
      )}

      <section className="section dsec" aria-labelledby="d-ask">
        <div className="pask">
          <span className="pask__icon" aria-hidden="true">
            <Icon icon={MessageCircle} size="md" />
          </span>
          <div className="pask__text">
            <h2 id="d-ask" className="pask__title">
              {t('detail.askTitle', { name: s.name })}
            </h2>
            <p className="pask__body">{t('detail.askBody', { name: tenant.branding.displayName })}</p>
          </div>
          <div className="pask__actions">
            {email && (
              <span className="pask__mail">
                <Icon icon={Mail} size="xs" />
                <ExternalLink href={`mailto:${email}?subject=${encodeURIComponent(t('detail.askSubject', { name: s.name, sku: s.sku }))}`}>{email}</ExternalLink>
              </span>
            )}
            <ButtonLink to="/contact" variant="ghost" iconAfter={ArrowRight}>
              {t('detail.askCta')}
            </ButtonLink>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function SaunaDetail() {
  const { slug = '' } = useParams();
  const { t } = useT();
  const sauna = useSauna(slug);
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
  // Keyed by model, so the previewed selection starts from the standard setup on every sauna.
  return <Product key={sauna.data.id} s={sauna.data} />;
}
