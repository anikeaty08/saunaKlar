import type { ReactNode } from 'react';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import './SectionHeading.css';

interface Props {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  action?: ReactNode;
  /** Running number, e.g. "01", shown in the margin. */
  index?: string;
  as?: 'h1' | 'h2';
  size?: 'md' | 'lg' | 'xl';
}

/** Section title block: index, eyebrow, a scrambled heading and an optional lede and action. */
export function SectionHeading({ eyebrow, title, lede, action, index, as = 'h2', size = 'lg' }: Props) {
  return (
    <header className={`sh sh--${size}`}>
      <div className="sh__meta">
        {index && <span className="sh__index mono">{index}</span>}
        {eyebrow && <ScrambleText as="p" className="eyebrow" text={eyebrow} trigger="inview" />}
      </div>
      <div className="sh__main">
        <ScrambleText as={as} className="sh__title" text={title} trigger="inview" />
        {lede && <div className="sh__lede">{lede}</div>}
      </div>
      {action && <div className="sh__action">{action}</div>}
    </header>
  );
}
