import { useRef } from 'react';
import { gsap, ScrollTrigger, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';

interface Props {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}

/** Counts up to `value` when scrolled into view; reduced motion shows the value. */
export function NumberTicker({ value, format = n => Math.round(n).toLocaleString(), duration = 1.6, className }: Props) {
  const ref = useRef<HTMLSpanElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el) return;
      if (prefersReducedMotion()) {
        el.textContent = format(value);
        return;
      }
      const obj = { n: 0 };
      el.textContent = format(0);
      ScrollTrigger.create({
        trigger: el,
        start: 'top 92%',
        once: true,
        onEnter: () => gsap.to(obj, { n: value, duration, ease: 'sk.out', onUpdate: () => void (el.textContent = format(obj.n)) }),
      });
    },
    { dependencies: [value], scope: ref },
  );
  return (
    <span className={['mono', className].filter(Boolean).join(' ')}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden="true">{format(value)}</span>
    </span>
  );
}
