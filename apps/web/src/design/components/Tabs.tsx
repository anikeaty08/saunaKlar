import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: ReactNode;
  panel: ReactNode;
  disabled?: boolean;
}

interface Props {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  className?: string;
}

/** WAI-ARIA tabs with roving focus (arrows, Home, End) and an ink underline that slides. */
export function Tabs({ items, value, onChange, label, className }: Props) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = items.filter(i => !i.disabled);
  const activeIndex = Math.max(0, items.findIndex(i => i.id === value));

  const onKey = (e: KeyboardEvent) => {
    const idx = enabled.findIndex(i => i.id === value);
    let next = -1;
    if (e.key === 'ArrowRight') next = (idx + 1) % enabled.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + enabled.length) % enabled.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = enabled.length - 1;
    if (next < 0) return;
    e.preventDefault();
    const target = enabled[next]!;
    onChange(target.id);
    refs.current[items.indexOf(target)]?.focus();
  };

  return (
    <div className={['tabs', className].filter(Boolean).join(' ')}>
      <div role="tablist" aria-label={label} className="tabs__list" onKeyDown={onKey} style={{ ['--tab-count' as string]: items.length, ['--tab-index' as string]: activeIndex }}>
        {items.map((it, i) => (
          <button
            key={it.id}
            ref={el => {
              refs.current[i] = el;
            }}
            role="tab"
            type="button"
            id={`${base}-tab-${it.id}`}
            aria-controls={`${base}-panel-${it.id}`}
            aria-selected={it.id === value}
            tabIndex={it.id === value ? 0 : -1}
            disabled={it.disabled}
            className="tabs__tab"
            onClick={() => onChange(it.id)}
          >
            {it.label}
          </button>
        ))}
        <span className="tabs__ink" aria-hidden="true" />
      </div>
      {items.map(it => (
        <div key={it.id} role="tabpanel" id={`${base}-panel-${it.id}`} aria-labelledby={`${base}-tab-${it.id}`} hidden={it.id !== value} tabIndex={0} className="tabs__panel">
          {it.id === value && it.panel}
        </div>
      ))}
    </div>
  );
}
