import type { LucideIcon } from 'lucide-react';

export type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
const SIZES: Record<IconSize, number> = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 };

interface Props {
  icon: LucideIcon;
  size?: IconSize;
  /** Decorative by default; pass a label when the icon carries meaning on its own. */
  label?: string;
  className?: string;
  strokeWidth?: number;
}

/** Every lucide icon goes through here so size and stroke stay consistent. */
export function Icon({ icon: Glyph, size = 'sm', label, className, strokeWidth = 1.5 }: Props) {
  const px = SIZES[size];
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={strokeWidth}
      absoluteStrokeWidth
      className={['icon', className].filter(Boolean).join(' ')}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable="false"
    />
  );
}
