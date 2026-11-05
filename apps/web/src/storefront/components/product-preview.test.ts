import { describe, expect, it } from 'vitest';
import { deltaAgainstCurrent, isSizeGroup, previewPrice, swipeStep, wrapIndex } from './product-preview.ts';

describe('wrapIndex', () => {
  it('loops round in both directions', () => {
    expect(wrapIndex(-1, 4)).toBe(3);
    expect(wrapIndex(4, 4)).toBe(0);
    expect(wrapIndex(2, 4)).toBe(2);
    expect(wrapIndex(3, 0)).toBe(0);
  });
});

describe('swipeStep', () => {
  it('reads a left swipe as next and a right swipe as previous', () => {
    expect(swipeStep(-80, 5)).toBe(1);
    expect(swipeStep(80, -5)).toBe(-1);
  });
  it('ignores taps and vertical scrolls', () => {
    expect(swipeStep(10, 0)).toBe(0);
    expect(swipeStep(60, 120)).toBe(0);
  });
});

describe('isSizeGroup', () => {
  it('matches the dimension groups only', () => {
    expect(isSizeGroup('width')).toBe(true);
    expect(isSizeGroup('size-depth')).toBe(true);
    expect(isSizeGroup('height')).toBe(true);
    expect(isSizeGroup('wood')).toBe(false);
    expect(isSizeGroup('bench-width')).toBe(false);
  });
});

const sauna = {
  listPriceMinor: 1_000_000,
  maxDiscountBps: 2000,
  discount: { type: 'PERCENT' as const, value: 1000 },
  groups: [
    { options: [{ id: 'w1', priceDeltaMinor: 0 }, { id: 'w2', priceDeltaMinor: 52_200 }] },
    { options: [{ id: 'x', priceDeltaMinor: 100_000 }] },
  ],
} as unknown as Parameters<typeof previewPrice>[0];

describe('previewPrice', () => {
  it('applies the discount to base price plus options', () => {
    const p = previewPrice(sauna, ['w2', 'x']);
    expect(p.subtotalMinor).toBe(1_152_200);
    expect(p.discountMinor).toBe(115_220);
    expect(p.finalPriceMinor).toBe(1_036_980);
  });
  it('caps the discount at the manufacturer maximum', () => {
    const p = previewPrice({ ...sauna, discount: { type: 'PERCENT', value: 5000 } }, []);
    expect(p.discountMinor).toBe(200_000);
  });
});

describe('deltaAgainstCurrent', () => {
  it('gives the difference to the option chosen now', () => {
    const g = sauna.groups[0]!;
    expect(deltaAgainstCurrent(g, ['w1'], 'w2')).toBe(52_200);
    expect(deltaAgainstCurrent(g, ['w2'], 'w1')).toBe(-52_200);
    expect(deltaAgainstCurrent(g, ['w2'], 'w2')).toBe(0);
  });
});
