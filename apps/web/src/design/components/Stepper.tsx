import { useT } from '../../i18n/i18n.ts';
import './Stepper.css';

/** Linear progress through named steps (`aria-current="step"` on the active one). */
export function Stepper({ steps, current, onSelect }: { steps: string[]; current: number; onSelect?: (index: number) => void }) {
  const { t } = useT();
  return (
    <nav aria-label={t('common.steps')} className="stepper">
      <ol>
        {steps.map((s, i) => {
          const state = i < current ? 'done' : i === current ? 'current' : 'todo';
          const content = (
            <>
              <span className="stepper__num mono">{String(i + 1).padStart(2, '0')}</span>
              <span className="stepper__label">{s}</span>
            </>
          );
          return (
            <li key={s} className={`stepper__step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
              {onSelect && state === 'done' ? (
                <button type="button" onClick={() => onSelect(i)} className="stepper__btn">
                  {content}
                </button>
              ) : (
                <span className="stepper__btn">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="sr-only">{t('common.stepOf', { current: current + 1, total: steps.length })}</p>
    </nav>
  );
}
