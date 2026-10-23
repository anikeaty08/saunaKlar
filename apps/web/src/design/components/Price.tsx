import { useEffect, useRef } from 'react';
import { useFormat } from '../../i18n/format.ts';
import { useT } from '../../i18n/i18n.ts';
import { useScramble } from '../../motion/useScramble.ts';
import { SCRAMBLE_DIGITS } from '../../motion/gsap.ts';
import './Price.css';

interface Props {
  minor: number;
  currency: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Struck-through list price shown before the price. */
  listMinor?: number | null;
  label?: string;
  className?: string;
}

/**
 * Large tabular numerals. When the value changes the digits scramble into
 * the new amount; screen readers get the final value via aria-live.
 */
export function Price({ minor, currency, size = 'md', listMinor, label, className }: Props) {
  const fmt = useFormat();
  const { t } = useT();
  const text = fmt.money(minor, currency);
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(text);
  const { play } = useScramble(ref, text, { trigger: 'manual', chars: SCRAMBLE_DIGITS, duration: 0.7, revealDelay: 0.1, speed: 1 });

  useEffect(() => {
    if (prev.current !== text) {
      prev.current = text;
      play(text);
    }
  }, [text, play]);

  const showList = listMinor != null && listMinor > minor;
  return (
    <span className={['price', `price--${size}`, className].filter(Boolean).join(' ')}>
      {label && <span className="price__label">{label}</span>}
      {showList && (
        <s className="price__list">
          <span className="sr-only">{t('detail.listPrice')} </span>
          {fmt.money(listMinor, currency)}
        </s>
      )}
      <span className="price__value" aria-live="polite" aria-atomic="true">
        <span className="sr-only">{text}</span>
        <span ref={ref} aria-hidden="true">
          {text}
        </span>
      </span>
    </span>
  );
}
