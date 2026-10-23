import { gsap } from '../motion/gsap.ts';
import { prefersReducedMotion } from '../motion/preferences.ts';

/** Lifts the first-paint splash from index.html once real content is on screen. */
export function hideSplash(): void {
  const el = document.getElementById('splash');
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  if (prefersReducedMotion()) {
    el.remove();
    return;
  }
  gsap.timeline({ onComplete: () => el.remove() })
    .to(el.querySelector('.splash__bar'), { scaleX: 1, duration: 0.35, ease: 'power2.out' })
    .to(el, { yPercent: -100, duration: 0.8, ease: 'sk.inOut' }, '+=0.05');
}
