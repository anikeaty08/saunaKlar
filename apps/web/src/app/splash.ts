import { gsap } from '../motion/gsap.ts';
import { prefersReducedMotion } from '../motion/preferences.ts';

/**
 * Hands over from the index.html loader once real content is on screen: the
 * counter runs to 100 and the sheet lifts away like a curtain. In later loads
 * of the same session (html.sk-seen) it simply lifts.
 */
export function hideSplash(): void {
  const el = document.getElementById('splash');
  if (!el || el.dataset.leaving) return;
  el.dataset.leaving = '1';
  if (prefersReducedMotion()) {
    el.remove();
    return;
  }
  const seen = document.documentElement.classList.contains('sk-seen');
  const count = el.querySelector('.splash__count');
  const bar = el.querySelector('.splash__bar');
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  if (!seen && count) {
    const n = { v: Number(el.dataset.count ?? 0) };
    tl.to(n, { v: 100, duration: 0.45, ease: 'power2.out', onUpdate: () => void (count.textContent = String(Math.round(n.v)).padStart(3, '0')) }, 0).to(
      bar,
      { scaleX: 1, duration: 0.45, ease: 'power2.out' },
      0,
    );
  }
  tl.to(el.querySelector('.splash__mark'), { yPercent: -40, autoAlpha: 0, duration: 0.5, ease: 'sk.snap' }, seen ? 0 : '+=0.05').to(
    el,
    { yPercent: -100, duration: 0.85, ease: 'sk.snap' },
    '<0.1',
  );
}
