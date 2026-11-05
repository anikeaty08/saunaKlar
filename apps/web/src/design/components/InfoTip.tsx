import { useEffect, useId, useRef, useState } from 'react';
import { Info } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { Icon } from './Icon.tsx';
import './InfoTip.css';

interface Props {
  /** What the popover explains, e.g. the option name ("About Thermo aspen"). */
  label: string;
  text: string;
  className?: string;
}

/**
 * An info button with a small popover: replaces the browser `title` tooltip,
 * which keyboard and touch users never see. Opens on click, Enter or Space;
 * closes on Escape, outside click or a second press. The text is linked with
 * aria-describedby so it is announced when the button gets focus.
 */
export function InfoTip({ label, text, className }: Props) {
  const { t } = useT();
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={root} className={['infotip', open && 'is-open', className].filter(Boolean).join(' ')}>
      <button
        type="button"
        className="infotip__btn"
        aria-label={t('common.moreInfo', { name: label })}
        aria-expanded={open}
        aria-describedby={`${id}-tip`}
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
      >
        <Icon icon={Info} size="sm" />
      </button>
      <span id={`${id}-tip`} role="tooltip" className="infotip__pop" hidden={!open}>
        {text}
      </span>
    </span>
  );
}
