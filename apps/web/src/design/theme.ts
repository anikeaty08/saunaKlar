import { contrast, oklchToHex, parseHex, rgbToOklch, type Oklch } from './color.ts';

/**
 * Unary design tokens. Every colour is the brand colour's hue and (scaled)
 * chroma at a different OKLCH lightness — there is no second accent colour.
 *
 *   --ink        text, primary buttons, rules that need weight
 *   --ink-2..6   lightness steps from ink towards paper (2 = strongest)
 *   --paper      page background; --paper-2/3 raised and pressed surfaces
 *   --line       hairlines; --line-strong for inputs
 *   --on-ink     text on an ink surface
 *   --focus      focus ring
 *   --brand      the reseller's colour exactly as configured
 */
export const DEFAULT_PRIMARY = '#1c1c1a';

export type ThemeTokens = Record<`--${string}`, string>;

export interface Theme {
  light: ThemeTokens;
  dark: ThemeTokens;
  /** Colour for `<meta name="theme-color">` and the 3D viewer background. */
  metaLight: string;
  metaDark: string;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export function deriveTheme(primaryHex: string): Theme {
  const rgb = parseHex(primaryHex) ?? parseHex(DEFAULT_PRIMARY)!;
  const base = rgbToOklch(rgb);
  // Achromatic input has an undefined hue; pin it so the steps stay neutral.
  const hue = base.c < 0.002 ? 90 : base.h;
  const chroma = Math.min(base.c, 0.2);
  const tint = Math.min(chroma, 0.04);
  const c = (l: number, k: number): string => oklchToHex({ l, c: k, h: hue });

  // Ink must read as text on paper: keep the brand colour when it is dark
  // enough, otherwise darken it along lightness only.
  const inkL = Math.min(base.l, 0.4);
  const inkC = chroma;

  const light = {
    paper: 0.975,
    ink: inkL,
  };
  const dark = {
    paper: 0.175,
    ink: 0.955,
  };

  // Lightness steps from ink to paper. ink-2 and ink-3 carry text, so they are
  // pulled back towards ink (lightness only) until they clear WCAG AA on paper.
  const minContrast = [7, 4.75, 0, 0, 0];
  const steps = (from: number, to: number, fromC: number, toC: number) =>
    [0.12, 0.26, 0.45, 0.65, 0.82].map((t, i) => {
      const paperHex = c(to, toC);
      let tt = t;
      let hex = c(lerp(from, to, tt), lerp(fromC, toC, tt));
      while (minContrast[i]! > 0 && contrast(hex, paperHex) < minContrast[i]! && tt > 0) {
        tt = Math.max(0, tt - 0.01);
        hex = c(lerp(from, to, tt), lerp(fromC, toC, tt));
      }
      return hex;
    });

  const paperC = tint * 0.22;
  const lightInkSteps = steps(light.ink, light.paper, inkC, paperC);
  const darkInkC = Math.min(chroma, 0.03);
  const darkPaperC = tint * 0.35;
  const darkInkSteps = steps(dark.ink, dark.paper, darkInkC, darkPaperC);

  const brand = oklchToHex(base.c < 0.002 ? { ...base, h: hue } : base);

  const lightTokens: ThemeTokens = {
    '--brand': brand,
    '--ink': c(light.ink, inkC),
    '--ink-2': lightInkSteps[0]!,
    '--ink-3': lightInkSteps[1]!,
    '--ink-4': lightInkSteps[2]!,
    '--ink-5': lightInkSteps[3]!,
    '--ink-6': lightInkSteps[4]!,
    '--paper': c(light.paper, paperC),
    '--paper-2': c(0.952, tint * 0.3),
    '--paper-3': c(0.925, tint * 0.38),
    '--line': c(0.88, tint * 0.4),
    '--line-strong': c(0.74, tint * 0.6),
    '--on-ink': c(light.paper, paperC),
    '--focus': c(Math.min(inkL + 0.08, 0.5), Math.max(inkC, 0.02)),
  };

  const darkTokens: ThemeTokens = {
    '--brand': brand,
    '--ink': c(dark.ink, darkInkC * 0.6),
    '--ink-2': darkInkSteps[0]!,
    '--ink-3': darkInkSteps[1]!,
    '--ink-4': darkInkSteps[2]!,
    '--ink-5': darkInkSteps[3]!,
    '--ink-6': darkInkSteps[4]!,
    '--paper': c(dark.paper, darkPaperC),
    '--paper-2': c(0.21, tint * 0.4),
    '--paper-3': c(0.245, tint * 0.45),
    '--line': c(0.3, tint * 0.45),
    '--line-strong': c(0.42, tint * 0.55),
    '--on-ink': c(dark.paper, darkPaperC),
    '--focus': c(0.88, Math.max(darkInkC, 0.02)),
  };

  return { light: lightTokens, dark: darkTokens, metaLight: lightTokens['--paper']!, metaDark: darkTokens['--paper']! };
}

const block = (tokens: ThemeTokens) => Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`).join('\n');

/** CSS for a `<style>` element: light on :root, dark under prefers-color-scheme. */
export function themeCss(theme: Theme): string {
  return `:root {\n${block(theme.light)}\n  color-scheme: light dark;\n}\n@media (prefers-color-scheme: dark) {\n  :root {\n${block(theme.dark)}\n  }\n}\n`;
}

/** Installs (or replaces) the tenant theme on the document. */
export function applyTheme(primaryHex: string | null | undefined): Theme {
  const theme = deriveTheme(primaryHex || DEFAULT_PRIMARY);
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
