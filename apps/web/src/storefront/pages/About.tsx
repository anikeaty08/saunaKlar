import { useT } from '../../i18n/i18n.ts';
import { useTenantData } from '../../api/queries.ts';
import { Reveal } from '../../motion/Reveal.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import './Content.css';

export default function About() {
  const { t, m, f } = useT();
  const name = useTenantData().branding.displayName;
  useDocumentTitle(t('about.eyebrow'));
  return (
    <div className="page container">
      <PageHero eyebrow={t('about.eyebrow')} title={t('about.title')} lede={t('about.lede', { name })} />
      <Reveal as="dl" className="numbers">
        {m.about.numbers.map(n => (
          <div key={n.label}>
            <dt>{n.label}</dt>
            <dd>{n.value}</dd>
          </div>
        ))}
      </Reveal>
      <Reveal as="ol" className="chapters">
        {m.about.sections.map((s, i) => (
          <li key={s.title} className="chapter">
            <span className="chapter__num mono">{String(i + 1).padStart(2, '0')}</span>
            <h2 className="chapter__title">{s.title}</h2>
            <p className="chapter__body">{f(s.body, { name })}</p>
          </li>
        ))}
      </Reveal>
      <div className="content-cta">
        <ButtonLink to="/saunas" size="lg">
          {t('home.ctaPrimary')}
        </ButtonLink>
      </div>
    </div>
  );
}
