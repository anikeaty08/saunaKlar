import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.ts';
import { useSession } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { Button } from '../../design/components/Button.tsx';
import { Input } from '../../design/components/Field.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHead, Panel } from '../../staff/PageHead.tsx';
import { useAdminMutation } from './helpers.ts';

export function SettingsAdmin() {
  const { t } = useT();
  const qc = useQueryClient();
  const session = useSession().data;
  useDocumentTitle(t('admin.nav.settings'));
  const q = useQuery({ queryKey: ['admin', 'settings'], queryFn: () => api('adminSettings') });
  const [days, setDays] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setDays(String(q.data.defaultShareExpiryDays));
  }, [q.data]);
  const save = useAdminMutation((n: number) => api('adminPatchSettings', { body: { defaultShareExpiryDays: n } }), {
    success: 'admin.settings.saved',
    onSuccess: d => qc.setQueryData(['admin', 'settings'], d),
  });
  if (q.isPending) return <Skeleton lines={4} />;
  if (q.error) return <ErrorPage error={q.error} onRetry={() => void q.refetch()} />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1 || n > 90) return setError(t('admin.settings.shareExpiryHint'));
    setError(null);
    save.mutate(n);
  };
  return (
    <>
      <PageHead title={t('admin.nav.settings')} lede={t('admin.settings.lede')} />
      <Panel title={t('admin.configurations.shareLinks')}>
        <form className="staff-form" onSubmit={submit} noValidate>
          <Input label={t('admin.settings.shareExpiry')} hint={t('admin.settings.shareExpiryHint')} type="number" min={1} max={90} inputMode="numeric" value={days} onChange={e => setDays(e.target.value)} error={error} style={{ maxWidth: '10rem' }} />
          <div className="staff-form__actions">
            <Button type="submit" loading={save.isPending} disabled={days === String(q.data.defaultShareExpiryDays)}>
              {t('staff.save')}
            </Button>
          </div>
        </form>
      </Panel>
      {session?.kind === 'staff' && (
        <Panel title={t('admin.settings.account')}>
          <dl className="kv">
            <dt>{t('staff.name')}</dt>
            <dd>{session.staff.displayName}</dd>
            <dt>{t('staff.email')}</dt>
            <dd>{session.staff.email}</dd>
            <dt>{t('manufacturer.role')}</dt>
            <dd>{t(`staff.roles.${session.staff.role}` as TKey)}</dd>
          </dl>
        </Panel>
      )}
    </>
  );
}
