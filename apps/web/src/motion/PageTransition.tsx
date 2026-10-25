import { useRef, type ReactNode } from 'react';
import { useLocation, useNavigation } from 'react-router';
import { gsap, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';
import './motion.css';

/**
 * Route change: an ink curtain lifts off the new page while its content rises
 * into place. Only pathname changes animate (filters in the query string do
 * not). The first page load is left to the splash screen.
 */
export function PageTransition({ children, label }: { children: ReactNode; label?: string }) {
  const { pathname } = useLocation();
  const content = useRef<HTMLDivElement>(null);
  const curtain = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  useGSAP(
    () => {
      if (first.current) {
        first.current = false;
        return;
      }
      if (prefersReducedMotion()) return;
      const tl = gsap.timeline();
      tl.set(curtain.current, { scaleY: 1, transformOrigin: '50% 0%' })
        .fromTo(curtain.current?.firstElementChild ?? [], { autoAlpha: 1 }, { autoAlpha: 0, duration: 0.25 }, 0.1)
        .to(curtain.current, { scaleY: 0, duration: 0.75, ease: 'sk.inOut' }, 0.05)
        .fromTo(content.current, { y: 48, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.9, ease: 'sk.out', clearProps: 'transform,opacity,visibility' }, 0.25);
    },
    { dependencies: [pathname] },
  );

  return (
    <>
      <div ref={curtain} className="curtain" aria-hidden="true">
        <span className="curtain__label">{label}</span>
      </div>
      <div ref={content} className="page-tx">
        {children}
      </div>
    </>
  );
}

/** Thin bar at the top while a lazy route chunk or loader is pending. */
export function NavigationProgress() {
  const navigation = useNavigation();
  const bar = useRef<HTMLDivElement>(null);
  const busy = navigation.state !== 'idle';

  useGSAP(
    () => {
      const el = bar.current;
      if (!el) return;
      if (busy) {
        gsap.killTweensOf(el);
        gsap.set(el, { autoAlpha: 1, scaleX: 0 });
        gsap.to(el, { scaleX: 0.85, duration: prefersReducedMotion() ? 0 : 4, ease: 'power3.out' });
      } else if (gsap.getProperty(el, 'scaleX') !== 0) {
        gsap.killTweensOf(el);
        gsap.timeline()
          .to(el, { scaleX: 1, duration: 0.25, ease: 'power2.out' })
          .to(el, { autoAlpha: 0, duration: 0.3 })
          .set(el, { scaleX: 0 });
      }
    },
    { dependencies: [busy] },
  );

  return <div ref={bar} className="nav-progress" role="progressbar" aria-hidden={!busy} aria-label="Loading page" />;
}
