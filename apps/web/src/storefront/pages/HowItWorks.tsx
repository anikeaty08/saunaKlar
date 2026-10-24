import { ArrowRight } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { useTenantData } from '../../api/queries.ts';
import { Reveal } from '../../motion/Reveal.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import './Content.css';

export default function HowItWorks() {
  const { t, m } = useT();
  const name = useTenantData().branding.displayName;
  useDocumentTitle(t('how.eyebrow'));
  return (
    <div className="page container">
      <PageHero eyebrow={t('how.eyebrow')} title={t('how.title')} lede={t('how.lede')} />
      <Reveal as="ol" className="timeline">
        {m.how.steps.map((s, i) => (
          <li key={s.title} className="timeline__step">
            <span className="timeline__num">{String(i + 1).padStart(2, '0')}</span>
            <div>
              <h2 className="timeline__title">{s.title}</h2>
              <p className="timeline__body">{s.body}</p>
            </div>
          </li>
        ))}
      </Reveal>
      <p className="lede" style={{ marginTop: 'var(--space-7)' }}>
        {t('how.after', { name })}
      </p>
      <div className="content-cta">
        <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
          {t('how.cta')}
        </ButtonLink>
      </div>
    </div>
  );
}
