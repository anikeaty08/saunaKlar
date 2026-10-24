import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, RotateCcw, RotateCw, Save, Send } from 'lucide-react';
import { calculatePrice } from '@saunaklar/pricing';
import { availability, validate } from '@saunaklar/rules';
import { api, isApiError } from '../../api/client.ts';
import { useRooms, useSauna, useTenantData } from '../../api/queries.ts';
import type { OptionGroupDto, SaunaDetail } from '../../api/types.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Button, ButtonLink, IconButton } from '../../design/components/Button.tsx';
import { Price } from '../../design/components/Price.tsx';
import { Swatch } from '../../design/components/Swatch.tsx';
import { Tabs } from '../../design/components/Tabs.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Textarea } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { toast } from '../../design/components/Toast.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { ViewerSlot } from '../../three/ViewerSlot.tsx';
import { ArButton } from '../../three/ArButton.tsx';
import { RequireCustomer } from '../account/RequireCustomer.tsx';
import { specsOf } from '../components/specs.ts';
import { defaultSelectionOf, rulesOf, viewerOptionsOf } from '../components/sauna-helpers.ts';
import { useConfigurator } from '../configurator/store.ts';
import './Configure.css';

const RoomScene = lazy(() => import('../../three/RoomScene.tsx'));

function ConfigureSkeleton() {
  return (
    <div className="page container cfg" aria-hidden="true">
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

function errorText(t: (k: TKey, p?: Record<string, string | number>) => string, e: unknown): string {
  if (isApiError(e)) {
    const key = `errors.codes.${e.code}` as TKey;
    const msg = t(key);
    return msg === key ? e.message : msg;
  }
  return t('errors.body');
}

function GroupEditor({ group, sauna, currency }: { group: OptionGroupDto; sauna: SaunaDetail; currency: string }) {
  const { t } = useT();
  const fmt = useFormat();
  const rules = useMemo(() => rulesOf(sauna), [sauna]);
  const selection = useConfigurator(s => s.selection);
  const toggleOption = useConfigurator(s => s.toggleOption);
  const avail = useMemo(() => new Map(availability(rules, selection).map(a => [a.optionId, a])), [rules, selection]);
  const names = useMemo(() => new Map(sauna.groups.flatMap(g => g.options.map(o => [o.id, o.name] as const))), [sauna]);
  const isWood = group.options.every(o => o.swatchColor);

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

  return (
    <fieldset className="cfg-group">
      <legend className="cfg-group__legend">
        <span>{group.name}</span>
        <span className="cfg-group__rule mono">
          {group.selectionType === 'SINGLE' ? t('detail.chooseOne') : t('detail.chooseAny')}
          {group.required ? ` · ${t('detail.required')}` : ''}
        </span>
      </legend>
      {isWood && (
        <div className="cfg-swatches" role="radiogroup" aria-label={group.name}>
          {group.options.map(o => (
            <Swatch key={o.id} color={o.swatchColor!} label={o.name} selected={selection.includes(o.id)} onSelect={() => click(o.id)} size="lg" />
          ))}
        </div>
      )}
      <ul className="cfg-opts">
        {group.options.map(o => {
          const a = avail.get(o.id);
          const selected = selection.includes(o.id);
          const blocked = Boolean(a?.blockedReason) && !selected;
          const consequence = [
            ...(a?.wouldAdd ?? []).map(x => `+ ${names.get(x)}`),
            ...(a?.wouldRemove ?? []).filter(x => !group.options.some(g => g.id === x)).map(x => `− ${names.get(x)}`),
          ];
          return (
            <li key={o.id}>
              <button
                type="button"
                role={group.selectionType === 'SINGLE' ? 'radio' : 'checkbox'}
                aria-checked={selected}
                aria-disabled={blocked || undefined}
                title={a?.blockedReason}
                className={['cfg-opt', selected && 'is-selected', blocked && 'is-blocked'].filter(Boolean).join(' ')}
                onClick={() => click(o.id)}
              >
                <span className={`cfg-opt__mark cfg-opt__mark--${group.selectionType === 'SINGLE' ? 'radio' : 'check'}`} aria-hidden="true">
                  {selected && <Icon icon={Check} size="xs" strokeWidth={2.5} />}
                </span>
                <span className="cfg-opt__text">
                  <span className="cfg-opt__name">{o.name}</span>
                  {o.description && <span className="cfg-opt__desc">{o.description}</span>}
                  {!selected && consequence.length > 0 && <span className="cfg-opt__cons mono">{consequence.join('  ')}</span>}
                </span>
                <span className="cfg-opt__price mono">{o.priceDeltaMinor ? `+ ${fmt.money(o.priceDeltaMinor, currency)}` : t('common.included')}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

function RoomPanel({ sauna }: { sauna: SaunaDetail }) {
  const { t } = useT();
  const fmt = useFormat();
  const rooms = useRooms();
  const { roomId, placement, setRoom, setPlacement, selection } = useConfigurator();
  const room = rooms.data?.items.find(r => r.id === roomId) ?? null;
  const specs = specsOf(sauna);
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
  const [tab, setTab] = useState('options');
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
    if (idParam && existing.data) {
      const c = existing.data;
      st.init(sauna.slug, c.selections, c.id, c.placement ? { id: c.placement.roomSceneId, placement: c.placement } : null);
    } else if (!idParam && st.slug !== sauna.slug) {
      st.init(sauna.slug, defaultSelectionOf(sauna));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sauna.slug, idParam, existing.data]);

  const locked = Boolean(existing.data?.locked);
  const price = useMemo(() => {
    const opts = sauna.groups.flatMap(g => g.options).filter(o => st.selection.includes(o.id));
    return calculatePrice({
      listPriceMinor: sauna.listPriceMinor,
      maxDiscountBps: sauna.maxDiscountBps,
      options: opts.map(o => ({ optionId: o.id, priceDeltaMinor: o.priceDeltaMinor })),
      perSaunaDiscount: sauna.discount,
    });
  }, [sauna, st.selection]);
  const valid = validate(rules, st.selection).valid;

  const save = useMutation({
    mutationFn: async () => {
      let id = st.configurationId;
      if (!id) {
        const c = await api('createConfiguration', { body: { saunaModelId: sauna.id, selections: st.selection } });
        id = c.id;
      } else {
        await api('putSelections', { params: { id }, body: { optionIds: st.selection } });
      }
      await api('putPlacement', { params: { id }, body: st.roomId ? { roomSceneId: st.roomId, ...st.placement } : null });
      return id;
    },
    onSuccess: id => {
      st.saved(id);
      if (params.get('id') !== id) setParams({ id }, { replace: true, preventScrollReset: true });
      void qc.invalidateQueries({ queryKey: ['configurations'] });
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const id = st.dirty || !st.configurationId ? await save.mutateAsync() : st.configurationId;
      return api('submitRequest', { params: { id }, body: message.trim() ? { message: message.trim() } : {} });
    },
    onSuccess: req => {
      setSendOpen(false);
      toast(t('configure.requestSent'), t('configure.requestSentBody'));
      void qc.invalidateQueries({ queryKey: ['requests'] });
      navigate(`/account/requests/${req.id}`);
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });

  const clone = useMutation({
    mutationFn: () => api('clone', { params: { id: st.configurationId! } }),
    onSuccess: c => setParams({ id: c.id }, { replace: true }),
  });

  if (idParam && existing.isPending) return <ConfigureSkeleton />;

  const options = viewerOptionsOf(sauna, st.selection);
  const specs = specsOf(sauna);

  return (
    <div className="page container cfg">
      <div className="cfg__stage">
        <ButtonLink to={`/saunas/${sauna.slug}`} variant="link" icon={ArrowLeft} className="cfg__back">
          {sauna.name}
        </ButtonLink>
        <ViewerSlot name={sauna.name} specs={specs} options={options} lowUrl={sauna.assets.lowGlbUrl} highUrl={sauna.assets.highGlbUrl} allowHigh thumbnailUrl={sauna.assets.thumbnailUrl} eager />
        <div className="cfg__summary">
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
          </dl>
          <div className="cfg__total">
            <Price minor={price.finalPriceMinor} currency={currency} size="xl" label={t('configure.total')} />
            <p className="muted cfg__vat">{t(`vat.${tenant.branding.vatDisplay}`)}</p>
          </div>
        </div>
      </div>

      <aside className="cfg__panel">
        <p className="eyebrow">{t('configure.eyebrow')}</p>
        <ScrambleText as="h1" className="cfg__title" text={sauna.name} />
        {locked ? (
          <div className="cfg__locked">
            <p>{t('configure.locked')}</p>
            <Button onClick={() => clone.mutate()} loading={clone.isPending}>
              {t('configure.clone')}
            </Button>
          </div>
        ) : (
          <>
            <Tabs
              label={t('configure.eyebrow')}
              value={tab}
              onChange={setTab}
              items={[
                {
                  id: 'options',
                  label: t('configure.tabs.options'),
                  panel: (
                    <div className="cfg__groups">
                      {sauna.groups.map(g => (
                        <GroupEditor key={g.id} group={g} sauna={sauna} currency={currency} />
                      ))}
                    </div>
                  ),
                },
                { id: 'room', label: t('configure.tabs.room'), panel: <RoomPanel sauna={sauna} /> },
                {
                  id: 'ar',
                  label: t('configure.tabs.ar'),
                  disabled: !sauna.assets.hasAr,
                  panel: <ArButton saunaModelId={sauna.id} name={sauna.name} enabled />,
                },
              ]}
            />
            <div className="cfg__actions">
              {!valid && <p className="muted cfg__hint">{t('configure.incomplete')}</p>}
              <Button variant="ghost" icon={Save} onClick={() => save.mutate(undefined, { onSuccess: () => toast(t('configure.draftSaved')), onError: e => toast.error(t('errors.title'), errorText(t, e)) })} loading={save.isPending && !send.isPending}>
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
