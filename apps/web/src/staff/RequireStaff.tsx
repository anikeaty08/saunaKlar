import type { ReactNode } from 'react';
import { useSession } from '../api/queries.ts';
import type { Session } from '../api/types.ts';
import { useT } from '../i18n/i18n.ts';
import { Skeleton } from '../design/components/Skeleton.tsx';
import { StaffLogin } from './StaffLogin.tsx';

export type StaffSession = Extract<Session, { kind: 'staff' }>;

/**
 * Renders the admin for staff of the given scope; anyone else gets the staff
 * sign-in in place (the URL stays, so a deep link survives sign-in).
 */
export function RequireStaff({ scope, title, brand, children }: { scope: 'RESELLER' | 'MANUFACTURER'; title: string; brand: ReactNode; children: (s: StaffSession) => ReactNode }) {
  const { t } = useT();
  const session = useSession();
  if (session.isPending)
    return (
      <div className="staff-login" aria-hidden="true">
        <div className="staff-login__panel">
          <Skeleton width="40%" />
          <Skeleton width="80%" height="3rem" />
          <Skeleton lines={4} />
        </div>
      </div>
    );
  const s = session.data;
  if (s?.kind === 'staff' && s.staff.scope === scope) return <>{children(s)}</>;
  const notice = s?.kind === 'customer' ? t('staff.wrongAccount') : s?.kind === 'staff' ? t('staff.notStaffHere') : null;
  return <StaffLogin title={title} brand={brand} notice={notice} />;
}
