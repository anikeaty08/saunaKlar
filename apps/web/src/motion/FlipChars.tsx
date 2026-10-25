import { useRef, type ElementType } from 'react';
import { gsap, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';

interface Props {
  text: string;
  as?: ElementType;
  className?: string;
  delay?: number;
  /** Start when scrolled into view instead of on mount. */
  onScroll?: boolean;
}

/**
 * Characters flip up into place (rotateX from below, per-character stagger),
 * and each one turns over once more on hover. Screen readers get the plain
 * text through aria-label.
 */
export function FlipChars({ text, as, className, delay = 0, onScroll = false }: Props) {
  const Tag = (as ?? 'p') as ElementType;
  const ref = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      const chars = el.querySelectorAll('[data-char]');
      const intro = { yPercent: 90, rotateX: -95, opacity: 0, transformOrigin: '50% 100%', duration: 1.3, ease: 'expo.out', stagger: 0.028, delay };
      if (onScroll) gsap.from(chars, { ...intro, scrollTrigger: { trigger: el, start: 'top bottom-=60', once: true } });
      else gsap.from(chars, intro);
      const flip = (e: Event) => {
        const c = (e.target as HTMLElement).closest('[data-char]');
        if (!c || gsap.isTweening(c)) return;
        gsap.fromTo(c, { rotateX: 0 }, { rotateX: 360, duration: 0.9, ease: 'power3.inOut', transformOrigin: '50% 55%' });
      };
      el.addEventListener('mouseover', flip);
      return () => el.removeEventListener('mouseover', flip);
    },
    { scope: ref, dependencies: [text, delay, onScroll] },
  );

  const words = text.split(' ');
  return (
    <Tag ref={ref} className={className} aria-label={text}>
      {words.map((w, wi) => (
        <span key={wi} aria-hidden="true" className="flipchars__word">
          {[...w].map((ch, ci) => (
            <span key={ci} data-char className="flipchars__char">
              {ch}
            </span>
          ))}
          {wi < words.length - 1 && <span className="flipchars__char">&nbsp;</span>}
        </span>
      ))}
    </Tag>
  );
}
