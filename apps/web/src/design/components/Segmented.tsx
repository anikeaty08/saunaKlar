import { useId, useRef, type KeyboardEvent } from 'react';
import './Segmented.css';

interface Props<V extends string> {
  label: string;
  value: V;
  options: { value: V; label: string }[];
  onChange: (v: V) => void;
  size?: 'sm' | 'md';
  hideLabel?: boolean;
}

/** Radiogroup rendered as a segmented control; the ink pill slides to the selection. */
export function Segmented<V extends string>({ label, value, options, onChange, size = 'md', hideLabel }: Props<V>) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex(o => o.value === value));
  const onKey = (e: KeyboardEvent) => {
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (index + 1) % options.length;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!.value);
    refs.current[next]?.focus();
  };
  return (
    <div className={`segmented segmented--${size}`}>
      <span id={id} className={hideLabel ? 'sr-only' : 'segmented__label'}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="segmented__track" onKeyDown={onKey} style={{ ['--seg-count' as string]: options.length, ['--seg-index' as string]: index }}>
        <span className="segmented__pill" aria-hidden="true" />
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            tabIndex={o.value === value ? 0 : -1}
            className="segmented__opt"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
