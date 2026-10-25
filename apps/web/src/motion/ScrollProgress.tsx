import { useRef } from 'react';
import { ScrollTrigger, gsap, useGSAP } from './gsap.ts';

/** Thin bar along the bottom edge showing how far down the page you are. */
export function ScrollProgress() {
  const bar = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const el = bar.current;
    if (!el) return;
    const set = gsap.quickSetter(el, 'scaleX');
    const st = ScrollTrigger.create({ start: 0, end: 'max', onUpdate: self => set(self.progress) });
    set(st.progress);
    return () => st.kill();
  });
  return <div ref={bar} className="scroll-progress" aria-hidden="true" />;
}
