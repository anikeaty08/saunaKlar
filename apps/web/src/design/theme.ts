import { contrast, oklchToHex, parseHex, rgbToOklch, type Oklch } from './color.ts';

/**
 * Unary design tokens, modelled on a cool slate system: low-chroma surfaces,
 * a near-black ink of the hue, and mid tones (umber, taupe, stone, sand) that
 * keep a little more of the hue. There is no second accent colour.
 *
 *   --ink        text, primary buttons, rules that need weight (near-black)
 *   --ink-2..6   lightness steps from ink towards paper (2 = strongest)
 *   --paper      page background; --paper-2/3 raised and pressed surfaces
 *   --card       the lightest surface (cards, dialogs)
 *   --line       hairlines; --line-strong for inputs
 *   --on-ink     text on an ink surface
 *   --focus      focus ring
 *   --accent     the hue at mid lightness (decorative dots, stop marks)
 *   --brand      the reseller's colour exactly as configured
 *   --night*     the footer band: stays dark in both modes
 */
/** Platform default: slate. Also the fallback for a reseller without a colour. */
export const DEFAULT_PRIMARY = '#5a6b7b';

/** The slate palette verbatim, used for the platform default in light mode. */
const SLATE_LIGHT: ThemeTokens = {
  '--ink': '#0a1016',
  '--ink-2': '#1b242c',
  '--ink-3': '#47525c',
  '--ink-4': '#74808b',
  '--ink-5': '#b4bdc6',
  '--ink-6': '#e3e7eb',
  '--paper': '#f3f5f7',
  '--card': '#ffffff',
  '--paper-3': '#e3e7eb',
  '--line-strong': '#b4bdc6',
  '--on-ink': '#f3f5f7',
  '--focus': '#74808b',
  '--accent': '#5a6b7b',
  '--night': '#0a1016',
  '--night-2': '#1b242c',
  '--on-night': '#f3f5f7',
  '--night-muted': '#8d99a4',
  '--night-line': '#2a333c',
};

export type ThemeTokens = Record<`--${string}`, string>;

/**
 * How a storefront layout bends the derivation: `warm` pulls the surfaces
 * towards wood and paper (nordic), `dark` serves the dark set in both modes
 * (showroom). The ink, contrast targets and accent stay the hue's own.
 */
export type ThemeFlavour = 'default' | 'warm' | 'dark';

export interface Theme {
  light: ThemeTokens;
  dark: ThemeTokens;
  /** `dark`: the dark tokens apply in both colour schemes. */
  scheme: 'auto' | 'dark';
  /** Colour for `<meta name="theme-color">` and the 3D viewer background. */
  metaLight: string;
  metaDark: string;
}

/** Chroma for a step: the hue's own chroma scaled, then capped (surfaces stay quiet). */
const k = (c0: number, f: number, cap: number) => Math.min(c0 * f, cap);

export function deriveTheme(primaryHex: string, flavour: ThemeFlavour = 'default'): Theme {
  const rgb = parseHex(primaryHex) ?? parseHex(DEFAULT_PRIMARY)!;
  const base = rgbToOklch(rgb);
  // Achromatic input has an undefined hue; pin it to slate so the tint stays cool and faint.
  const neutral = base.c < 0.002;
  const hue = neutral ? 250 : base.h;
  const c0 = neutral ? 0.012 : Math.min(base.c, 0.2);
  const c = (l: number, ch: number): string => oklchToHex({ l, c: ch, h: hue });
  // Warm: surfaces lean two thirds of the way to a wood hue (≈75°) with a little more chroma.
  const warm = flavour === 'warm';
  const woodHue = (() => {
    const d = ((75 - hue + 540) % 360) - 180;
    return (hue + d * (neutral ? 1 : 0.66) + 360) % 360;
  })();
  const sc = warm ? 0.02 : 0;
  const surf = (l: number, ch: number): string => (warm ? oklchToHex({ l, c: ch + sc, h: woodHue }) : c(l, ch));

  // Text steps are pulled towards ink (lightness only) until they clear their
  // contrast target on the given surface; 5.05 keeps ink-3 at AA on paper-2 too.
  const fit = (l: number, ch: number, towards: number, surface: string, min: number) => {
    let ll = l;
    let hex = c(ll, ch);
    while (contrast(hex, surface) < min && Math.abs(ll - towards) > 0.005) {
      ll += Math.sign(towards - ll) * 0.005;
      hex = c(ll, ch);
    }
    return hex;
  };

  // ---- light ----------------------------------------------------------------
  const lp = surf(0.965, k(c0, 0.15, 0.01));
  const lp2 = surf(0.94, k(c0, 0.22, 0.014));
  const light: ThemeTokens = {
    '--ink': c(0.16, k(c0, 0.7, 0.035)),
    '--ink-2': fit(0.25, k(c0, 0.75, 0.04), 0.16, lp, 7),
    '--ink-3': fit(0.44, k(c0, 0.9, 0.05), 0.16, lp2, 5.05),
    '--ink-4': c(0.6, k(c0, 0.8, 0.05)),
    '--ink-5': c(0.79, k(c0, 0.6, 0.035)),
    '--ink-6': c(0.92, k(c0, 0.3, 0.02)),
    '--paper': lp,
    '--paper-2': lp2,
    '--paper-3': surf(0.915, k(c0, 0.3, 0.02)),
    '--card': surf(0.99, k(c0, 0.05, 0.004) * (warm ? 0.4 : 1)),
    '--line': surf(0.895, k(c0, 0.35, 0.022)),
    '--line-strong': surf(0.79, k(c0, 0.6, 0.035)),
    '--on-ink': lp,
    '--focus': c(0.6, k(c0, 0.8, 0.05)),
    '--accent': c(0.53, k(c0, 1, 0.11)),
    '--night': c(0.16, k(c0, 0.7, 0.035)),
    '--night-2': c(0.24, k(c0, 0.75, 0.04)),
    '--on-night': lp,
    '--night-muted': c(0.68, k(c0, 0.7, 0.045)),
    '--night-line': c(0.3, k(c0, 0.7, 0.035)),
  };

  // ---- dark -----------------------------------------------------------------
  const dp = surf(flavour === 'dark' ? 0.15 : 0.175, k(c0, 0.5, 0.018));
  const dp2 = surf(flavour === 'dark' ? 0.19 : 0.21, k(c0, 0.55, 0.02));
  const dark: ThemeTokens = {
    '--ink': c(0.955, k(c0, 0.2, 0.012)),
    '--ink-2': fit(0.86, k(c0, 0.3, 0.02), 0.955, dp, 7),
    '--ink-3': fit(0.74, k(c0, 0.5, 0.03), 0.955, dp2, 5.05),
    '--ink-4': c(0.6, k(c0, 0.6, 0.035)),
    '--ink-5': c(0.43, k(c0, 0.6, 0.03)),
    '--ink-6': c(0.3, k(c0, 0.55, 0.025)),
    '--paper': dp,
    '--paper-2': dp2,
    '--paper-3': surf(0.25, k(c0, 0.55, 0.022)),
    '--card': surf(flavour === 'dark' ? 0.2 : 0.225, k(c0, 0.55, 0.02)),
    '--line': surf(0.31, k(c0, 0.55, 0.022)),
    '--line-strong': c(0.44, k(c0, 0.6, 0.03)),
    '--on-ink': dp,
    '--focus': c(0.7, k(c0, 0.6, 0.04)),
    '--accent': c(0.68, k(c0, 0.9, 0.1)),
    '--night': c(0.13, k(c0, 0.5, 0.02)),
    '--night-2': c(0.2, k(c0, 0.55, 0.022)),
    '--on-night': c(0.955, k(c0, 0.2, 0.012)),
    '--night-muted': c(0.68, k(c0, 0.6, 0.035)),
    '--night-line': c(0.27, k(c0, 0.55, 0.022)),
  };

  const brand = oklchToHex(neutral ? { ...base, h: hue } : base);
  light['--brand'] = brand;
  dark['--brand'] = brand;
  // The platform default uses the slate palette verbatim.
  if (flavour === 'default' && (!parseHex(primaryHex) || primaryHex.toLowerCase() === DEFAULT_PRIMARY)) Object.assign(light, SLATE_LIGHT);

  if (flavour === 'dark') return { light: dark, dark, scheme: 'dark', metaLight: dark['--paper']!, metaDark: dark['--paper']! };
  return { light, dark, scheme: 'auto', metaLight: light['--paper']!, metaDark: dark['--paper']! };
}

const block = (tokens: ThemeTokens) => Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/** CSS for a `<style>` element: light on :root, dark under prefers-color-scheme. */
export function themeCss(theme: Theme): string {
  if (theme.scheme === 'dark') return `:root {\n${block(theme.dark)}\n  color-scheme: dark;\n}\n`;
  return `:root {\n${block(theme.light)}\n  color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${block(theme.dark)}\n  }\n}\n`;
}

/** Installs (or replaces) the tenant theme on the document. */
export function applyTheme(primaryHex: string | null | undefined, flavour: ThemeFlavour = 'default'): Theme {
  const theme = deriveTheme(primaryHex || DEFAULT_PRIMARY, flavour);
  if (typeof document === 'undefined') return theme;
  let el = document.getElementById('tenant-theme') as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = 'tenant-theme';
    document.head.appendChild(el);
  }
  el.textContent = themeCss(theme);
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? theme.metaDark : theme.metaLight);
  return theme;
}

/** For tests and admin previews: does the derived pair keep body text readable? */
export function inkOnPaperContrast(theme: Theme, mode: 'light' | 'dark' = 'light'): number {
  const t = mode === 'light' ? theme.light : theme.dark;
  return contrast(t['--ink']!, t['--paper']!);
}

export type { Oklch };
