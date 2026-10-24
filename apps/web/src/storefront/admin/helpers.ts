import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { errorText } from '../../i18n/errorText.ts';
import { toast } from '../../design/components/Toast.tsx';

/** "1’234.50", "1234,5" or "1 234" in major units → minor units (2 decimals), or null. */
export function parseMoney(input: string): number | null {
  const clean = input.replace(/[\s'’_]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

export const minorToInput = (minor: number) => (minor / 100).toFixed(2);

/** "7.5" → 750 basis points, or null. */
export function parsePercentBps(input: string): number | null {
  const clean = input.replace(',', '.').replace('%', '').trim();
  if (!/^\d+(\.\d{0,2})?$/.test(clean)) return null;
  return Math.round(Number(clean) * 100);
}

/** yyyy-mm-dd for <input type=date>, n days from now. */
export const dateInput = (days = 0) => {
  const d = new Date(Date.now() + days * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** End of that local day as ISO. */
export const endOfDayIso = (date: string) => new Date(`${date}T23:59:59`).toISOString();

/**
 * Admin write with the house rules: toast on success, localised problem on
 * error, and invalidation of the lists it touches.
 */
export function useAdminMutation<TVars, TData>(fn: (v: TVars) => Promise<TData>, opts: { success?: TKey | ((d: TData) => string); invalidate?: QueryKey[]; onSuccess?: (d: TData, v: TVars) => void } = {}) {
  const { t } = useT();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (d, v) => {
      if (opts.success) toast(typeof opts.success === 'function' ? opts.success(d) : t(opts.success));
      for (const key of opts.invalidate ?? []) void qc.invalidateQueries({ queryKey: key });
      opts.onSuccess?.(d, v);
    },
    onError: e => toast.error(t('errors.title'), errorText(t, e)),
  });
}

export const fullName = (p: { firstName: string; lastName: string }) => `${p.firstName} ${p.lastName}`.trim();
