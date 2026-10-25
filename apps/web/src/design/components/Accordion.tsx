import { useId, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { Icon } from './Icon.tsx';
import './Accordion.css';

function Item({ title, children, index, defaultOpen }: { title: ReactNode; children: ReactNode; index: number; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useGSAP(
    () => {
      const el = panel.current;
      if (!el) return;
      if (first.current || prefersReducedMotion()) {
        first.current = false;
        gsap.set(el, { height: open ? 'auto' : 0 });
        return;
      }
      gsap.to(el, { height: open ? 'auto' : 0, duration: 0.6, ease: 'sk.out' });
      if (open) gsap.fromTo(el.firstElementChild, { y: -8, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.5, delay: 0.1 });
    },
    { dependencies: [open] },
  );
  return (
    <div className={['acc__item', open && 'is-open'].filter(Boolean).join(' ')}>
      <h3 className="acc__heading">
        <button type="button" className="acc__trigger" aria-expanded={open} aria-controls={`${id}-p`} id={`${id}-b`} onClick={() => setOpen(o => !o)}>
          <span className="acc__num mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="acc__title">{title}</span>
          <Icon icon={Plus} size="md" className="acc__icon" />
        </button>
      </h3>
      <div ref={panel} id={`${id}-p`} role="region" aria-labelledby={`${id}-b`} className="acc__panel" hidden={!open && first.current ? true : undefined} inert={!open || undefined}>
        <div className="acc__content">{children}</div>
      </div>
    </div>
  );
}

/** Disclosure list (FAQ): numbered rows, GSAP height animation, native buttons with aria-expanded. */
export function Accordion({ items }: { items: { id: string; title: ReactNode; body: ReactNode }[] }) {
  return (
    <div className="acc">
      {items.map((it, i) => (
        <Item key={it.id} title={it.title} index={i}>
          {it.body}
        </Item>
      ))}
    </div>
  );
}
