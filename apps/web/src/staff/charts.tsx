import { useId, useRef, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import { gsap } from '../motion/gsap.ts';
import { prefersReducedMotion } from '../motion/preferences.ts';
import { NumberTicker } from '../motion/NumberTicker.tsx';

/**
 * Admin charts. One hue (the brand ink) on purpose: every chart here shows a
 * single measure, so identity never rides on colour; labels and values use
 * text tokens; each chart carries a screen-reader table.
 */

export function StatTile({ label, value, format, hint }: { label: string; value: number; format?: (n: number) => string; hint?: ReactNode }) {
  return (
    <div className="stat">
      <p className="stat__label mono">{label}</p>
      <p className="stat__value">
        <NumberTicker value={value} {...(format ? { format } : {})} />
      </p>
      {hint && <p className="stat__hint">{hint}</p>}
    </div>
  );
}

export function StatGrid({ children }: { children: ReactNode }) {
  return <div className="stat-grid">{children}</div>;
}

interface Datum {
  label: string;
  value: number;
}

/** Vertical bars over time with a hover/focus tooltip. */
export function BarChart({ data, label, format = n => n.toLocaleString(), tickLabel = d => d.label, emptyText }: { data: Datum[]; label: string; format?: (n: number) => string; tickLabel?: (d: Datum) => string; emptyText?: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const max = Math.max(1, ...data.map(d => d.value));
  const total = data.reduce((a, d) => a + d.value, 0);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.bars__bar', { scaleY: 0, transformOrigin: '50% 100%', duration: 0.7, ease: 'sk.out', stagger: { amount: 0.35 }, scrollTrigger: { trigger: root.current, start: 'top 90%', once: true } });
    },
    { scope: root, dependencies: [data.length] },
  );

  const a = active === null ? null : data[active];
  return (
    <figure className="bars" ref={root} aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="bars__cap">
        <span>{label}</span>
        <span className="bars__readout mono" aria-live="polite">
          {a ? `${tickLabel(a)} · ${format(a.value)}` : format(total)}
        </span>
      </figcaption>
      {total === 0 && emptyText ? (
        <p className="bars__empty">{emptyText}</p>
      ) : (
        <div className="bars__plot" aria-hidden="true" onPointerLeave={() => setActive(null)}>
          <span className="bars__max mono">{format(max)}</span>
          {data.map((d, i) => (
            <span key={d.label} className={['bars__slot', active === i && 'is-active'].filter(Boolean).join(' ')} onPointerEnter={() => setActive(i)}>
              <span className="bars__bar" style={{ height: `${(d.value / max) * 100}%` }} />
            </span>
          ))}
        </div>
      )}
      {data.length > 0 && (
        <div className="bars__axis mono" aria-hidden="true">
          <span>{tickLabel(data[0]!)}</span>
          <span>{tickLabel(data[data.length - 1]!)}</span>
        </div>
      )}
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map(d => (
            <tr key={d.label}>
              <th scope="row">{tickLabel(d)}</th>
              <td>{format(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Ranked horizontal bars with the value at the end of each row. */
export function HBarList({ items, label, format = n => n.toLocaleString() }: { items: { key: string; label: ReactNode; value: number }[]; label: string; format?: (n: number) => string }) {
  const root = useRef<HTMLUListElement>(null);
  const max = Math.max(1, ...items.map(i => i.value));
  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.hbars__fill', { scaleX: 0, transformOrigin: '0 50%', duration: 0.8, ease: 'sk.out', stagger: 0.06, scrollTrigger: { trigger: root.current, start: 'top 90%', once: true } });
    },
    { scope: root, dependencies: [items.length] },
  );
  return (
    <ul className="hbars" ref={root} aria-label={label}>
      {items.map(i => (
        <li key={i.key} className="hbars__row">
          <span className="hbars__label">{i.label}</span>
          <span className="hbars__value mono">{format(i.value)}</span>
          <span className="hbars__track" aria-hidden="true">
            <span className="hbars__fill" style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}
