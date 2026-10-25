import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { useSession } from '../../api/queries.ts';
import type { Session } from '../../api/types.ts';

type CustomerSession = Extract<Session, { kind: 'customer' }>;

/** Renders children for a signed-in customer; otherwise sends to login with `?next=`. */
export function RequireCustomer({ children, fallback }: { children: (s: CustomerSession) => ReactNode; fallback: ReactNode }) {
  const session = useSession();
  const { pathname, search } = useLocation();
  if (session.isPending) return <>{fallback}</>;
  if (session.data?.kind !== 'customer') return <Navigate to={`/account/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return <>{children(session.data)}</>;
}
