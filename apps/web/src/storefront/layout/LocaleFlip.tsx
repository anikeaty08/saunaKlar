import { useEffect, useRef, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { gsap } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { registerLocaleTransition } from '../../i18n/i18n.ts';
import './LocaleFlip.css';

/**
 * Language switch as one chained page flip (≈900 ms, one GSAP timeline):
 *   1. vertical flip, bottom to top (rotateX 0 → 90°); the locale is swapped
 *      at the midpoint while the page is edge-on;
 *   2. straight on, a horizontal flip, left to right (rotateY -90° → 0) back
 *      to flat, already translated.
 * The pivot is the middle of the viewport, not of the (tall) page. A shade
 * darkens the turning face. Reduced motion: a plain cross-fade.
 */
export function LocaleFlip({ children }: { children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null);
  const page = useRef<HTMLDivElement>(null);

  useEffect(() => {
    registerLocaleTransition(
      swap =>
        new Promise<void>(resolve => {
          const el = page.current;
          if (!el) {
            swap();
            resolve();
            return;
          }
          const commit = () => flushSync(swap);
          if (prefersReducedMotion()) {
            gsap.timeline({ onComplete: resolve })
              .to(el, { autoAlpha: 0, duration: 0.18, ease: 'power1.out' })
              .add(commit)
              .to(el, { autoAlpha: 1, duration: 0.22, ease: 'power1.in' });
            return;
          }
          const originY = window.scrollY + window.innerHeight / 2 - (el.getBoundingClientRect().top + window.scrollY);
          gsap.set(el, { transformOrigin: `50% ${originY}px`, transformPerspective: 1800 });
          stage.current?.classList.add('is-flipping');
          gsap.timeline({
            onComplete: () => {
              gsap.set(el, { clearProps: 'transform,transformOrigin,transformPerspective' });
              stage.current?.classList.remove('is-flipping');
              resolve();
            },
          })
            .to(el, { rotateX: 90, duration: 0.34, ease: 'power2.in' })
            .to(el, { '--flip-shade': 0.35, duration: 0.34, ease: 'power2.in' }, 0)
            .add(commit)
            .set(el, { rotateX: 0, rotateY: -90 })
            .to(el, { rotateY: 0, duration: 0.56, ease: 'sk.out' })
            .to(el, { '--flip-shade': 0, duration: 0.5, ease: 'power2.out' }, '<');
        }),
    );
    return () => registerLocaleTransition(null);
  }, []);

  return (
    <div ref={stage} className="locale-stage">
      <div ref={page} className="locale-page">
        {children}
      </div>
    </div>
  );
}
