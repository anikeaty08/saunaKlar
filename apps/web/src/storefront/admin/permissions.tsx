import { Lock } from 'lucide-react';
import { useSession } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { Icon } from '../../design/components/Icon.tsx';

export type StaffRole = 'OWNER' | 'ADMIN' | 'MANUFACTURER_ADMIN';

/**
 * Shop settings, branding, layout, discounts, sauna visibility/order and per-option prices are
 * the OWNER's; the API enforces the same rule (access `reseller-owner`), this only shapes the UI.
 */
export const canManageShop = (role: StaffRole | null | undefined): boolean => role === 'OWNER';

/** Whether the signed-in reseller staff user may change shop settings (from the session query). */
export function useCanManageShop(): boolean {
  const s = useSession().data;
  return s?.kind === 'staff' && canManageShop(s.staff.role);
}

/** Short explanation shown to an ADMIN where owner-only controls are read-only. */
export function OwnerOnlyNote() {
  const { t } = useT();
  return (
    <p className="owner-note" role="note">
      <Icon icon={Lock} size="sm" />
      <span>{t('admin.ownerOnly')}</span>
    </p>
  );
}
