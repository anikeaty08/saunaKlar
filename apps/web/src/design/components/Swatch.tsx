import { Check } from 'lucide-react';
import { Icon } from './Icon.tsx';
import './Swatch.css';

interface Props {
  color: string;
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  size?: 'sm' | 'md' | 'lg';
  /** Rendered as a radio inside a radiogroup, or as a plain decorative chip. */
  as?: 'radio' | 'chip';
}

/** Material swatch. The only place a non-brand colour appears: it is the product's own colour. */
export function Swatch({ color, label, selected, disabled, onSelect, size = 'md', as = 'radio' }: Props) {
  if (as === 'chip') {
    return <span className={`swatch swatch--${size}`} style={{ ['--swatch' as string]: color }} title={label} role="img" aria-label={label} />;
  }
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onSelect}
      className={`swatch swatch--${size}`}
      style={{ ['--swatch' as string]: color }}
    >
      {selected && <Icon icon={Check} size="xs" strokeWidth={2.5} className="swatch__check" />}
    </button>
  );
}
