import { z } from 'zod';

export const uuid = z.guid();
export const isoDateTime = z.iso.datetime({ offset: true });
export const isoDate = z.iso.date();
export const currencyCode = z.string().regex(/^[A-Z]{3}$/);
export const countryCode = z.string().regex(/^[A-Z]{2}$/);
export const slug = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/, 'Lower-case letters, digits and hyphens, 1-32 characters.');
export const hexColor = z.string().regex(/^#[0-9a-f]{6}$/, 'A colour like #1c1c1a.');
export const locale = z.enum(['en', 'de', 'fr', 'it', 'rm']);
export const minorUnits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const basisPoints = z.number().int().min(0).max(10_000);
export const email = z.email().max(254).transform(e => e.trim());

/** Password policy, mirrored by the identity provider (Cognito pool policy in production). */
export const password = z
  .string()
  .min(10, 'At least 10 characters.')
  .max(256)
  .refine(p => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Use upper- and lower-case letters and a digit.');

export const discountType = z.enum(['PERCENT', 'FIXED']);
export const discount = z.object({
  type: discountType,
  /** Basis points for PERCENT, minor units for FIXED. */
  value: z.number().int().nonnegative(),
});
export type DiscountDto = z.infer<typeof discount>;

export const page = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const pageQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const priceBreakdown = z.object({
  currency: currencyCode,
  listPriceMinor: minorUnits,
  optionsTotalMinor: minorUnits,
  subtotalMinor: minorUnits,
  discountSource: z.enum(['SAUNA', 'DEFAULT', 'NONE']),
  discountType: discountType.nullable(),
  discountValue: z.number().int().nullable(),
  discountMinor: minorUnits,
  finalPriceMinor: minorUnits,
  lines: z.array(z.object({ optionId: uuid, priceDeltaMinor: minorUnits })),
});
export type PriceBreakdownDto = z.infer<typeof priceBreakdown>;

export const priceSnapshot = priceBreakdown.extend({
  computedAt: isoDateTime,
  priceValidUntil: isoDateTime,
});
export type PriceSnapshotDto = z.infer<typeof priceSnapshot>;

export const ok = z.object({ ok: z.literal(true) });

/** UI and catalog languages. `en` is the source language and the fallback. */
export const LOCALES = ['en', 'de', 'fr', 'it', 'rm'] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'en';

/** Picks the best supported locale from an Accept-Language header or a `lang` value. */
export function negotiateLocale(...candidates: (string | null | undefined)[]): AppLocale {
  for (const raw of candidates) {
    if (!raw) continue;
    const tags = raw
      .split(',')
      .map(part => {
        const [tag = '', ...params] = part.trim().split(';');
        const q = params.map(p => p.trim()).find(p => p.startsWith('q='));
        return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
      })
      .filter(t => t.tag && t.q > 0)
      .sort((a, b) => b.q - a.q);
    for (const { tag } of tags) {
      const base = tag.split('-')[0] as AppLocale;
      if ((LOCALES as readonly string[]).includes(base)) return base;
    }
  }
  return DEFAULT_LOCALE;
}
