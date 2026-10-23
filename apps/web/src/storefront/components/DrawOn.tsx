import { useRef, type ReactNode } from 'react';
import { gsap, ScrollTrigger, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';

/** Draws every stroked path inside (stroke-dashoffset) and then fades the fills in. */
export function DrawOn({ children, className, delay = 0, onScroll = false }: { children: ReactNode; className?: string; delay?: number; onScroll?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      const paths = Array.from(el.querySelectorAll<SVGPathElement>('path'));
      if (!paths.length) return;
      const tl = gsap.timeline({ paused: true, delay });
      paths.forEach(p => {
        const len = p.getTotalLength();
        gsap.set(p, { strokeDasharray: len, strokeDashoffset: len, fillOpacity: 0 });
      });
      tl.to(paths, { strokeDashoffset: 0, duration: 1.6, ease: 'sk.inOut', stagger: { amount: 0.9 } })
        .to(paths, { fillOpacity: 1, duration: 0.8, ease: 'power1.out', stagger: { amount: 0.3 } }, '-=0.8')
        .set(paths, { clearProps: 'strokeDasharray,strokeDashoffset' });
      if (onScroll) ScrollTrigger.create({ trigger: el, start: 'top 85%', once: true, onEnter: () => tl.play() });
      else tl.play();
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
