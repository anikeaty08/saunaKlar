import { ArrowRight } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { useSession, useTenantData } from '../../api/queries.ts';
import { Reveal } from '../../motion/Reveal.tsx';
import { ExternalLink } from '../../design/components/TextLink.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import './Content.css';

export default function Contact() {
  const { t } = useT();
  const tenant = useTenantData();
  const session = useSession().data;
  const b = tenant.branding;
  useDocumentTitle(t('contact.eyebrow'));
  return (
    <div className="page container">
      <PageHero eyebrow={t('contact.eyebrow')} title={t('contact.title', { name: b.displayName })} lede={t('contact.lede')} />
      <Reveal as="dl" className="contact-grid">
        {b.supportEmail && (
          <div>
            <dt>{t('contact.email')}</dt>
            <dd>
              <ExternalLink href={`mailto:${b.supportEmail}`}>{b.supportEmail}</ExternalLink>
            </dd>
          </div>
        )}
        {b.supportPhone && (
          <div>
            <dt>{t('contact.phone')}</dt>
            <dd>
              <ExternalLink href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</ExternalLink>
            </dd>
          </div>
        )}
        {b.legalAddress && (
          <div>
            <dt>{t('contact.address')}</dt>
            <dd>
              <address>
                {(b.legalName ?? b.displayName)}
                {b.legalAddress.split('\n').map(l => (
                  <span key={l}>{l}</span>
                ))}
              </address>
            </dd>
          </div>
        )}
        <div>
          <dt>{t('contact.hours')}</dt>
          <dd>{t('contact.hoursValue')}</dd>
        </div>
      </Reveal>
      <div className="contact-blocks">
        <section className="contact-block contact-block--ink">
          <h2>{t('contact.requestTitle')}</h2>
          <p>{t('contact.requestBody')}</p>
          <ButtonLink to="/saunas" variant="ghost" iconAfter={ArrowRight} className="on-ink">
            {t('contact.requestCta')}
          </ButtonLink>
        </section>
        <section className="contact-block">
          <h2>{t('contact.statusTitle')}</h2>
          <p>{t('contact.statusBody')}</p>
          <ButtonLink to={session?.kind === 'customer' ? '/account/requests' : '/account/login?next=/account/requests'} variant="ghost" iconAfter={ArrowRight}>
            {t('contact.statusCta')}
          </ButtonLink>
        </section>
      </div>
    </div>
  );
}
