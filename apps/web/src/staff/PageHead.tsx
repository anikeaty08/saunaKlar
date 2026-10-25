import type { ReactNode } from 'react';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { Breadcrumbs } from '../design/components/Breadcrumbs.tsx';

/** Title row of an admin page: optional crumbs, scrambled h1, lede and actions. */
export function PageHead({ title, lede, actions, crumbs, meta }: { title: string; lede?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[]; meta?: ReactNode }) {
  return (
    <header className="staff-head">
      {crumbs && <Breadcrumbs items={crumbs} />}
      <div className="staff-head__row">
        <div className="staff-head__text">
          <ScrambleText as="h1" className="staff-head__title" text={title} />
          {lede && <p className="staff-head__lede">{lede}</p>}
          {meta && <div className="staff-head__meta">{meta}</div>}
        </div>
        {actions && <div className="staff-head__actions">{actions}</div>}
      </div>
    </header>
  );
}

/** A titled block inside an admin page. */
export function Panel({ title, lede, action, children, className }: { title?: ReactNode; lede?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={['staff-panel', className].filter(Boolean).join(' ')}>
      {(title || action) && (
        <div className="staff-panel__head">
          <div>
            {title && <h2 className="staff-panel__title">{title}</h2>}
            {lede && <p className="staff-panel__lede">{lede}</p>}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
