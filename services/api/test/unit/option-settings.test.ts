import { describe, expect, it } from 'vitest';
import { validate } from '@saunaklar/rules';
import type { AdminSaunaOptions } from '@saunaklar/shared';
import { buildOffer, effectiveOptionPrice, type OfferRow } from '../../src/domain/catalog.ts';
import { livePrice } from '../../src/domain/configurations.ts';
import type { LoadedModel } from '../../src/domain/catalog.ts';
import { checkOptionSettings } from '../../src/routes/admin.ts';
import { ApiError } from '../../src/lib/problem.ts';

/** Reseller option settings (0015): effective offer, server-side pricing and admin validation. */
const row = (group: string, option: string, price: number, o: Partial<OfferRow> = {}): OfferRow => ({
  group_id: group, group_code: group, group_name: group, group_description: null, selection_type: group === 'extras' ? 'MULTI' : 'SINGLE',
  is_required: group !== 'extras', option_id: option, option_code: option, option_name: option, option_description: `${option} (manufacturer)`,
  swatch_color: null, is_default: false, price_delta_minor: String(price), enabled: true, price_override_minor: null,
  description_override: null, thumb_key: null, glb_key: null, ...o,
});
const rows = (settings: Record<string, Partial<OfferRow>> = {}) => [
  row('wood', 'spruce', 0, { is_default: true, ...settings.spruce }),
  row('wood', 'cedar', 129_000, settings.cedar),
  row('heater', 'h6', 0, { is_default: true, ...settings.h6 }),
  row('extras', 'led', 24_000, settings.led),
  row('extras', 'audio', 49_000, settings.audio),
  row('extras', 'aroma', 18_000, settings.aroma),
];
const requires = [{ optionId: 'audio', requiredOptionId: 'led' }];

function model(offerRows: OfferRow[], discount: { perSauna?: LoadedModel['pricing']['perSaunaDiscount']; def?: LoadedModel['pricing']['defaultDiscount'] } = {}): LoadedModel {
  const offer = buildOffer(offerRows, requires, [], 'test', 'EUR');
  return {
    detail: {} as LoadedModel['detail'],
    rules: offer.rules,
    pricing: { listPriceMinor: 1_000_000, maxDiscountBps: 1500, perSaunaDiscount: discount.perSauna ?? null, defaultDiscount: discount.def ?? null, optionPrices: offer.optionPrices },
    isVisible: true,
  };
}

describe('effective option price', () => {
  it('uses the override when there is one, including an override of 0', () => {
    expect(effectiveOptionPrice(18_000, null)).toBe(18_000);
    expect(effectiveOptionPrice(18_000, 15_000)).toBe(15_000);
    expect(effectiveOptionPrice(18_000, 0)).toBe(0);
  });
});

describe('buildOffer', () => {
  it('drops disabled options from groups and rules, keeps effective prices and descriptions', () => {
    const offer = buildOffer(rows({ cedar: { enabled: false }, aroma: { price_override_minor: '15000', description_override: 'Our blend.' } }), requires, [], 'test', 'EUR');
    const ids = offer.groups.flatMap(g => g.options.map(o => o.id));
    expect(ids).not.toContain('cedar');
    const aroma = offer.groups.find(g => g.code === 'extras')!.options.find(o => o.id === 'aroma')!;
    expect(aroma).toMatchObject({ priceDeltaMinor: 15_000, description: 'Our blend.' });
    expect(offer.groups.find(g => g.code === 'extras')!.options.find(o => o.id === 'led')!.description).toBe('led (manufacturer)');
    // The disabled option is unknown to the rules engine: the server rejects it on save/lock.
    expect(validate(offer.rules, ['cedar', 'h6']).issues.map(i => i.code)).toContain('UNKNOWN_OPTION');
    // ... but an old draft that still holds it can be priced.
    expect(offer.optionPrices.get('cedar')).toBe(129_000);
  });

  it('disables an option whose required option is disabled, and filters the rule', () => {
    const offer = buildOffer(rows({ led: { enabled: false } }), requires, [], 'test', 'EUR');
    expect(offer.groups.find(g => g.code === 'extras')!.options.map(o => o.id)).toEqual(['aroma']);
    expect(offer.rules.requires).toEqual([]);
  });

  it('offers a required group in full when every option of it was disabled (catalog drift)', () => {
    const offer = buildOffer(rows({ spruce: { enabled: false }, cedar: { enabled: false } }), requires, [], 'test', 'EUR');
    expect(offer.groups.find(g => g.code === 'wood')!.options.map(o => o.id)).toEqual(['spruce', 'cedar']);
  });
});

describe('server-side price with overrides and discounts', () => {
  it('sums effective option prices, then applies the per-sauna discount within the cap', () => {
    const m = model(rows({ cedar: { price_override_minor: '100000' }, aroma: { price_override_minor: '15000' } }), { perSauna: { type: 'PERCENT', value: 1000 }, def: { type: 'FIXED', value: 1 } });
    const p = livePrice(m, ['cedar', 'h6', 'aroma']);
    expect(p.optionsTotalMinor).toBe(115_000);
    expect(p.subtotalMinor).toBe(1_115_000);
    expect(p.discountSource).toBe('SAUNA');
    expect(p.discountMinor).toBe(111_500); // 10 % of the subtotal (floor), under the 15 % cap
    expect(p.finalPriceMinor).toBe(1_003_500);
    expect(p.lines).toEqual([{ optionId: 'cedar', priceDeltaMinor: 100_000 }, { optionId: 'h6', priceDeltaMinor: 0 }, { optionId: 'aroma', priceDeltaMinor: 15_000 }]);
  });

  it('clamps a fixed default discount to the cap computed on the overridden subtotal', () => {
    const m = model(rows({ cedar: { price_override_minor: '0' } }), { def: { type: 'FIXED', value: 500_000 } });
    const p = livePrice(m, ['cedar', 'h6']);
    expect(p.subtotalMinor).toBe(1_000_000);
    expect(p.discountSource).toBe('DEFAULT');
    expect(p.discountMinor).toBe(150_000);
    expect(p.clamped).toBe(true);
  });
});

describe('checkOptionSettings', () => {
  const current: AdminSaunaOptions = {
    saunaModelId: 'm', currency: 'EUR',
    groups: [
      { id: 'wood', code: 'wood', name: 'Wood', selectionType: 'SINGLE', required: true, options: ['spruce', 'cedar'].map(id => opt(id)) },
      { id: 'extras', code: 'extras', name: 'Extras', selectionType: 'MULTI', required: false, options: ['led', 'audio'].map(id => opt(id)) },
    ],
    requires,
  };
  function opt(id: string) {
    return { id, code: id, name: id, description: null, isDefault: false, enabled: true, basePriceMinor: 0, priceOverrideMinor: null, effectivePriceMinor: 0, descriptionOverride: null };
  }
  const set = (optionId: string, enabled: boolean) => ({ optionId, enabled, priceOverrideMinor: null, descriptionOverride: null });
  const code = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as ApiError).code;
    }
    return 'OK';
  };

  it('accepts disabling one option of a required group and both ends of a requires pair', () => {
    expect(code(() => checkOptionSettings(current, [set('cedar', false), set('led', false), set('audio', false)]))).toBe('OK');
  });
  it('refuses to disable a whole required group', () => {
    expect(code(() => checkOptionSettings(current, [set('spruce', false), set('cedar', false)]))).toBe('OPTION_RULES_VIOLATED');
  });
  it('refuses to disable an option an enabled option requires', () => {
    expect(code(() => checkOptionSettings(current, [set('led', false)]))).toBe('OPTION_RULES_VIOLATED');
  });
  it('refuses options of another sauna and duplicates', () => {
    expect(code(() => checkOptionSettings(current, [set('foreign', false)]))).toBe('VALIDATION_FAILED');
    expect(code(() => checkOptionSettings(current, [set('cedar', false), set('cedar', true)]))).toBe('VALIDATION_FAILED');
  });
});
