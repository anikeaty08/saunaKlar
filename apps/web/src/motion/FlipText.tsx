import { useRef, type ElementType } from 'react';
import { gsap, SplitText, useGSAP } from './gsap.ts';
import { prefersReducedMotion } from './preferences.ts';
import './motion.css';

interface Props {
  text: string;
  as?: ElementType;
  className?: string;
  /** `parent`: the closest link/button is the hover area (default). `self`: this element. */
  trigger?: 'parent' | 'self';
  stagger?: number;
}

/**
 * Vertical "flip-flop": SplitText cuts the label into characters, each becomes
 * a two-row roller, and on hover the rollers turn up one after another, then
 * back down on leave. The visible copy is aria-hidden; the real text stays
 * readable for assistive technology.
 */
export function FlipText({ text, as, className, trigger = 'parent', stagger = 0.016 }: Props) {
  const Tag = (as ?? 'span') as ElementType;
  const ref = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const el = ref.current;
      if (!el || prefersReducedMotion()) return;
      const split = SplitText.create(el, { type: 'chars', charsClass: 'flip-char', aria: 'none' });
      for (const ch of split.chars as HTMLElement[]) {
        const c = ch.textContent ?? '';
        ch.textContent = '';
        const roll = document.createElement('span');
        roll.className = 'flip-roll';
        const a = document.createElement('span');
        const b = document.createElement('span');
        a.textContent = c;
        b.textContent = c;
        roll.append(a, b);
        ch.append(roll);
      }
      const rolls = el.querySelectorAll<HTMLElement>('.flip-roll');
      const host = trigger === 'parent' ? ((el.closest('a,button,[data-flip-host]') as HTMLElement | null) ?? el) : el;
      const up = () => gsap.to(rolls, { yPercent: -50, duration: 0.55, ease: 'sk.out', stagger, overwrite: true });
      const down = () => gsap.to(rolls, { yPercent: 0, duration: 0.5, ease: 'sk.out', stagger: { each: stagger, from: 'end' }, overwrite: true });
      host.addEventListener('pointerenter', up);
      host.addEventListener('pointerleave', down);
      host.addEventListener('focusin', up);
      host.addEventListener('focusout', down);
      return () => {
        host.removeEventListener('pointerenter', up);
        host.removeEventListener('pointerleave', down);
        host.removeEventListener('focusin', up);
        host.removeEventListener('focusout', down);
        split.revert();
      };
    },
    { dependencies: [text, trigger, stagger], revertOnUpdate: true },
  );

  return (
    <Tag className={['flip-text', className].filter(Boolean).join(' ')}>
      <span className="sr-only">{text}</span>
      <span ref={ref} className="flip-text__visual" aria-hidden="true">
        {text}
      </span>
    </Tag>
  );
}
