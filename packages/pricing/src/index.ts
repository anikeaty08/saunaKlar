/**
 * Pricing engine (design section 8). Every amount is an integer in the
 * reseller currency's minor units; percentages are basis points
 * (1000 = 10.00 %). Rounding always floors non-negative values, so the
 * result is deterministic in the browser, the API and the database.
 */

export type DiscountType = 'PERCENT' | 'FIXED';

export interface Discount {
  type: DiscountType;
  /** Basis points for PERCENT, minor units for FIXED. */
  value: number;
}

export interface OptionPrice {
  optionId: string;
  priceDeltaMinor: number;
}

export interface PriceInput {
  listPriceMinor: number;
  maxDiscountBps: number;
  options: readonly OptionPrice[];
  perSaunaDiscount?: Discount | null;
  defaultDiscount?: Discount | null;
}

export type DiscountSource = 'SAUNA' | 'DEFAULT' | 'NONE';

export interface PriceBreakdown {
  listPriceMinor: number;
  optionsTotalMinor: number;
  subtotalMinor: number;
  discountSource: DiscountSource;
  discountType: DiscountType | null;
  discountValue: number | null;
  /** Discount before the manufacturer's cap is applied. */
  rawDiscountMinor: number;
  capMinor: number;
  discountMinor: number;
  /** True when the cap reduced the reseller's discount. */
  clamped: boolean;
  finalPriceMinor: number;
  lines: OptionPrice[];
}

export const MAX_BPS = 10_000;

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

function assertMinor(name: string, v: number): void {
  if (!Number.isSafeInteger(v) || v < 0) throw new PricingError(`${name} must be a non-negative safe integer, got ${v}`);
}

function assertBps(name: string, v: number): void {
  if (!Number.isInteger(v) || v < 0 || v > MAX_BPS) throw new PricingError(`${name} must be an integer between 0 and ${MAX_BPS}, got ${v}`);
}

/** floor(amount × bps / 10000) without floating point or 2^53 overflow. */
export function applyBps(amountMinor: number, bps: number): number {
  assertMinor('amount', amountMinor);
  assertBps('bps', bps);
  return Number((BigInt(amountMinor) * BigInt(bps)) / BigInt(MAX_BPS));
}

export function assertDiscount(d: Discount): void {
  if (d.type === 'PERCENT') assertBps('discount percent', d.value);
  else if (d.type === 'FIXED') assertMinor('discount amount', d.value);
  else throw new PricingError(`unknown discount type ${(d as Discount).type}`);
}

function rawDiscount(subtotal: number, d: Discount): number {
  return d.type === 'PERCENT' ? applyBps(subtotal, d.value) : Math.min(d.value, subtotal);
}

export function calculatePrice(input: PriceInput): PriceBreakdown {
  assertMinor('list price', input.listPriceMinor);
  assertBps('max discount', input.maxDiscountBps);
  const seen = new Set<string>();
  let optionsTotal = 0;
  for (const o of input.options) {
    assertMinor(`price of option ${o.optionId}`, o.priceDeltaMinor);
    if (seen.has(o.optionId)) throw new PricingError(`option ${o.optionId} selected twice`);
    seen.add(o.optionId);
    optionsTotal += o.priceDeltaMinor;
  }
  const subtotal = input.listPriceMinor + optionsTotal;
  assertMinor('subtotal', subtotal);

  // Per-sauna discount wins over the reseller default (8.1).
  let source: DiscountSource = 'NONE';
  let discount: Discount | null = null;
  if (input.perSaunaDiscount) {
    source = 'SAUNA';
    discount = input.perSaunaDiscount;
  } else if (input.defaultDiscount) {
    source = 'DEFAULT';
    discount = input.defaultDiscount;
  }
  if (discount) assertDiscount(discount);

  const raw = discount ? rawDiscount(subtotal, discount) : 0;
  // Every discount is clamped at calculation time: the manufacturer may have
  // lowered the cap after the reseller's discount was written (review G5).
  const cap = applyBps(subtotal, input.maxDiscountBps);
  const applied = Math.min(raw, cap);
  return {
    listPriceMinor: input.listPriceMinor,
    optionsTotalMinor: optionsTotal,
    subtotalMinor: subtotal,
    discountSource: source,
    discountType: discount?.type ?? null,
    discountValue: discount?.value ?? null,
    rawDiscountMinor: raw,
    capMinor: cap,
    discountMinor: applied,
    clamped: applied < raw,
    finalPriceMinor: subtotal - applied,
    lines: input.options.map(o => ({ optionId: o.optionId, priceDeltaMinor: o.priceDeltaMinor })),
  };
}

/**
 * Write-time check for a reseller discount, mirroring the database trigger
 * `trg_discount_within_cap`: a percent discount may not exceed the cap, and a
 * fixed discount may not exceed the cap applied to the bare list price (the
 * smallest possible subtotal).
 */
export function discountWithinCap(d: Discount, listPriceMinor: number, maxDiscountBps: number): boolean {
  assertDiscount(d);
  if (d.type === 'PERCENT') return d.value <= maxDiscountBps;
  return d.value <= applyBps(listPriceMinor, maxDiscountBps);
}

/** Currencies the platform supports and their minor-unit exponent (ISO 4217). */
export const CURRENCY_EXPONENT: Readonly<Record<string, number>> = {
  EUR: 2, CHF: 2, SEK: 2, NOK: 2, DKK: 2, PLN: 2, CZK: 2, HUF: 2, GBP: 2, ISK: 0,
};

export function exponentOf(currency: string): number {
  const e = CURRENCY_EXPONENT[currency];
  if (e === undefined) throw new PricingError(`unsupported currency ${currency}`);
  return e;
}

/** Formats minor units for display, e.g. formatMoney(1290000, 'EUR', 'de-DE') → "12.900,00 €". */
export function formatMoney(minor: number, currency: string, locale = 'en-GB'): string {
  const e = exponentOf(currency);
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: e, maximumFractionDigits: e })
    .format(minor / 10 ** e);
}

/** Parses a decimal major-unit string ("12900.00") into minor units without floating point. */
export function toMinor(major: string | number, currency: string): number {
  const e = exponentOf(currency);
  const s = typeof major === 'number' ? major.toFixed(e) : major.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new PricingError(`invalid amount "${s}"`);
  const frac = (m[2] ?? '').padEnd(e, '0');
  if (frac.length > e) throw new PricingError(`"${s}" has more than ${e} decimals for ${currency}`);
  const v = Number(m[1]) * 10 ** e + (e ? Number(frac) : 0);
  assertMinor('amount', v);
  return v;
}
