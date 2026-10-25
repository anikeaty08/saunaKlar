import { useRef, type ElementType, type ReactNode, type ComponentPropsWithoutRef } from 'react';
import { gsap, ScrollTrigger, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';

type Props<E extends ElementType> = {
  as?: E;
  children: ReactNode;
  /** Animate direct children one after another (default) or the element as a whole. */
  stagger?: number | false;
  y?: number;
  delay?: number;
  start?: string;
} & Omit<ComponentPropsWithoutRef<E>, 'children'>;

/** Staggered fade/translate when the element scrolls into view (once). */
export function Reveal<E extends ElementType = 'div'>({ as, children, stagger = 0.08, y = 28, delay = 0, start = 'top 88%', ...rest }: Props<E>) {
  const Tag = (as ?? 'div') as ElementType;
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      const targets = stagger === false ? [el] : Array.from(el.children);
      if (!targets.length) return;
      gsap.set(targets, { autoAlpha: 0, y });
      ScrollTrigger.batch(targets, {
        start,
        once: true,
        onEnter: batch => gsap.to(batch, { autoAlpha: 1, y: 0, duration: 1, delay, stagger: stagger || 0, ease: 'sk.out', overwrite: true }),
      });
    },
    { scope: ref },
  );
  return (
    <Tag ref={ref} {...rest}>
      {children}
    </Tag>
  );
}
