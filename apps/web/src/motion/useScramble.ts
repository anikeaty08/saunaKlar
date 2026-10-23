import { useCallback, useEffect, useRef, type RefObject } from 'react';
import { gsap, ScrollTrigger, SCRAMBLE_CHARS } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';

export interface ScrambleOptions {
  /** When to play: on mount, when scrolled into view, on pointer hover/focus, or only via `play()`. */
  trigger?: 'mount' | 'inview' | 'hover' | 'manual';
  chars?: string;
  duration?: number;
  delay?: number;
  /** 0..1, how quickly the noise changes. */
  speed?: number;
  /** Seconds before the real letters start to settle. */
  revealDelay?: number;
  /** Reveal from the left, right or both ends. */
  rightToLeft?: boolean;
}

/**
 * "Noisy letters": the text resolves out of random glyphs with GSAP's
 * ScrambleTextPlugin. Reduced motion writes the text instantly.
 */
export function useScramble<T extends HTMLElement>(ref: RefObject<T | null>, text: string, opts: ScrambleOptions = {}) {
  const { trigger = 'mount', chars = SCRAMBLE_CHARS, duration, delay = 0, speed = 0.6, revealDelay = 0.15, rightToLeft = false } = opts;
  const tween = useRef<gsap.core.Tween | null>(null);

  const play = useCallback(
    (to: string = text) => {
      const el = ref.current;
      if (!el) return;
      tween.current?.kill();
      if (prefersReducedMotion()) {
        el.textContent = to;
        return;
      }
      tween.current = gsap.to(el, {
        duration: duration ?? Math.min(1.6, 0.45 + to.length * 0.035),
        delay,
        ease: 'none',
        scrambleText: { text: to, chars, speed, revealDelay, rightToLeft, tweenLength: false },
      });
    },
    [ref, text, chars, duration, delay, speed, revealDelay, rightToLeft],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (trigger === 'manual') {
      el.textContent = text;
      return;
    }
    if (trigger === 'mount') {
      play();
      return () => {
        tween.current?.kill();
      };
    }
    if (trigger === 'inview') {
      el.textContent = text;
      const st = ScrollTrigger.create({ trigger: el, start: 'top 90%', once: true, onEnter: () => play() });
      return () => {
        st.kill();
        tween.current?.kill();
      };
    }
    // hover: the closest interactive ancestor is the hit area.
    el.textContent = text;
    const target = (el.closest('a,button,[data-scramble-host]') as HTMLElement | null) ?? el;
    const on = () => play();
    target.addEventListener('pointerenter', on);
    target.addEventListener('focus', on);
    return () => {
      target.removeEventListener('pointerenter', on);
      target.removeEventListener('focus', on);
      tween.current?.kill();
    };
  }, [ref, text, trigger, play]);

  return { play };
}
