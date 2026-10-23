import { useEffect, useId, useRef, useState, type ReactNode, type KeyboardEvent } from 'react';
import { gsap } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import './Menu.css';

export interface MenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  /** Renders as menuitemradio with aria-checked. */
  checked?: boolean;
  hint?: ReactNode;
}

interface Props {
  /** Content of the trigger button. */
  trigger: ReactNode;
  label: string;
  items: MenuItem[];
  header?: ReactNode;
  align?: 'start' | 'end';
  triggerClassName?: string;
}

/**
 * Menu button (WAI-ARIA menu pattern): Enter/Space/ArrowDown open, arrows
 * move, Esc or Tab closes and focus returns to the trigger. Items cascade in.
 */
export function Menu({ trigger, label, items, header, align = 'end', triggerClassName }: Props) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const radio = items.some(i => i.checked !== undefined);

  const focusItem = (i: number) => list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]')[i]?.focus();

  useEffect(() => {
    if (!open) return;
    const el = list.current;
    if (el && !prefersReducedMotion()) {
      gsap.fromTo(el, { autoAlpha: 0, y: -6 }, { autoAlpha: 1, y: 0, duration: 0.35, ease: 'sk.out' });
      gsap.fromTo(el.querySelectorAll('[role^="menuitem"]'), { autoAlpha: 0, y: -8 }, { autoAlpha: 1, y: 0, duration: 0.4, stagger: 0.035, ease: 'sk.out' });
    }
    const checked = items.findIndex(i => i.checked);
    focusItem(checked >= 0 ? checked : 0);
    const onDoc = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) btn.current?.focus();
  };

  const onListKey = (e: KeyboardEvent) => {
    const nodes = Array.from(list.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
    const idx = nodes.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      nodes[(idx + 1) % nodes.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      nodes[(idx - 1 + nodes.length) % nodes.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      nodes[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      nodes[nodes.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className={`menu menu--${align}`}>
      <button
        ref={btn}
        type="button"
        className={triggerClassName ?? 'menu__trigger'}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {trigger}
      </button>
      {open && (
        <div ref={list} id={id} role="menu" aria-label={label} className="menu__list" onKeyDown={onListKey}>
          {header && <div className="menu__header">{header}</div>}
          {items.map(it => (
            <button
              key={it.key}
              type="button"
              role={radio ? 'menuitemradio' : 'menuitem'}
              aria-checked={radio ? Boolean(it.checked) : undefined}
              tabIndex={-1}
              className="menu__item"
              onClick={() => {
                close();
                it.onSelect();
              }}
            >
              <span>{it.label}</span>
              {it.hint && <span className="menu__hint">{it.hint}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
