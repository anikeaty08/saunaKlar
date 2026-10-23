import { useCallback, useLayoutEffect, useRef, type DependencyList, type RefObject } from 'react';
import { Flip, gsap } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';

/**
 * Animates a grid between layouts with GSAP Flip. Call `capture()` right
 * before the state change that reorders or filters the children (in the event
 * handler); after React commits, items glide to their new places and new ones
 * fade in. Children need a stable `data-flip-id`.
 */
export function useFlipLayout(container: RefObject<HTMLElement | null>, deps: DependencyList) {
  const state = useRef<Flip.FlipState | null>(null);

  const capture = useCallback(() => {
    const el = container.current;
    if (!el || prefersReducedMotion()) return;
    state.current = Flip.getState(el.querySelectorAll('[data-flip-id]'));
  }, [container]);

  useLayoutEffect(() => {
    const s = state.current;
    const el = container.current;
    state.current = null;
    if (!s || !el) return;
    Flip.from(s, {
      targets: el.querySelectorAll('[data-flip-id]'),
      duration: 0.75,
      ease: 'sk.out',
      stagger: 0.025,
      absolute: true,
      nested: true,
      prune: true,
      onEnter: els => gsap.fromTo(els, { autoAlpha: 0, scale: 0.94, y: 18 }, { autoAlpha: 1, scale: 1, y: 0, duration: 0.6, ease: 'sk.out', stagger: 0.04 }),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { capture };
}
