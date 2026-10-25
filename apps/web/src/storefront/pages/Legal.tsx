import { Navigate, useParams } from 'react-router';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { useTenantData } from '../../api/queries.ts';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import './Content.css';

const UPDATED = '2026-10-01';

export default function Legal() {
  const { doc } = useParams();
  const { t, m, f } = useT();
  const fmt = useFormat();
  const b = useTenantData().branding;
  const legalName = b.legalName ?? b.displayName;
  const params = { legalName, name: b.displayName, email: b.supportEmail ?? '' };
  const title = doc === 'privacy' ? t('legal.privacyTitle') : doc === 'terms' ? t('legal.termsTitle') : t('legal.imprintTitle');
  useDocumentTitle(title);
  if (doc !== 'privacy' && doc !== 'terms' && doc !== 'imprint') return <Navigate to="/legal/imprint" replace />;

  const sections = doc === 'privacy' ? m.legal.privacy : doc === 'terms' ? m.legal.terms : null;
  return (
    <div className="page container legal">
      <PageHero eyebrow={t('legal.eyebrow')} title={title} size="md">
        <p className="mono muted" style={{ fontSize: 'var(--step--2)' }}>
          {t('legal.updated', { date: fmt.date(UPDATED, 'long') })}
        </p>
      </PageHero>
      <div className="legal__body">
        <aside className="legal__controller">
          <p className="eyebrow">{t('legal.controller')}</p>
          <address>
            <strong>{legalName}</strong>
            {b.legalAddress?.split('\n').map(l => <span key={l}>{l}</span>)}
            {b.supportEmail && <span>{t('legal.contactLine', { email: b.supportEmail })}</span>}
            {b.supportPhone && <span>{b.supportPhone}</span>}
          </address>
        </aside>
        <div className="prose">
          {sections ? (
            sections.map((s, i) => (
              <section key={s.title}>
                <h2>
                  <span className="mono muted" style={{ fontSize: '0.6em', marginRight: '0.8em' }}>
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {s.title}
                </h2>
                <p>{f(s.body, params)}</p>
              </section>
            ))
          ) : (
            <>
              <p>{t('legal.imprintBody')}</p>
              <h2>{legalName}</h2>
              <p>
                {b.legalAddress?.split('\n').map(l => (
                  <span key={l} style={{ display: 'block' }}>
                    {l}
                  </span>
                ))}
              </p>
              {b.supportEmail && <p>{t('legal.contactLine', { email: b.supportEmail })}</p>}
              {b.supportPhone && <p>{b.supportPhone}</p>}
              <p>{t('legal.represented', { legalName })}</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
