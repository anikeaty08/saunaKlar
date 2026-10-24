import { Link } from 'react-router';
import type { Tenant } from '../../api/types.ts';
import { LogoMark } from '../../design/brand/Logo.tsx';
import { DotWord } from '../../design/brand/DotWordmark.tsx';

/**
 * The reseller's uploaded logo; without one, the SaunaKlar mark beside a dotted
 * wordmark of the reseller's name.
 */
export function Brand({ tenant, onClick, intro = true }: { tenant: Tenant; onClick?: () => void; intro?: boolean }) {
  const name = tenant.branding.displayName;
  return (
    <Link to="/" className="brand" onClick={onClick} aria-label={name}>
      {tenant.branding.logoUrl ? (
        <img src={tenant.branding.logoUrl} alt="" className="brand__logo" height={28} />
      ) : (
        <>
          <LogoMark className="brand__mark" size={26} />
          <DotWord text={name} className="brand__dots" intro={intro} />
        </>
      )}
    </Link>
  );
}
