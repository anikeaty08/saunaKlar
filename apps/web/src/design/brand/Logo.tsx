import { useRef } from 'react';
import { DrawSVGPlugin } from 'gsap/DrawSVGPlugin';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import './Logo.css';

gsap.registerPlugin(DrawSVGPlugin);

/**
 * The SaunaKlar mark: a rounded room with a bench line and three strokes of
 * heat rising from it. Strokes only, all in currentColor, so it takes the
 * theme (light, dark or a reseller's hue). Drawn on a 32-unit grid with
 * 2.5-unit strokes, it stays legible down to 16px.
 */
export const MARK_PATHS = {
  room: 'M9.5 3.25h13a6.25 6.25 0 0 1 6.25 6.25v13a6.25 6.25 0 0 1-6.25 6.25h-13A6.25 6.25 0 0 1 3.25 22.5v-13A6.25 6.25 0 0 1 9.5 3.25z',
  bench: 'M9 23.25h14',
  heat: ['M11.5 18.5c-1.6-1.7 1.6-3.3 0-5s1.6-3.3 0-5', 'M16 18.5c-1.6-1.7 1.6-3.3 0-5s1.6-3.3 0-5', 'M20.5 18.5c-1.6-1.7 1.6-3.3 0-5s1.6-3.3 0-5'],
} as const;

interface MarkProps {
  className?: string;
  /** Size in px (width = height). */
  size?: number | string;
  /** Draw the strokes in (room, then bench, then heat) on mount. */
  draw?: boolean;
  delay?: number;
  title?: string;
}

export function LogoMark({ className, size = 32, draw = false, delay = 0, title }: MarkProps) {
  const ref = useRef<SVGSVGElement>(null);
  useGSAP(
    () => {
      if (!draw || !ref.current || prefersReducedMotion()) return;
      const q = gsap.utils.selector(ref.current);
      gsap
        .timeline({ delay })
        .from(q('[data-room]'), { drawSVG: '0%', duration: 1.1, ease: 'sk.inOut' })
        .from(q('[data-bench]'), { drawSVG: '50% 50%', duration: 0.5, ease: 'sk.out' }, '-=0.45')
        .from(q('[data-heat]'), { drawSVG: '100% 100%', duration: 0.8, ease: 'sk.out', stagger: 0.12 }, '-=0.25');
    },
    { scope: ref, dependencies: [draw, delay] },
  );
  return (
    <svg
      ref={ref}
      className={['logo-mark', className].filter(Boolean).join(' ')}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      <path data-room d={MARK_PATHS.room} />
      <path data-bench d={MARK_PATHS.bench} />
      {MARK_PATHS.heat.map(d => (
        <path key={d} data-heat d={d} />
      ))}
    </svg>
  );
}

/** Mark plus the "SaunaKlar" wordmark (Klar set lighter). */
export function Logo({ className, size = 28, draw = false, label = 'SaunaKlar' }: { className?: string; size?: number; draw?: boolean; label?: string }) {
  return (
    <span className={['logo', className].filter(Boolean).join(' ')} style={{ ['--logo-size' as string]: `${size}px` }} aria-label={label} role="img">
      <LogoMark size={size} draw={draw} />
      <span className="logo__word" aria-hidden="true">
        Sauna<span className="logo__klar">Klar</span>
      </span>
    </span>
  );
}
