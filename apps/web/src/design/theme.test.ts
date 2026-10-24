import { describe, expect, it } from 'vitest';
import { contrast, oklchToHex, parseHex, rgbToOklch } from './color.ts';
import { deriveTheme, inkOnPaperContrast } from './theme.ts';

describe('colour maths', () => {
  it('round-trips sRGB through OKLCH', () => {
    for (const hex of ['#1c1c1a', '#ffffff', '#000000', '#1d4ed8', '#b45309', '#7c3aed']) {
      expect(oklchToHex(rgbToOklch(parseHex(hex)!))).toBe(hex);
    }
  });

  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });
});

describe('deriveTheme', () => {
  const brands = ['#5a6b7b', '#2d4a38', '#1c1c1a', '#1a1a1a', '#1d4ed8', '#fde047', '#16a34a', '#be123c', '#ffffff', '#000000'];

  it('keeps ink readable on paper in both modes for any brand colour', () => {
    for (const b of brands) {
      const t = deriveTheme(b);
      expect(inkOnPaperContrast(t, 'light')).toBeGreaterThan(7);
      expect(inkOnPaperContrast(t, 'dark')).toBeGreaterThan(7);
      // Muted text (ink-3) still meets AA for body copy.
      expect(contrast(t.light['--ink-3']!, t.light['--paper']!)).toBeGreaterThan(4.5);
      expect(contrast(t.dark['--ink-3']!, t.dark['--paper']!)).toBeGreaterThan(4.5);
      // …also on raised surfaces (cards, sidebars).
      expect(contrast(t.light['--ink-3']!, t.light['--paper-2']!)).toBeGreaterThan(4.5);
      expect(contrast(t.dark['--ink-3']!, t.dark['--paper-2']!)).toBeGreaterThan(4.5);
    }
  });

  it('uses only the brand hue', () => {
    const t = deriveTheme('#1d4ed8');
    const brandHue = rgbToOklch(parseHex('#1d4ed8')!).h;
    for (const [k, v] of Object.entries(t.light)) {
      const o = rgbToOklch(parseHex(v)!);
      if (o.c > 0.01) expect(Math.abs(o.h - brandHue), k).toBeLessThan(4);
    }
  });

  it('orders ink steps from dark to light', () => {
    const t = deriveTheme('#1c1c1a').light;
    const ls = ['--ink', '--ink-2', '--ink-3', '--ink-4', '--ink-5', '--ink-6', '--paper'].map(k => rgbToOklch(parseHex(t[k as `--${string}`]!)!).l);
    for (let i = 1; i < ls.length; i++) expect(ls[i]!).toBeGreaterThan(ls[i - 1]!);
  });

  it('tints surfaces with the hue instead of pure grey', () => {
    const t = deriveTheme('#2d4a38').light;
    for (const k of ['--paper', '--paper-2', '--line'] as const) expect(rgbToOklch(parseHex(t[k]!)!).c, k).toBeGreaterThan(0.005);
  });

  it('falls back to the default for invalid input', () => {
    expect(deriveTheme('nope').light['--ink']).toBe(deriveTheme('#5a6b7b').light['--ink']);
  });
});
