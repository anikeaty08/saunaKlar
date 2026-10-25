import type { HTMLAttributes, ReactNode } from 'react';
import './Card.css';

interface Props extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'article' | 'section' | 'li';
  /** `outline` hairline box, `filled` paper-2 surface, `plain` no chrome. */
  tone?: 'outline' | 'filled' | 'plain';
  interactive?: boolean;
  children: ReactNode;
}

export function Card({ as: Tag = 'div', tone = 'outline', interactive, className, children, ...rest }: Props) {
  return (
    <Tag className={['card', `card--${tone}`, interactive && 'card--interactive', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </Tag>
  );
}

export function CardHeader({ title, eyebrow, action }: { title: ReactNode; eyebrow?: ReactNode; action?: ReactNode }) {
  return (
    <header className="card__header">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h3 className="card__title">{title}</h3>
      </div>
      {action}
    </header>
  );
}
