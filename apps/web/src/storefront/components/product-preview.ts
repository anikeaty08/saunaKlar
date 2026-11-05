import { calculatePrice, type PriceBreakdown } from '@saunaklar/pricing';
import type { SaunaDetail } from '../../api/types.ts';

/** Index `i` wrapped into 0..count-1 (gallery arrows loop round). */
export function wrapIndex(i: number, count: number): number {
  if (count <= 0) return 0;
  return ((i % count) + count) % count;
}

/**
 * Direction of a horizontal swipe from the pointer travel: -1 (to the previous photo),
 * 1 (to the next) or 0 when the gesture was too short or mostly vertical (a scroll).
 */
export function swipeStep(dx: number, dy: number, threshold = 40): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
  return dx < 0 ? 1 : -1;
}

/** Size option groups (width, depth, height; optionally prefixed `size-`), shown as the inline size selector. */
export function isSizeGroup(code: string): boolean {
  return /^(?:size-)?(width|depth|height)$/.test(code);
}

/**
 * Price of a selection as the configurator previews it: effective option prices from the API,
 * this reseller's discount on the subtotal, capped by the manufacturer. The server recomputes it
 * on save, so this is only ever a preview.
 */
export function previewPrice(s: Pick<SaunaDetail, 'groups' | 'listPriceMinor' | 'maxDiscountBps' | 'discount'>, selection: readonly string[]): PriceBreakdown {
  const chosen = new Set(selection);
  const opts = s.groups.flatMap(g => g.options).filter(o => chosen.has(o.id));
  return calculatePrice({
    listPriceMinor: s.listPriceMinor,
    maxDiscountBps: s.maxDiscountBps,
    options: opts.map(o => ({ optionId: o.id, priceDeltaMinor: o.priceDeltaMinor })),
    perSaunaDiscount: s.discount,
  });
}

/** Price difference of picking `optionId` instead of what is chosen in its single-choice group now. */
export function deltaAgainstCurrent(group: Pick<SaunaDetail['groups'][number], 'options'>, selection: readonly string[], optionId: string): number {
  const current = group.options.find(o => selection.includes(o.id));
  const next = group.options.find(o => o.id === optionId);
  return (next?.priceDeltaMinor ?? 0) - (current?.priceDeltaMinor ?? 0);
}
