import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import type { LucideIcon } from 'lucide-react';
import { FlipText } from '../../motion/FlipText.tsx';
import { Icon } from './Icon.tsx';
import './Button.css';

export type ButtonVariant = 'primary' | 'ghost' | 'link' | 'quiet' | 'light';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading/trailing lucide icon. */
  icon?: LucideIcon;
  iconAfter?: LucideIcon;
  /** Plain string labels get the vertical flip on hover. */
  children?: ReactNode;
  block?: boolean;
}

function classes({ variant = 'primary', size = 'md', block }: Common, extra?: string) {
  return ['btn', `btn--${variant}`, `btn--${size}`, block && 'btn--block', extra].filter(Boolean).join(' ');
}

function Inner({ icon, iconAfter, children, loading }: Common & { loading?: boolean }) {
  return (
    <>
      {loading && <span className="btn__loader" aria-hidden="true" />}
      {icon && <Icon icon={icon} size="sm" className="btn__icon" />}
      {typeof children === 'string' ? <FlipText text={children} className="btn__label" /> : children && <span className="btn__label">{children}</span>}
      {iconAfter && <Icon icon={iconAfter} size="sm" className="btn__icon btn__icon--after" />}
    </>
  );
}

export type ButtonProps = Common & ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, iconAfter, children, block, loading, disabled, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={classes({ variant, size, block }, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      <Inner icon={icon} iconAfter={iconAfter} loading={loading}>
        {children}
      </Inner>
    </button>
  );
});

export type ButtonLinkProps = Common & LinkProps;

/** A router link styled as a button. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant, size, icon, iconAfter, children, block, className, ...rest },
  ref,
) {
  return (
    <Link ref={ref} className={classes({ variant, size, block }, className)} {...rest}>
      <Inner icon={icon} iconAfter={iconAfter}>
        {children}
      </Inner>
    </Link>
  );
});

/** Square icon-only button; `label` is required for accessibility. */
export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { icon: LucideIcon; label: string; variant?: 'ghost' | 'quiet' | 'primary'; size?: ButtonSize }>(
  function IconButton({ icon, label, variant = 'quiet', size = 'md', className, type = 'button', ...rest }, ref) {
    return (
      <button ref={ref} type={type} aria-label={label} title={label} className={['btn', 'btn--icon', `btn--${variant}`, `btn--${size}`, className].filter(Boolean).join(' ')} {...rest}>
        <Icon icon={icon} size={size === 'lg' ? 'md' : 'sm'} />
      </button>
    );
  },
);
