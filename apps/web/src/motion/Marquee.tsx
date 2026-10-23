import { useRef, type ReactNode } from 'react';
import { gsap, ScrollTrigger, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';
import './motion.css';

interface Props {
  children: ReactNode;
  /** Pixels per second. */
  speed?: number;
  reverse?: boolean;
  className?: string;
  /** Scroll velocity nudges the speed and direction. */
  scrollBoost?: boolean;
}

/** Endless horizontal ribbon; content is repeated, the copies are aria-hidden. */
export function Marquee({ children, speed = 60, reverse = false, className, scrollBoost = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const t = track.current;
      if (!t || prefersReducedMotion()) return;
      const first = t.children[0] as HTMLElement | undefined;
      if (!first) return;
      const width = first.offsetWidth;
      if (!width) return;
      const tween = gsap.fromTo(t, { x: reverse ? -width : 0 }, { x: reverse ? 0 : -width, duration: width / speed, ease: 'none', repeat: -1 });
      let st: ScrollTrigger | undefined;
      if (scrollBoost) {
        st = ScrollTrigger.create({
          trigger: root.current,
          start: 'top bottom',
          end: 'bottom top',
          onUpdate: self => {
            const v = gsap.utils.clamp(-4, 4, self.getVelocity() / 400);
            gsap.to(tween, { timeScale: (self.direction === 1 ? 1 : -1) * Math.max(1, Math.abs(v)), duration: 0.4, overwrite: true });
          },
        });
      }
      const pause = () => gsap.to(tween, { timeScale: 0.15, duration: 0.6 });
      const play = () => gsap.to(tween, { timeScale: 1, duration: 0.6 });
      root.current?.addEventListener('pointerenter', pause);
      root.current?.addEventListener('pointerleave', play);
      return () => {
        st?.kill();
        root.current?.removeEventListener('pointerenter', pause);
        root.current?.removeEventListener('pointerleave', play);
      };
    },
    { scope: root, dependencies: [speed, reverse] },
  );
  return (
    <div ref={root} className={['marquee', className].filter(Boolean).join(' ')}>
      <div ref={track} className="marquee__track">
        <div className="marquee__group">{children}</div>
        <div className="marquee__group" aria-hidden="true">{children}</div>
        <div className="marquee__group" aria-hidden="true">{children}</div>
      </div>
    </div>
  );
}
