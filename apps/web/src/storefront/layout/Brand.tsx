import { Link } from 'react-router';
import type { Tenant } from '../../api/types.ts';

/** Tenant logo, or a typographic wordmark with a small ink mark when there is no logo. */
export function Brand({ tenant, onClick }: { tenant: Tenant; onClick?: () => void }) {
  const name = tenant.branding.displayName;
  return (
    <Link to="/" className="brand" onClick={onClick} aria-label={name}>
      {tenant.branding.logoUrl ? (
        <img src={tenant.branding.logoUrl} alt="" className="brand__logo" height={28} />
      ) : (
        <>
          <span className="brand__mark" aria-hidden="true" />
          <span className="brand__name">{name}</span>
        </>
      )}
    </Link>
  );
}
