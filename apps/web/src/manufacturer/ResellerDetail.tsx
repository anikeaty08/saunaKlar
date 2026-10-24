import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Ban, ExternalLink as ExternalIcon, Lock, Pencil, RotateCcw, UserPlus, Users } from 'lucide-react';
import { inviteAdminRequest } from '@saunaklar/shared';
import { api } from '../api/client.ts';
import { useT, type TKey } from '../i18n/i18n.ts';
import { useFormat } from '../i18n/format.ts';
import { errorText } from '../i18n/errorText.ts';
import { useDocumentTitle } from '../app/useDocumentTitle.ts';
import { Badge, StatusBadge } from '../design/components/Badge.tsx';
import { Button } from '../design/components/Button.tsx';
import { Checkbox, Input, Select } from '../design/components/Field.tsx';
import { Dialog } from '../design/components/Dialog.tsx';
import { EmptyState } from '../design/components/EmptyState.tsx';
import { ErrorPage } from '../design/components/ErrorBoundary.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { Table, type Column } from '../design/components/Table.tsx';
import { toast } from '../design/components/Toast.tsx';
import { PageHead, Panel } from '../staff/index.ts';
import { useAssignments, useReseller, useStoreReseller, useToggleAssignment, type Assignment, type ResellerDetail as Detail } from './data.ts';
import { PageSkeleton, TableSkeletonRows } from './ui.tsx';

export function ResellerDetail() {
  const { id = '' } = useParams();
  const { t } = useT();
  const fmt = useFormat();
  const q = useReseller(id);
  useDocumentTitle(q.data?.name ?? t('manufacturer.resellers'));
  if (q.isPending) return <PageSkeleton />;
  if (q.error) return <ErrorPage error={q.error} />;
  const r = q.data;
  return (
    <>
      <PageHead
        crumbs={[{ label: t('manufacturer.resellers'), to: '/resellers' }, { label: r.name }]}
        title={r.name}
        meta={
          <>
            <StatusBadge status={r.status} />
            <span className="mono staff-muted">{r.slug}</span>
            <span className="mono staff-muted">{r.currency}</span>
            <span className="staff-muted">{t('manufacturer.catalogVersion', { version: r.catalogVersion })}</span>
            <span className="staff-muted">{t('manufacturer.shareExpiry', { days: t('staff.days', { count: r.defaultShareExpiryDays }) })}</span>
          </>
        }
        actions={
          <>
            <a className="btn btn--ghost btn--md" href={r.storefrontUrl} target="_blank" rel="noreferrer">
              <span className="btn__label">{t('staff.viewStorefront')}</span>
              <Icon icon={ExternalIcon} size="sm" className="btn__icon btn__icon--after" />
            </a>
            <StatusAction reseller={r} />
          </>
        }
      />
      <dl className="mfr-facts">
        <div>
          <dt>{t('manufacturer.customers')}</dt>
          <dd className="mono">{fmt.number(r.customers)}</dd>
        </div>
        <div>
          <dt>{t('manufacturer.openRequests')}</dt>
          <dd className="mono">{fmt.number(r.openRequests)}</dd>
        </div>
        <div>
          <dt>{t('manufacturer.saunasAssigned')}</dt>
          <dd className="mono">{fmt.number(r.saunasAssigned)}</dd>
        </div>
        <div>
          <dt>{t('staff.created')}</dt>
          <dd className="mono">{fmt.date(r.createdAt)}</dd>
        </div>
      </dl>
      <div className="staff-grid staff-grid--main-side">
        <div className="staff-grid">
          <Assignments resellerId={r.id} currency={r.currency} />
          <Rooms reseller={r} />
        </div>
        <div className="staff-grid">
          <Rename reseller={r} />
          <Admins reseller={r} />
        </div>
      </div>
    </>
  );
}

function StatusAction({ reseller: r }: { reseller: Detail }) {
  const { t } = useT();
  const store = useStoreReseller();
  const [open, setOpen] = useState(false);
  const suspend = r.status === 'ACTIVE';
  const m = useMutation({
    mutationFn: () => api('mPatchReseller', { params: { id: r.id }, body: { status: suspend ? 'SUSPENDED' : 'ACTIVE' } }),
    onSuccess: d => {
      store(d);
      setOpen(false);
      toast(t('manufacturer.statusChanged', { status: t(`status.${d.status}` as TKey) }));
    },
    onError: e => toast.error(errorText(t, e)),
  });
  return (
    <>
      <Button variant={suspend ? 'ghost' : 'primary'} icon={suspend ? Ban : RotateCcw} onClick={() => setOpen(true)}>
        {suspend ? t('manufacturer.suspend') : t('manufacturer.reactivate')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        size="sm"
        title={suspend ? t('manufacturer.suspendTitle', { name: r.name }) : t('manufacturer.reactivateTitle', { name: r.name })}
        description={suspend ? t('manufacturer.suspendBody') : t('manufacturer.reactivateBody')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button loading={m.isPending} icon={suspend ? Ban : RotateCcw} onClick={() => m.mutate()}>
              {suspend ? t('manufacturer.suspend') : t('manufacturer.reactivate')}
            </Button>
          </>
        }
      />
    </>
  );
}

function Rename({ reseller: r }: { reseller: Detail }) {
  const { t } = useT();
  const store = useStoreReseller();
  const [name, setName] = useState(r.name);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setName(r.name), [r.name]);
  const m = useMutation({
    mutationFn: (value: string) => api('mPatchReseller', { params: { id: r.id }, body: { name: value } }),
    onSuccess: d => {
      store(d);
      toast(t('staff.saved'));
    },
    onError: e => setError(errorText(t, e)),
  });
  const dirty = name.trim() !== r.name;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('validation.required'));
    if (dirty) m.mutate(name.trim());
  };
  return (
    <Panel title={t('manufacturer.details')}>
      <form className="staff-form" onSubmit={submit} noValidate>
        <Input label={t('staff.name')} required value={name} onChange={e => setName(e.target.value)} error={error} />
        <div className="staff-form__actions">
          <Button type="submit" size="sm" icon={Pencil} loading={m.isPending} disabled={!dirty}>
            {t('manufacturer.rename')}
          </Button>
          {dirty && <span className="staff-muted mfr-note">{t('staff.unsaved')}</span>}
        </div>
      </form>
    </Panel>
  );
}

function Admins({ reseller: r }: { reseller: Detail }) {
  const { t } = useT();
  const [inviting, setInviting] = useState(false);
  return (
    <Panel
      title={t('manufacturer.admins')}
      action={
        <Button size="sm" variant="ghost" icon={UserPlus} onClick={() => setInviting(true)}>
          {t('manufacturer.invite')}
        </Button>
      }
    >
      {r.admins.length === 0 ? (
        <EmptyState icon={Users} title={t('manufacturer.noAdmins')} compact />
      ) : (
        <ul className="mfr-people">
          {r.admins.map(a => (
            <li key={a.id}>
              <span className="mfr-people__avatar" aria-hidden="true">
                {a.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="mfr-people__who">
                <span className="staff-strong">{a.displayName}</span>
                <span className="staff-sub">{a.email}</span>
              </span>
              <span className="mfr-people__tags">
                <Badge tone="outline">{t(`staff.roles.${a.role}` as TKey)}</Badge>
                <Badge tone={a.status === 'ACTIVE' ? 'solid' : a.status === 'INVITED' ? 'dashed' : 'muted'}>{t(`manufacturer.adminStatus.${a.status}` as TKey)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      <InviteDialog reseller={r} open={inviting} onClose={() => setInviting(false)} />
    </Panel>
  );
}

function InviteDialog({ reseller: r, open, onClose }: { reseller: Detail; open: boolean; onClose: () => void }) {
  const { t } = useT();
  const store = useStoreReseller();
  const [f, setF] = useState({ email: '', displayName: '', role: 'ADMIN' as 'ADMIN' | 'OWNER' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const close = () => {
    setF({ email: '', displayName: '', role: 'ADMIN' });
    setErrors({});
    setFormError(null);
    onClose();
  };
  const m = useMutation({
    mutationFn: (body: { email: string; displayName: string; role: 'ADMIN' | 'OWNER' }) => api('mInviteAdmin', { params: { id: r.id }, body }),
    onSuccess: (d, v) => {
      store(d);
      toast(t('manufacturer.invited', { email: v.email }));
      close();
    },
    onError: e => setFormError(errorText(t, e)),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = inviteAdminRequest.safeParse(f);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.path[0] === 'email' ? t('validation.email') : t('validation.required');
      return setErrors(errs);
    }
    setErrors({});
    m.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('manufacturer.invite')}
      description={t('manufacturer.inviteLede', { name: r.name })}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="mfr-invite" icon={UserPlus} loading={m.isPending}>
            {t('manufacturer.sendInvite')}
          </Button>
        </>
      }
    >
      <form id="mfr-invite" className="staff-form" onSubmit={submit} noValidate>
        {formError && (
          <p className="staff-login__error" role="alert">
            {formError}
          </p>
        )}
        <Input label={t('staff.email')} type="email" required autoComplete="off" value={f.email} onChange={e => setF(s => ({ ...s, email: e.target.value }))} error={errors.email} />
        <Input label={t('staff.name')} required autoComplete="off" value={f.displayName} onChange={e => setF(s => ({ ...s, displayName: e.target.value }))} error={errors.displayName} />
        <Select
          label={t('manufacturer.role')}
          value={f.role}
          onChange={e => setF(s => ({ ...s, role: e.target.value as 'ADMIN' | 'OWNER' }))}
          options={[
            { value: 'ADMIN', label: t('staff.roles.ADMIN') },
            { value: 'OWNER', label: t('staff.roles.OWNER') },
          ]}
        />
      </form>
    </Dialog>
  );
}

function Assignments({ resellerId, currency }: { resellerId: string; currency: string }) {
  const { t } = useT();
  const q = useAssignments(resellerId);
  const toggle = useToggleAssignment(resellerId);
  const pending = toggle.isPending ? toggle.variables?.saunaId : undefined;

  const cols: Column<Assignment>[] = [
    {
      key: 'name',
      header: t('staff.name'),
      cell: a => (
        <>
          <span className="staff-strong">{a.name}</span>
          <span className="staff-sub mono">{a.slug}</span>
        </>
      ),
      sortValue: a => a.name,
    },
    {
      key: 'state',
      header: t('staff.status'),
      cell: a =>
        a.blockedReason ? (
          <span className="mfr-blocked">
            <Icon icon={Lock} size="xs" />
            {t('manufacturer.blocked', { reason: a.blockedReason })}
          </span>
        ) : a.assigned ? (
          <span className="mfr-state">
            <Badge tone="solid">{t('manufacturer.assigned')}</Badge>
            {a.isVisible === false && <span className="staff-sub">{t('manufacturer.hiddenByReseller')}</span>}
          </span>
        ) : (
          <Badge tone="muted">{t('manufacturer.notAssigned')}</Badge>
        ),
      sortValue: a => (a.assigned ? 0 : a.blockedReason ? 2 : 1),
    },
    {
      key: 'toggle',
      header: <span className="sr-only">{t('staff.actions')}</span>,
      label: t('staff.actions'),
      align: 'end',
      cell: a => (
        <label className={['mfr-switch', a.blockedReason && !a.assigned && 'is-disabled'].filter(Boolean).join(' ')}>
          <input
            type="checkbox"
            role="switch"
            checked={a.assigned}
            disabled={(Boolean(a.blockedReason) && !a.assigned) || pending === a.saunaModelId}
            aria-label={t('manufacturer.offerSauna', { name: a.name })}
            onChange={e =>
              toggle.mutate(
                { saunaId: a.saunaModelId, assign: e.target.checked },
                { onError: err => toast.error(errorText(t, err)) },
              )
            }
          />
          <span className="mfr-switch__track" aria-hidden="true">
            <span className="mfr-switch__thumb" />
          </span>
        </label>
      ),
    },
  ];

  return (
    <Panel title={t('manufacturer.assignments')} lede={t('manufacturer.assignmentsLedeCurrency', { currency })}>
      {q.error ? (
        <ErrorPage error={q.error} />
      ) : (
        <>
          <Table columns={cols} rows={q.data?.items ?? []} rowKey={a => a.saunaModelId} loading={q.isPending} caption={t('manufacturer.assignments')} empty={<EmptyState title={t('manufacturer.noSaunas')} compact />} />
          {q.isPending && <TableSkeletonRows rows={5} />}
        </>
      )}
    </Panel>
  );
}

function Rooms({ reseller: r }: { reseller: Detail }) {
  const { t } = useT();
  const store = useStoreReseller();
  const initial = r.rooms.filter(x => x.assigned).map(x => x.id);
  const [selected, setSelected] = useState<string[]>(initial);
  const key = initial.join(',');
  useEffect(() => setSelected(key ? key.split(',') : []), [key]);
  const dirty = [...selected].sort().join(',') !== [...initial].sort().join(',');
  const m = useMutation({
    mutationFn: (ids: string[]) => api('mPutRooms', { params: { id: r.id }, body: { roomSceneIds: ids } }),
    onSuccess: d => {
      store(d);
      toast(t('staff.saved'));
    },
    onError: e => toast.error(errorText(t, e)),
  });
  return (
    <Panel
      title={t('manufacturer.rooms')}
      lede={t('manufacturer.roomsLede')}
      action={
        <Button size="sm" disabled={!dirty} loading={m.isPending} onClick={() => m.mutate(selected)}>
          {t('common.save')}
        </Button>
      }
    >
      {r.rooms.length === 0 ? (
        <EmptyState title={t('manufacturer.noRooms')} compact />
      ) : (
        <fieldset className="mfr-rooms">
          <legend className="sr-only">{t('manufacturer.rooms')}</legend>
          {r.rooms.map(room => (
            <Checkbox
              key={room.id}
              label={room.name}
              description={<span className="mono">{room.code}</span>}
              checked={selected.includes(room.id)}
              onChange={e => setSelected(s => (e.target.checked ? [...s, room.id] : s.filter(x => x !== room.id)))}
            />
          ))}
        </fieldset>
      )}
      {dirty && <p className="staff-muted mfr-note">{t('staff.unsaved')}</p>}
    </Panel>
  );
}

