import { ArrowUp } from 'lucide-react';
import { gsap } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { Marquee } from '../../motion/Marquee.tsx';
import { Reveal } from '../../motion/Reveal.tsx';
import { FlipText } from '../../motion/FlipText.tsx';
import { ExternalLink, TextLink } from '../../design/components/TextLink.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { useCatalog, useSession } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import type { Tenant } from '../../api/types.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import './Footer.css';

function backToTop() {
  if (prefersReducedMotion()) window.scrollTo(0, 0);
  else gsap.to(window, { scrollTo: 0, duration: 1.2, ease: 'sk.inOut' });
  document.getElementById('main')?.focus({ preventScroll: true });
}

export function Footer({ tenant }: { tenant: Tenant }) {
  const { t } = useT();
  const b = tenant.branding;
  const catalog = useCatalog().data;
  const session = useSession().data;
  const top = catalog?.items.slice(0, 4) ?? [];
  const year = new Date().getFullYear();
  const legalName = b.legalName ?? b.displayName;
  const signedIn = session?.kind === 'customer';

  return (
    <footer className="footer">
      <div className="footer__cta container">
        <p className="footer__statement">{b.tagline ?? t('footer.statement')}</p>
        <button type="button" className="footer__top" onClick={backToTop}>
          <FlipText text={t('common.backToTop')} />
          <span className="footer__top-icon">
            <Icon icon={ArrowUp} size="sm" />
          </span>
        </button>
      </div>

      <Marquee className="footer__marquee" speed={50}>
        <span className="footer__word">{b.displayName}</span>
        <span className="footer__sep" aria-hidden="true">
          ✳
        </span>
      </Marquee>

      <Reveal className="footer__grid container" stagger={0.06}>
        <section className="footer__col">
          <h2 className="footer__h">{t('footer.saunas')}</h2>
          <ul>
            {top.map(s => (
              <li key={s.id}>
                <TextLink to={`/saunas/${s.slug}`}>{s.name}</TextLink>
              </li>
            ))}
            <li>
              <TextLink to="/saunas" tone="underline">
                {t('footer.allSaunas')}
              </TextLink>
            </li>
          </ul>
        </section>

        <section className="footer__col">
          <h2 className="footer__h">{t('footer.service')}</h2>
          <ul>
            <li>
              <TextLink to="/contact">{t('nav.contact')}</TextLink>
            </li>
            <li>
              <TextLink to="/faq">{t('nav.faq')}</TextLink>
            </li>
            <li>
              <TextLink to={signedIn ? '/account/requests' : '/account/login?next=/account/requests'}>{t('footer.requestStatus')}</TextLink>
            </li>
            {b.supportEmail && (
              <li>
                <ExternalLink href={`mailto:${b.supportEmail}`}>{b.supportEmail}</ExternalLink>
              </li>
            )}
            {b.supportPhone && (
              <li>
                <ExternalLink href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</ExternalLink>
              </li>
            )}
          </ul>
        </section>

        <section className="footer__col">
          <h2 className="footer__h">{t('footer.company')}</h2>
          <ul>
            <li>
              <TextLink to="/about">{t('nav.about')}</TextLink>
            </li>
            <li>
              <TextLink to="/how-it-works">{t('nav.howItWorks')}</TextLink>
            </li>
            <li>
              <TextLink to="/guide">{t('nav.guide')}</TextLink>
            </li>
            <li>
              <TextLink to="/showroom">{t('nav.showroom')}</TextLink>
            </li>
          </ul>
        </section>

        <section className="footer__col">
          <h2 className="footer__h">{t('footer.account')}</h2>
          <ul>
            {signedIn ? (
              <>
                <li>
                  <TextLink to="/account">{t('nav.account')}</TextLink>
                </li>
                <li>
                  <TextLink to="/account/configurations">{t('nav.configurations')}</TextLink>
                </li>
                <li>
                  <TextLink to="/account/requests">{t('nav.requests')}</TextLink>
                </li>
                <li>
                  <TextLink to="/account/profile">{t('nav.profile')}</TextLink>
                </li>
              </>
            ) : (
              <>
                <li>
                  <TextLink to="/account/login">{t('nav.login')}</TextLink>
                </li>
                <li>
                  <TextLink to="/account/signup">{t('nav.signup')}</TextLink>
                </li>
              </>
            )}
          </ul>
        </section>

        <section className="footer__col">
          <h2 className="footer__h">{t('footer.legal')}</h2>
          <ul>
            <li>
              <TextLink to="/legal/imprint">{t('footer.imprint')}</TextLink>
            </li>
            <li>
              <TextLink to="/legal/privacy">{t('footer.privacy')}</TextLink>
            </li>
            <li>
              <TextLink to="/legal/terms">{t('footer.terms')}</TextLink>
            </li>
          </ul>
          {b.legalAddress && (
            <address className="footer__address">
              <strong>{legalName}</strong>
              {b.legalAddress.split('\n').map(line => (
                <span key={line}>{line}</span>
              ))}
            </address>
          )}
        </section>
      </Reveal>

      <div className="footer__bar container">
        <p>{t('footer.copyright', { year: String(year), name: legalName })}</p>
        <p>{t(`vat.${b.vatDisplay}`)}</p>
        <p className="footer__powered">{t('footer.poweredBy')}</p>
        <div className="footer__lang">
          <LanguageSwitcher align="end" />
        </div>
      </div>
    </footer>
  );
}
