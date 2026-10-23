import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyBps, calculatePrice, discountWithinCap, formatMoney, PricingError, toMinor, type Discount } from '../src/index.ts';

const minor = fc.integer({ min: 0, max: 50_000_000_00 });
const bps = fc.integer({ min: 0, max: 10_000 });
const discount: fc.Arbitrary<Discount> = fc.oneof(
  bps.map(value => ({ type: 'PERCENT' as const, value })),
  minor.map(value => ({ type: 'FIXED' as const, value })),
);
const options = fc.uniqueArray(fc.record({ optionId: fc.uuid(), priceDeltaMinor: fc.integer({ min: 0, max: 5_000_00 }) }), { selector: o => o.optionId, maxLength: 12 });

describe('calculatePrice', () => {
  it('computes the worked example from the design', () => {
    const p = calculatePrice({
      listPriceMinor: 1_290_000,
      maxDiscountBps: 1500,
      options: [{ optionId: 'thermo-ash', priceDeltaMinor: 90_000 }, { optionId: 'led', priceDeltaMinor: 25_000 }],
      perSaunaDiscount: { type: 'PERCENT', value: 1000 },
    });
    expect(p.subtotalMinor).toBe(1_405_000);
    expect(p.discountMinor).toBe(140_500);
    expect(p.finalPriceMinor).toBe(1_264_500);
    expect(p.discountSource).toBe('SAUNA');
    expect(p.clamped).toBe(false);
  });

  it('prefers the per-sauna discount over the default', () => {
    const p = calculatePrice({ listPriceMinor: 10_000, maxDiscountBps: 5000, options: [], perSaunaDiscount: { type: 'FIXED', value: 100 }, defaultDiscount: { type: 'PERCENT', value: 2000 } });
    expect(p.discountSource).toBe('SAUNA');
    expect(p.discountMinor).toBe(100);
  });

  it('falls back to the default discount, then to none', () => {
    expect(calculatePrice({ listPriceMinor: 10_000, maxDiscountBps: 5000, options: [], defaultDiscount: { type: 'PERCENT', value: 2000 } }).discountMinor).toBe(2000);
    const none = calculatePrice({ listPriceMinor: 10_000, maxDiscountBps: 5000, options: [] });
    expect(none.discountSource).toBe('NONE');
    expect(none.finalPriceMinor).toBe(10_000);
  });

  it('clamps any discount to the cap, including a per-sauna one (cap lowered later)', () => {
    const p = calculatePrice({ listPriceMinor: 10_000, maxDiscountBps: 500, options: [], perSaunaDiscount: { type: 'PERCENT', value: 2000 } });
    expect(p.rawDiscountMinor).toBe(2000);
    expect(p.discountMinor).toBe(500);
    expect(p.clamped).toBe(true);
  });

  it('floors percentage discounts', () => {
    expect(calculatePrice({ listPriceMinor: 999, maxDiscountBps: 10_000, options: [], perSaunaDiscount: { type: 'PERCENT', value: 1 } }).discountMinor).toBe(0);
    expect(applyBps(19_999, 5000)).toBe(9999);
  });

  it('rejects bad input', () => {
    expect(() => calculatePrice({ listPriceMinor: -1, maxDiscountBps: 0, options: [] })).toThrow(PricingError);
    expect(() => calculatePrice({ listPriceMinor: 1.5, maxDiscountBps: 0, options: [] })).toThrow(PricingError);
    expect(() => calculatePrice({ listPriceMinor: 1, maxDiscountBps: 10_001, options: [] })).toThrow(PricingError);
    expect(() => calculatePrice({ listPriceMinor: 1, maxDiscountBps: 0, options: [{ optionId: 'a', priceDeltaMinor: 1 }, { optionId: 'a', priceDeltaMinor: 1 }] })).toThrow(/twice/);
  });

  it('does not overflow on large amounts', () => {
    expect(applyBps(Number.MAX_SAFE_INTEGER, 10_000)).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('property: discount never exceeds the cap, final is never negative, arithmetic is consistent', () => {
    fc.assert(fc.property(minor, bps, options, fc.option(discount), fc.option(discount), (list, cap, opts, per, def) => {
      const p = calculatePrice({ listPriceMinor: list, maxDiscountBps: cap, options: opts, perSaunaDiscount: per, defaultDiscount: def });
      expect(Number.isInteger(p.finalPriceMinor)).toBe(true);
      expect(p.discountMinor).toBeLessThanOrEqual(p.capMinor);
      expect(p.discountMinor).toBeLessThanOrEqual(p.subtotalMinor);
      expect(p.finalPriceMinor).toBeGreaterThanOrEqual(0);
      expect(p.finalPriceMinor).toBe(p.listPriceMinor + p.optionsTotalMinor - p.discountMinor);
      expect(p.capMinor).toBe(Math.floor((p.subtotalMinor * cap) / 10_000));
    }));
  });

  it('property: a discount accepted at write time is never clamped on the bare list price', () => {
    fc.assert(fc.property(minor, bps, discount, (list, cap, d) => {
      fc.pre(discountWithinCap(d, list, cap));
      expect(calculatePrice({ listPriceMinor: list, maxDiscountBps: cap, options: [], perSaunaDiscount: d }).clamped).toBe(false);
    }));
  });
});

describe('money helpers', () => {
  it('parses major units exactly', () => {
    expect(toMinor('12900.00', 'EUR')).toBe(1_290_000);
    expect(toMinor('0.1', 'EUR')).toBe(10);
    expect(toMinor(139000, 'SEK')).toBe(13_900_000);
    expect(toMinor('500', 'ISK')).toBe(500);
    expect(() => toMinor('1.234', 'EUR')).toThrow();
    expect(() => toMinor('abc', 'EUR')).toThrow();
    expect(() => toMinor('1', 'XXX')).toThrow();
  });
  it('formats with the currency exponent', () => {
    expect(formatMoney(1_290_000, 'EUR', 'en-GB')).toBe('€12,900.00');
  });
});
