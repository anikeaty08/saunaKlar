import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type PointerEvent as RPointerEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import type { ResponseOf } from '@saunaklar/shared';
import { api } from '../../api/client.ts';
import { tenantQuery, useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { Badge } from '../../design/components/Badge.tsx';
import { Button, IconButton } from '../../design/components/Button.tsx';
import { Input } from '../../design/components/Field.tsx';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { Flip } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { minorToInput, parseMoney, parsePercentBps, useAdminMutation } from './helpers.ts';

type Saunas = ResponseOf<'adminSaunas'>;
type AdminSauna = Saunas['items'][number];
type Discount = { type: 'PERCENT' | 'FIXED'; value: number };

function useDiscountText() {
  const fmt = useFormat();
  const tenant = useTenantData();
  return (d: Discount) => (d.type === 'PERCENT' ? fmt.percentBps(d.value) : fmt.money(d.value, tenant.currency));
}

export function SaunasAdmin() {
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const tenant = useTenantData();
  const discountText = useDiscountText();
  useDocumentTitle(t('admin.nav.saunas'));
  const q = useQuery({ queryKey: ['admin', 'saunas'], queryFn: () => api('adminSaunas') });
  const [order, setOrder] = useState<AdminSauna[]>([]);
  const [editing, setEditing] = useState<AdminSauna | 'default' | null>(null);
  const list = useRef<HTMLUListElement>(null);
  const flipState = useRef<Flip.FlipState | null>(null);
  const drag = useRef<{ id: string; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    if (q.data && !drag.current) setOrder(q.data.items);
  }, [q.data]);

  // Glide rows into their new slots after each reorder.
  useLayoutEffect(() => {
    const s = flipState.current;
    flipState.current = null;
    if (s && list.current) Flip.from(s, { targets: list.current.querySelectorAll('[data-flip-id]'), duration: 0.28, ease: 'sk.out' });
  }, [order]);

  const settle = (d: Saunas) => {
    qc.setQueryData(['admin', 'saunas'], d);
    void qc.invalidateQueries({ queryKey: tenantQuery.queryKey });
  };
  const saveOrder = useAdminMutation((ids: string[]) => api('adminSaunaOrder', { body: { saunaModelIds: ids } }), { success: 'admin.saunas.orderSaved', onSuccess: settle });
  const patch = useAdminMutation(({ id, isVisible }: { id: string; isVisible: boolean }) => api('adminPatchSauna', { params: { id }, body: { isVisible } }), {
    onSuccess: d => {
      qc.setQueryData<Saunas>(['admin', 'saunas'], prev => prev && { ...prev, items: prev.items.map(s => (s.id === d.id ? d : s)) });
      void qc.invalidateQueries({ queryKey: tenantQuery.queryKey });
    },
  });

  const move = (from: number, to: number, commit: boolean) => {
    if (to < 0 || to >= order.length || from === to) return;
    if (list.current && !prefersReducedMotion()) flipState.current = Flip.getState(list.current.querySelectorAll('[data-flip-id]'));
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item!);
    setOrder(next);
    if (commit) saveOrder.mutate(next.map(s => s.id));
  };

  const onPointerDown = (e: RPointerEvent<HTMLElement>, id: string) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, moved: false };
    setDragging(id);
  };
  const onPointerMove = (e: RPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || !list.current) return;
    const rows = [...list.current.querySelectorAll<HTMLElement>('[data-flip-id]')];
    const from = order.findIndex(s => s.id === d.id);
    let to = rows.findIndex(r => {
      const b = r.getBoundingClientRect();
      return e.clientY < b.top + b.height / 2;
    });
    if (to === -1) to = rows.length - 1;
    else if (to > from) to -= 1;
    if (to !== from) {
      d.moved = true;
      move(from, to, false);
    }
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (d?.moved) saveOrder.mutate(order.map(s => s.id));
  };

  if (q.isPending) return <Skeleton lines={10} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const def = q.data.defaultDiscount;

  return (
    <>
      <PageHead title={t('admin.nav.saunas')} lede={t('admin.saunas.lede')} />
      <Panel
        title={t('admin.saunas.defaultDiscount')}
        lede={t('admin.saunas.defaultDiscountLede')}
        action={
          <Button size="sm" variant="ghost" onClick={() => setEditing('default')}>
            {def ? discountText(def) : t('admin.saunas.setDiscount')}
          </Button>
        }
      >
        {null}
      </Panel>
      <Panel title={t('admin.saunas.order')} lede={t('admin.saunas.dragHint')}>
        <ul className={['sauna-admin', dragging && 'is-dragging'].filter(Boolean).join(' ')} ref={list}>
          {order.map((s, i) => {
            const own = s.discount;
            const requested = own ?? def;
            // Capped when what was asked for exceeds the manufacturer maximum for this model.
            const capped = requested ? (requested.type === 'PERCENT' ? requested.value > s.maxDiscountBps : requested.value * 10_000 > s.listPriceMinor * s.maxDiscountBps) : false;
            return (
              <li key={s.id} data-flip-id={s.id} className={['sauna-admin__row', dragging === s.id && 'is-dragged', !s.isVisible && 'is-hidden'].filter(Boolean).join(' ')}>
                <button
                  type="button"
                  className="sauna-admin__handle"
                  aria-label={t('admin.saunas.dragHandle', { name: s.name })}
                  onPointerDown={e => onPointerDown(e, s.id)}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  onKeyDown={e => {
                    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                      e.preventDefault();
                      move(i, e.key === 'ArrowUp' ? i - 1 : i + 1, true);
                      requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-flip-id="${s.id}"] .sauna-admin__handle`)?.focus());
                    }
                  }}
                >
                  <Icon icon={GripVertical} size="sm" />
                </button>
                <span className="sauna-admin__pos mono">{String(i + 1).padStart(2, '0')}</span>
                <span className="sauna-admin__thumb" aria-hidden="true">
                  {s.thumbnailUrl ? <img src={s.thumbnailUrl} alt="" width={64} height={48} loading="lazy" decoding="async" onError={e => (e.currentTarget.style.visibility = 'hidden')} /> : null}
                </span>
                <span className="sauna-admin__name">
                  <span className="staff-strong">{s.name}</span>
                  <span className="staff-sub mono">{s.slug}</span>
                </span>
                <label className="switch">
                  <input type="checkbox" role="switch" checked={s.isVisible} onChange={e => patch.mutate({ id: s.id, isVisible: e.target.checked })} />
                  <span className="switch__track" aria-hidden="true" />
                  <span className="switch__label">{s.isVisible ? t('admin.saunas.visible') : t('admin.saunas.hidden')}</span>
                </label>
                <span className="sauna-admin__price">
                  <span className="mono">{fmt.money(s.priceFromMinor, tenant.currency)}</span>
                  {s.priceFromMinor !== s.listPriceMinor && <s className="staff-sub mono">{fmt.money(s.listPriceMinor, tenant.currency)}</s>}
                </span>
                <span className="sauna-admin__discount">
                  <button type="button" className="sauna-admin__discount-btn" onClick={() => setEditing(s)}>
                    {s.effectiveDiscount ? <Badge tone="solid">{discountText(s.effectiveDiscount)}</Badge> : <Badge tone="dashed">{t('admin.saunas.noDiscount')}</Badge>}
                  </button>
                  <span className="staff-sub">
                    {capped ? t('admin.saunas.capped', { cap: fmt.percentBps(s.maxDiscountBps) }) : !own && def ? t('admin.saunas.inherited') : t('admin.saunas.cap', { cap: fmt.percentBps(s.maxDiscountBps) })}
                  </span>
                </span>
                <span className="sauna-admin__arrows">
                  <IconButton icon={ArrowUp} label={t('admin.saunas.moveUp', { name: s.name })} size="sm" variant="quiet" disabled={i === 0} onClick={() => move(i, i - 1, true)} />
                  <IconButton icon={ArrowDown} label={t('admin.saunas.moveDown', { name: s.name })} size="sm" variant="quiet" disabled={i === order.length - 1} onClick={() => move(i, i + 1, true)} />
                </span>
              </li>
            );
          })}
        </ul>
      </Panel>
      <DiscountDialog target={editing} defaultDiscount={def} onClose={() => setEditing(null)} onSaved={settle} />
    </>
  );
}

function DiscountDialog({ target, defaultDiscount, onClose, onSaved }: { target: AdminSauna | 'default' | null; defaultDiscount: Discount | null; onClose: () => void; onSaved: (d: Saunas) => void }) {
  const { t } = useT();
  const fmt = useFormat();
  const qc = useQueryClient();
  const tenant = useTenantData();
  const current = target === 'default' ? defaultDiscount : target?.discount ?? null;
  const [type, setType] = useState<Discount['type']>('PERCENT');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!target) return;
    setType(current?.type ?? 'PERCENT');
    setValue(current ? (current.type === 'PERCENT' ? String(current.value / 100) : minorToInput(current.value)) : '');
    setError(null);
  }, [target, current]);

  const done = (d: Saunas | AdminSauna, toastKey: 'admin.saunas.discountSaved' | 'admin.saunas.discountRemoved') => {
    if ('items' in d) onSaved(d);
    else {
      qc.setQueryData<Saunas>(['admin', 'saunas'], prev => prev && { ...prev, items: prev.items.map(s => (s.id === d.id ? d : s)) });
      void qc.invalidateQueries({ queryKey: tenantQuery.queryKey });
    }
    onClose();
    return toastKey;
  };
  const save = useAdminMutation(
    async (body: Discount): Promise<Saunas | AdminSauna> => (target === 'default' ? api('adminPutDefaultDiscount', { body }) : api('adminPutSaunaDiscount', { params: { id: (target as AdminSauna).id }, body })),
    { success: 'admin.saunas.discountSaved', onSuccess: d => done(d, 'admin.saunas.discountSaved') },
  );
  const remove = useAdminMutation(async (): Promise<Saunas | AdminSauna> => (target === 'default' ? api('adminDeleteDefaultDiscount') : api('adminDeleteSaunaDiscount', { params: { id: (target as AdminSauna).id } })), {
    success: 'admin.saunas.discountRemoved',
    onSuccess: d => done(d, 'admin.saunas.discountRemoved'),
  });

  const parsed = type === 'PERCENT' ? parsePercentBps(value) : parseMoney(value);
  const cap = target && target !== 'default' ? target.maxDiscountBps : null;
  const overCap = type === 'PERCENT' && cap !== null && parsed !== null && parsed > cap;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed === null || parsed <= 0) return setError(t('validation.required'));
    if (overCap) return setError(t('errors.codes.DISCOUNT_EXCEEDS_CAP'));
    save.mutate({ type, value: parsed });
  };
  const title = target === 'default' ? t('admin.saunas.defaultDiscount') : target ? t('admin.saunas.discountTitle', { name: target.name }) : '';
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      size="sm"
      title={title}
      description={target === 'default' ? t('admin.saunas.defaultDiscountLede') : cap !== null ? t('admin.saunas.cap', { cap: fmt.percentBps(cap) }) : undefined}
      footer={
        <>
          {current && (
            <Button variant="quiet" onClick={() => remove.mutate(undefined)} loading={remove.isPending}>
              {t('admin.saunas.removeDiscount')}
            </Button>
          )}
          <Button type="submit" form="discount-form" loading={save.isPending}>
            {t('staff.save')}
          </Button>
        </>
      }
    >
      <form id="discount-form" className="staff-form" onSubmit={submit} noValidate>
        <Segmented
          label={t('admin.saunas.type')}
          value={type}
          onChange={setType}
          options={[
            { value: 'PERCENT', label: t('admin.saunas.percent') },
            { value: 'FIXED', label: t('admin.saunas.fixed') },
          ]}
        />
        <Input
          label={t('admin.saunas.value')}
          hint={type === 'PERCENT' ? t('admin.saunas.percentHint') : t('admin.saunas.fixedHint', { currency: tenant.currency })}
          inputMode="decimal"
          value={value}
          onChange={e => setValue(e.target.value)}
          error={error ?? (overCap ? t('errors.codes.DISCOUNT_EXCEEDS_CAP') : null)}
          autoFocus
        />
      </form>
    </Dialog>
  );
}
