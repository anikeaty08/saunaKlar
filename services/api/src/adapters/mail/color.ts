const DEFAULT_INK = '#141414';

/** Accepts `#rrggbb` only; anything else (including CSS injection attempts) falls back to ink. */
export function normaliseColor(value: string | undefined): string {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toLowerCase() : DEFAULT_INK;
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** Mixes the colour with white: `amount` 0 keeps it, 1 is white. Used for tints of the one hue. */
export function tint(hex: string, amount: number): string {
  const mix = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(c + (255 - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/** Mixes the colour with black. */
export function shade(hex: string, amount: number): string {
  const mix = (i: number) =>
    Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

/**
 * The palette of a single-colour mail: the brand hue for accents, a dark shade of the same
 * hue as ink (so light brand colours stay readable), and paper/rule tints of it.
 */
export function palette(primary: string | undefined) {
  const accent = normaliseColor(primary);
  const lum = luminance(accent);
  // Darken light brand colours until text on paper reaches roughly 4.5:1.
  const ink = lum > 0.18 ? shade(accent, lum > 0.5 ? 0.75 : 0.55) : accent;
  return {
    accent: ink,
    ink: shade(normaliseColor(primary), 0.82),
    onAccent: '#ffffff',
    paper: '#ffffff',
    canvas: tint(accent, 0.94),
    rule: tint(accent, 0.8),
    muted: tint(ink, 0.35),
  };
}
