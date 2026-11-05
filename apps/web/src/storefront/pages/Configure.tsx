import { useSubmitRequest } from '../configurator/useSubmitRequest.ts';
import { errorText } from '../../i18n/errorText.ts';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Armchair, ArrowLeft, Check, ChevronDown, ChevronLeft, ChevronRight, Flame, House, Lightbulb, RotateCcw, RotateCw, Ruler, Save, ScanLine, Send, Shapes, type LucideIcon } from 'lucide-react';
import { calculatePrice } from '@saunaklar/pricing';
import { availability, validate } from '@saunaklar/rules';
import { api, isApiError } from '../../api/client.ts';
import { useRooms, useSauna, useTenantData } from '../../api/queries.ts';
import type { OptionGroupDto, SaunaDetail } from '../../api/types.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button, ButtonLink, IconButton } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Textarea } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { ClampText } from '../../design/components/ClampText.tsx';
import { InfoTip } from '../../design/components/InfoTip.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { computeReferenceLayout, measureReferenceLayout } from '../../three/reference/layout.ts';
import { ArButton } from '../../three/ArButton.tsx';
import { RequireCustomer } from '../account/RequireCustomer.tsx';
import { configuredSpecsOf } from '../components/specs.ts';
import { defaultSelectionOf, initStep, oneAtATime, rulesOf, stepGroupCode, viewerOptionsOf } from '../components/sauna-helpers.ts';
import { useConfigurator } from '../configurator/store.ts';
import './Configure.css';

const RoomScene = lazy(() => import('../../three/RoomScene.tsx'));

function ConfigureSkeleton() {
  return (
    <div className="page cfg" aria-hidden="true">
      <div className="cfg__stage">
        <Skeleton height="auto" style={{ aspectRatio: '4 / 3.2' }} />
      </div>
      <div className="cfg__panel">
        <Skeleton width="50%" height="2.5rem" />
        <Skeleton lines={8} style={{ marginTop: '2rem' }} />
      </div>
    </div>
  );
}

/** The option groups gathered under the studio's section rail; unknown codes land in "More". */
type SectionId = 'cabin' | 'benches' | 'heat' | 'extras' | 'more' | 'room' | 'ar';
const SECTION_OF: Record<string, SectionId> = {
  wood: 'cabin', exterior: 'cabin', door: 'cabin', roof: 'cabin', window: 'cabin', windows: 'cabin',
  width: 'cabin', depth: 'cabin', height: 'cabin', 'size-width': 'cabin', 'size-depth': 'cabin', 'size-height': 'cabin',
  'bench-layout': 'benches', 'bench-wood': 'benches', 'bench-front': 'benches', 'bench-end': 'benches', 'bench-edge': 'benches', backrest: 'benches',
  heater: 'heat', control: 'heat',
  lighting: 'extras', extras: 'extras',
};
const SECTION_ICON: Record<SectionId, LucideIcon> = { cabin: House, benches: Armchair, heat: Flame, extras: Lightbulb, more: Shapes, room: Ruler, ar: ScanLine };

function GroupEditor({ group, sauna, currency, open, onToggle }: { group: OptionGroupDto; sauna: SaunaDetail; currency: string; open: boolean; onToggle: () => void }) {
  const { t } = useT();
  const fmt = useFormat();
  const rules = useMemo(() => rulesOf(sauna), [sauna]);
  const selection = useConfigurator(s => s.selection);
  const toggleOption = useConfigurator(s => s.toggleOption);
  const avail = useMemo(() => new Map(availability(rules, selection).map(a => [a.optionId, a])), [rules, selection]);
  const names = useMemo(() => new Map(sauna.groups.flatMap(g => g.options.map(o => [o.id, o.name] as const))), [sauna]);
  const isWood = group.options.every(o => o.swatchColor);
  const single = group.selectionType === 'SINGLE';
  const chosen = group.options.filter(o => selection.includes(o.id));
  const bodyId = `cfg-group-${group.id}`;

  const click = (id: string) => {
    const on = !selection.includes(id);
    const r = toggleOption(rules, id, on);
    if (r.rejected) {
      toast.error(t('configure.blocked', { reason: r.rejected }));
      return;
    }
    const added = r.added.filter(x => x !== id).map(x => names.get(x) ?? '');
    const removed = r.removed.filter(x => x !== id && !group.options.some(o => o.id === x)).map(x => names.get(x) ?? '');
    if (added.length) toast(t('configure.added', { list: fmt.list(added) }));
    if (removed.length) toast(t('configure.removed', { list: fmt.list(removed) }));
  };

  const state = (id: string) => {
    const a = avail.get(id);
    const selected = selection.includes(id);
    return { a, selected, blocked: Boolean(a?.blockedReason) && !selected };
  };

  return (
    <section className={['cfg-group', open && 'is-open'].filter(Boolean).join(' ')}>
      <button type="button" className="cfg-group__head" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="cfg-group__title">
          <span>{group.name}</span>
          <span className="cfg-group__value">{chosen.length ? chosen.map(o => o.name).join(', ') : group.required ? t('detail.required') : (single ? t('detail.chooseOne') : t('detail.chooseAny'))}</span>
        </span>
        <Icon icon={ChevronDown} size="sm" className="cfg-group__caret" />
      </button>
      {open && (
        <div id={bodyId} className="cfg-group__body">
          {group.description && <ClampText text={group.description} className="cfg-group__lede" />}
          {isWood ? (
            <>
              <div className="cfg-dots" role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
                {group.options.map(o => {
                  const { a, selected, blocked } = state(o.id);
                  const info = blocked && a?.blockedReason ? t('configure.blocked', { reason: a.blockedReason }) : o.description;
                  return (
                    <div key={o.id} className="cfg-dot-wrap">
                      <button
                        type="button"
                        role={single ? 'radio' : 'checkbox'}
                        aria-checked={selected}
                        aria-disabled={blocked || undefined}
                        className={['cfg-dot', selected && 'is-selected', blocked && 'is-blocked'].filter(Boolean).join(' ')}
                        onClick={() => click(o.id)}
                      >
                        <span className="cfg-dot__disc" style={{ background: o.swatchColor! }} aria-hidden="true">
                          {selected && (
                            <span className="cfg-dot__tick">
                              <Icon icon={Check} size="xs" strokeWidth={2.5} />
                            </span>
                          )}
                        </span>
                        <span className="cfg-dot__label">{o.name}</span>
                        <span className="cfg-dot__sub mono">{o.priceDeltaMinor ? `+ ${fmt.money(o.priceDeltaMinor, currency)}` : t('common.included')}</span>
                      </button>
                      {info && <InfoTip label={o.name} text={info} className="cfg-dot__info" />}
                    </div>
                  );
                })}
              </div>
              {chosen[0]?.description && <ClampText text={chosen[0].description} lines={3} className="cfg-group__note" />}
            </>
          ) : (
            <div className="cfg-opts" role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
              {group.options.map(o => {
                const { a, selected, blocked } = state(o.id);
                const consequence = [
                  ...(a?.wouldAdd ?? []).map(x => `+ ${names.get(x)}`),
                  ...(a?.wouldRemove ?? []).filter(x => !group.options.some(g => g.id === x)).map(x => `− ${names.get(x)}`),
                ];
                return (
                  <div key={o.id} className={['cfg-opt', selected && 'is-selected', blocked && 'is-blocked'].filter(Boolean).join(' ')}>
                    <button
                      type="button"
                      role={single ? 'radio' : 'checkbox'}
                      aria-checked={selected}
                      aria-disabled={blocked || undefined}
                      className="cfg-opt__hit"
                      onClick={() => click(o.id)}
                    >
                      <span className={`cfg-opt__mark cfg-opt__mark--${single ? 'radio' : 'check'}`} aria-hidden="true">
                        {selected && <Icon icon={Check} size="xs" strokeWidth={2.5} />}
                      </span>
                      <span className="cfg-opt__name">{o.name}</span>
                      <span className="cfg-opt__price mono">{o.priceDeltaMinor ? `+ ${fmt.money(o.priceDeltaMinor, currency)}` : t('common.included')}</span>
                    </button>
                    {(o.description || blocked || (!selected && consequence.length > 0)) && (
                      <div className="cfg-opt__text">
                        {o.description && <ClampText text={o.description} className="cfg-opt__desc" />}
                        {blocked && a?.blockedReason && <p className="cfg-opt__blocked">{t('configure.blocked', { reason: a.blockedReason })}</p>}
                        {!selected && !blocked && consequence.length > 0 && <p className="cfg-opt__cons mono">{consequence.join('  ')}</p>}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RoomPanel({ sauna }: { sauna: SaunaDetail }) {
  const { t } = useT();
  const fmt = useFormat();
  const rooms = useRooms();
  const { roomId, placement, setRoom, setPlacement, selection } = useConfigurator();
  const room = rooms.data?.items.find(r => r.id === roomId) ?? null;
  const specs = configuredSpecsOf(sauna, selection);
  return (
    <div className="cfg-room">
      <p className="muted">{t('configure.roomLede')}</p>
      {rooms.isPending ? (
        <Skeleton height="2.5rem" />
      ) : (
        <Segmented
          label={t('configure.room')}
          value={roomId ?? 'none'}
          onChange={v => setRoom(v === 'none' ? null : v)}
          options={[{ value: 'none', label: t('configure.noRoom') }, ...(rooms.data?.items ?? []).map(r => ({ value: r.id, label: r.name }))]}
          size="sm"
        />
      )}
      {room?.preset && (
        <>
          <div className="cfg-room__stage">
            <Suspense fallback={<Skeleton height="100%" />}>
              <RoomScene
                preset={room.preset}
                specs={specs}
                options={viewerOptionsOf(sauna, selection)}
                value={placement}
                onChange={setPlacement}
                label={t('three.roomLabel')}
              />
            </Suspense>
          </div>
          <div className="cfg-room__tools">
            <IconButton icon={RotateCcw} label={t('configure.rotateLeft')} variant="ghost" onClick={() => setPlacement({ ...placement, rotationDeg: placement.rotationDeg - 15 })} />
            <IconButton icon={RotateCw} label={t('configure.rotateRight')} variant="ghost" onClick={() => setPlacement({ ...placement, rotationDeg: placement.rotationDeg + 15 })} />
            <span className="mono muted">
              {t('configure.placement', { x: fmt.mm(placement.positionXMm), z: fmt.mm(placement.positionZMm), deg: Math.round(placement.rotationDeg) })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function Configurator({ sauna }: { sauna: SaunaDetail }) {
  const { t } = useT();
  const fmt = useFormat();
  const tenant = useTenantData();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const idParam = params.get('id');
  const st = useConfigurator();
  // `?step=<groupCode>` (the detail page's "Customise" links) opens on that group's section,
  // with the other groups of the section folded.
  const stepCode = stepGroupCode(params.get('step'), sauna.groups);
  const sectionOf = (code: string): SectionId => SECTION_OF[code] ?? 'more';
  const [section, setSection] = useState<SectionId>(() => (stepCode ? sectionOf(stepCode) : 'cabin'));
  const [closed, setClosed] = useState<Set<string>>(() =>
    stepCode ? new Set(sauna.groups.filter(g => g.code !== stepCode && sectionOf(g.code) === sectionOf(stepCode)).map(g => g.id)) : new Set(),
  );
  const [details, setDetails] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [message, setMessage] = useState('');
  const currency = tenant.currency;
  const rules = useMemo(() => rulesOf(sauna), [sauna]);

  const existing = useQuery({
    queryKey: ['configuration', idParam],
    queryFn: () => api('configuration', { params: { id: idParam! } }),
    enabled: Boolean(idParam),
  });

  useEffect(() => {
    const c = existing.data;
    const step = initStep(sauna.slug, idParam, c?.id ?? null, useConfigurator.getState());
    // The storefront lists only the options this reseller offers, at its prices. A draft saved
    // before the reseller stopped offering an option drops it here (the server refuses it on save).
    const offered = new Set(sauna.groups.flatMap(g => g.options.map(o => o.id)));
    if (step === 'load' && c) st.init(sauna.slug, c.locked ? c.selections : c.selections.filter(id => offered.has(id)), c.id, c.placement ? { id: c.placement.roomSceneId, placement: c.placement } : null);
    else if (step === 'defaults') st.init(sauna.slug, defaultSelectionOf(sauna));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sauna.slug, idParam, existing.data]);

  const locked = Boolean(existing.data?.locked);
  // Effective option prices come from the API (reseller override, else manufacturer price); the
  // server recomputes the same breakdown on save and lock.
  const livePrice = useMemo(() => {
    const opts = sauna.groups.flatMap(g => g.options).filter(o => st.selection.includes(o.id));
    return calculatePrice({
      listPriceMinor: sauna.listPriceMinor,
      maxDiscountBps: sauna.maxDiscountBps,
      options: opts.map(o => ({ optionId: o.id, priceDeltaMinor: o.priceDeltaMinor })),
      perSaunaDiscount: sauna.discount,
    });
  }, [sauna, st.selection]);
  // A locked configuration keeps the price frozen at lock time.
  const price = locked && existing.data ? existing.data.price : livePrice;
  const valid = validate(rules, st.selection).valid;

  // One save at a time, reading the store when it starts: a Send (or second Save)
  // made while a first save creates the configuration then updates that one.
  const saveDraft = useMemo(
    () => oneAtATime(async () => {
      const draft = useConfigurator.getState();
      let id = draft.configurationId;
      if (!id) {
        id = (await api('createConfiguration', { body: { saunaModelId: sauna.id, selections: draft.selection } })).id;
        useConfigurator.setState({ configurationId: id });
      } else {
        await api('putSelections', { params: { id }, body: { optionIds: draft.selection } });
      }
      const saved = await api('putPlacement', { params: { id }, body: draft.roomId ? { roomSceneId: draft.roomId, ...draft.placement } : null });
      return { saved, draft };
    }),
    [sauna.id],
  );
  const save = useMutation({
    mutationFn: saveDraft,
    onSuccess: ({ saved, draft }) => {
      const now = useConfigurator.getState();
      // Edits made while the save ran stay unsaved.
      if (now.selection === draft.selection && now.roomId === draft.roomId && now.placement === draft.placement) st.saved(saved.id);
      else useConfigurator.setState({ configurationId: saved.id });
      qc.setQueryData(['configuration', saved.id], saved);
      if (params.get('id') !== saved.id) setParams({ id: saved.id }, { replace: true, preventScrollReset: true });
      void qc.invalidateQueries({ queryKey: ['configurations'] });
    },
  });
  const saveId = () => save.mutateAsync().then(r => r.saved.id);

  const submit = useSubmitRequest({ onSent: () => setSendOpen(false) });
  const send = {
    isPending: submit.isPending,
    mutate: () => submit.mutate({ id: save.isPending || st.dirty || !st.configurationId ? saveId() : Promise.resolve(st.configurationId), message }),
  };

  const clone = useMutation({
    mutationFn: () => api('clone', { params: { id: st.configurationId! } }),
    onSuccess: c => setParams({ id: c.id }, { replace: true }),
  });

  // Right after the first save the store already holds the configuration the URL now names.
  if (idParam && existing.isPending && st.configurationId !== idParam) return <ConfigureSkeleton />;

  const options = viewerOptionsOf(sauna, st.selection);
  const specs = configuredSpecsOf(sauna, st.selection);
  const measured = specs.source === 'reference'
    ? measureReferenceLayout(computeReferenceLayout(specs.widthMm, specs.depthMm, specs.heightMm))
    : null;

  const sections: SectionId[] = [
    ...(['cabin', 'benches', 'heat', 'extras', 'more'] as const).filter(id => sauna.groups.some(g => (SECTION_OF[g.code] ?? 'more') === id)),
    'room',
    ...(sauna.assets.hasAr ? (['ar'] as const) : []),
  ];
  const current = sections.includes(section) ? section : sections[0]!;
  const at = sections.indexOf(current);
  const step = (d: number) => setSection(sections[(at + d + sections.length) % sections.length]!);
  const groupsHere = sauna.groups.filter(g => (SECTION_OF[g.code] ?? 'more') === current);
  const label = (id: SectionId) => (id === 'room' ? t('configure.tabs.room') : id === 'ar' ? t('configure.tabs.ar') : t(`configure.sections.${id}`));

  return (
    <div className="page cfg">
      <div className="cfg__stage">
        <ButtonLink to={`/saunas/${sauna.slug}`} variant="link" icon={ArrowLeft} className="cfg__back">
          {sauna.name}
        </ButtonLink>
        <ViewerSlot name={sauna.name} specs={specs} options={options} lowUrl={sauna.assets.lowGlbUrl} highUrl={sauna.assets.highGlbUrl} allowHigh thumbnailUrl={sauna.assets.thumbnailUrl} eager views />
      </div>

      <aside className="cfg__panel">
        <div className="cfg-card cfg-product">
          <p className="cfg-product__eyebrow">{t('configure.eyebrow')}</p>
          <ScrambleText as="h1" className="cfg__title" text={sauna.name} />
          <div className="cfg__total">
            <Price minor={price.finalPriceMinor} currency={currency} size="md" label={t('configure.total')} />
          </div>
          <div className="cfg-product__links">
            <button type="button" className="cfg-product__toggle" aria-expanded={details} onClick={() => setDetails(v => !v)}>
              {t('configure.priceDetails')}
              <Icon icon={ChevronDown} size="xs" className={details ? 'is-up' : undefined} />
            </button>
            {!locked && (
              <button type="button" className="cfg-product__toggle" onClick={() => st.init(sauna.slug, defaultSelectionOf(sauna), st.configurationId, st.roomId ? { id: st.roomId, placement: st.placement } : null)}>
                <Icon icon={RotateCcw} size="xs" />
                {t('configure.resetOptions')}
              </button>
            )}
          </div>
          {details && (
            <dl className="cfg__lines mono">
              <div>
                <dt>{t('configure.basePrice')}</dt>
                <dd>{fmt.money(price.listPriceMinor, currency)}</dd>
              </div>
              <div>
                <dt>{t('configure.optionsTotal')}</dt>
                <dd>+ {fmt.money(price.optionsTotalMinor, currency)}</dd>
              </div>
              {price.discountMinor > 0 && (
                <div>
                  <dt>{t('configure.discount')}</dt>
                  <dd>− {fmt.money(price.discountMinor, currency)}</dd>
                </div>
              )}
              <p className="muted cfg__vat">{t(`vat.${tenant.branding.vatDisplay}`)}</p>
            </dl>
          )}
        </div>
        {locked ? (
          <div className="cfg-card cfg__locked">
            <p>{t('configure.locked')}</p>
            <Button onClick={() => clone.mutate()} loading={clone.isPending}>
              {t('configure.clone')}
            </Button>
          </div>
        ) : (
          <>
            <div className="cfg-stepper">
              <button type="button" aria-label={t('configure.prevSection')} onClick={() => step(-1)}>
                <Icon icon={ChevronLeft} size="sm" />
              </button>
              <span>
                {label(current)}
                <small>
                  {at + 1}/{sections.length}
                </small>
              </span>
              <button type="button" aria-label={t('configure.nextSection')} onClick={() => step(1)}>
                <Icon icon={ChevronRight} size="sm" />
              </button>
            </div>
            <div className="cfg-body">
              <nav className="cfg-rail" aria-label={t('configure.tabs.options')}>
                {sections.map(id => (
                  <button key={id} type="button" className={id === current ? 'is-active' : undefined} aria-current={id === current ? 'true' : undefined} onClick={() => setSection(id)}>
                    <Icon icon={SECTION_ICON[id]} size="md" />
                    <span>{label(id)}</span>
                  </button>
                ))}
              </nav>
              <div className="cfg-card cfg-list">
                {current === 'room' ? (
                  <div className="cfg-list__pad">
                    <RoomPanel sauna={sauna} />
                  </div>
                ) : current === 'ar' ? (
                  <div className="cfg-list__pad">
                    <ArButton saunaModelId={sauna.id} name={sauna.name} enabled />
                  </div>
                ) : (
                  <>
                  {current === 'cabin' && measured && (
                    <dl className="cfg-size mono" aria-label={t('configure.sizeMeasurements')}>
                      <div><dt>{t('configure.outerSize')}</dt><dd>{fmt.mm(specs.widthMm)} × {fmt.mm(specs.depthMm)} × {fmt.mm(specs.heightMm)}</dd></div>
                      <div><dt>{t('configure.upperBench')}</dt><dd>{fmt.mm(measured.upperLengthMm)} × {fmt.mm(measured.upperDepthMm)}</dd></div>
                      <div><dt>{t('configure.upperReturn')}</dt><dd>{fmt.mm(measured.returnLengthMm)} × {fmt.mm(measured.returnWidthMm)}</dd></div>
                      <div><dt>{t('configure.lowerStep')}</dt><dd>{fmt.mm(measured.lowerLengthMm)} × {fmt.mm(measured.lowerWidthMm)}</dd></div>
                      <div><dt>{t('configure.seatHeights')}</dt><dd>{fmt.mm(measured.upperHeightMm)} / {fmt.mm(measured.lowerHeightMm)}</dd></div>
                    </dl>
                  )}
                  {groupsHere.map(g => (
                    <GroupEditor
                      key={g.id}
                      group={g}
                      sauna={sauna}
                      currency={currency}
                      open={!closed.has(g.id)}
                      onToggle={() => setClosed(c => {
                        const n = new Set(c);
                        if (!n.delete(g.id)) n.add(g.id);
                        return n;
                      })}
                    />
                  ))}
                  </>
                )}
              </div>
            </div>
            <div className="cfg-card cfg__actions">
              {!valid && <p className="muted cfg__hint">{t('configure.incomplete')}</p>}
              <Button variant="ghost" icon={Save} onClick={() => save.mutate(undefined, { onSuccess: () => toast(t('configure.draftSaved')), onError: e => toast.error(t('errors.title'), errorText(t, e)) })} loading={save.isPending && !send.isPending} disabled={save.isPending || send.isPending}>
                {st.dirty || !st.configurationId ? t('configure.saveDraft') : t('common.saved')}
              </Button>
              <Button icon={Send} onClick={() => setSendOpen(true)} disabled={!valid}>
                {t('configure.sendRequest')}
              </Button>
            </div>
          </>
        )}
      </aside>

      <Dialog
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        title={t('configure.requestTitle')}
        description={t('configure.requestBody', { name: tenant.branding.displayName })}
        footer={
          <>
            <Button variant="quiet" onClick={() => setSendOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button icon={Send} onClick={() => send.mutate()} loading={send.isPending}>
              {t('configure.sendRequest')}
            </Button>
          </>
        }
      >
        <div className="stack">
          <Price minor={price.finalPriceMinor} currency={currency} size="lg" label={t('configure.total')} />
          <Textarea label={t('configure.message')} placeholder={t('configure.messagePlaceholder')} value={message} onChange={e => setMessage(e.target.value)} maxLength={4000} />
        </div>
      </Dialog>
    </div>
  );
}

export default function Configure() {
  const { slug = '' } = useParams();
  const { t } = useT();
  const sauna = useSauna(slug);
  useDocumentTitle(sauna.data ? t('configure.title', { name: sauna.data.name }) : null);
  return (
    <RequireCustomer fallback={<ConfigureSkeleton />}>
      {() => {
        if (sauna.isPending) return <ConfigureSkeleton />;
        if (sauna.error) return <ErrorPage error={sauna.error} onRetry={() => void sauna.refetch()} />;
        return <Configurator sauna={sauna.data} />;
      }}
    </RequireCustomer>
  );
}
