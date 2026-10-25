import { forwardRef, type ReactNode } from 'react';
import { Link, NavLink, type LinkProps, type NavLinkProps } from 'react-router';
import { FlipText } from '../../motion/FlipText.tsx';
import { prefetchPath } from '../../app/prefetch.ts';
import './TextLink.css';

type Props = Omit<LinkProps, 'children'> & {
  children: ReactNode;
  /** `underline` draws a hairline that wipes on hover; `plain` relies on the flip only. */
  tone?: 'plain' | 'underline';
  /** Load the route chunk and its data on hover/focus (default on). */
  warm?: boolean;
};

function hrefOf(to: LinkProps['to']): string {
  return typeof to === 'string' ? to : `${to.pathname ?? ''}${to.search ?? ''}`;
}

/** Router link whose letters flip vertically on hover. */
export const TextLink = forwardRef<HTMLAnchorElement, Props>(function TextLink({ children, tone = 'plain', warm: warmOn = true, className, onPointerEnter, onFocus, to, ...rest }, ref) {
  const warm = () => warmOn && prefetchPath(hrefOf(to));
  return (
    <Link
      ref={ref}
      to={to}
      className={['tlink', `tlink--${tone}`, className].filter(Boolean).join(' ')}
      onPointerEnter={e => {
        warm();
        onPointerEnter?.(e);
      }}
      onFocus={e => {
        warm();
        onFocus?.(e);
      }}
      {...rest}
    >
      {typeof children === 'string' ? <FlipText text={children} /> : children}
    </Link>
  );
});

/** NavLink variant: `aria-current="page"` and an underline when active. */
export function TextNavLink({ children, className, to, end, ...rest }: Omit<NavLinkProps, 'children' | 'className'> & { children: string; className?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => ['tlink', 'tlink--nav', isActive && 'is-active', className].filter(Boolean).join(' ')}
      onPointerEnter={() => prefetchPath(hrefOf(to))}
      onFocus={() => prefetchPath(hrefOf(to))}
      {...rest}
    >
      <FlipText text={children} />
    </NavLink>
  );
}

/** External or mailto/tel link with the same flip. */
export function ExternalLink({ href, children, className, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { children: string }) {
  return (
    <a href={href} className={['tlink', 'tlink--plain', className].filter(Boolean).join(' ')} {...rest}>
      <FlipText text={children} />
    </a>
  );
}
