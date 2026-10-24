import type { ReactNode } from 'react';
import { ScrambleText } from '../../motion/ScrambleText.tsx';

export function PageHero({ eyebrow, title, lede, children, size }: { eyebrow: string; title: string; lede?: ReactNode; children?: ReactNode; size?: 'md' | 'lg' }) {
  return (
    <header className="page-hero">
      <ScrambleText as="p" className="eyebrow" text={eyebrow} />
      <ScrambleText as="h1" className={['page-title', size === 'md' && 'page-title--md'].filter(Boolean).join(' ')} text={title} />
      {lede && <p className="lede">{lede}</p>}
      {children}
    </header>
  );
}
