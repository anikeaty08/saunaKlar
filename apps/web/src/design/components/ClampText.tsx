import { useLayoutEffect, useRef, useState, type ElementType } from 'react';
import { useT } from '../../i18n/i18n.ts';
import './ClampText.css';

interface Props {
  text: string;
  /** Lines shown before "more". */
  lines?: number;
  className?: string;
  as?: ElementType;
}

/**
 * A secondary text (option or product description) clamped to a few lines,
 * with a "more / less" toggle that only appears when the text overflows.
 * The full text is always in the DOM, so screen readers read all of it.
 */
export function ClampText({ text, lines = 2, className, as: Tag = 'p' }: Props) {
  const { t } = useT();
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    const check = () => setOverflows(el.scrollHeight > el.clientHeight + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text, open, lines]);

  // Inline contexts (inside a <span> or <button>) need an inline wrapper.
  const Root = Tag === 'span' ? 'span' : 'div';
  return (
    <Root className={['clamp', open && 'is-open', className].filter(Boolean).join(' ')}>
      <Tag ref={ref} className="clamp__text" style={{ ['--clamp-lines' as string]: lines }}>
        {text}
      </Tag>
      {(overflows || open) && (
        <button type="button" className="clamp__toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
          {open ? t('common.less') : t('common.more')}
        </button>
      )}
    </Root>
  );
}
