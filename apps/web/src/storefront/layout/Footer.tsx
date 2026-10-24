import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronUp } from 'lucide-react';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { FlipText } from '../../motion/FlipText.tsx';
import { FlipChars } from '../../motion/FlipChars.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { Credit } from '../../design/components/Credit.tsx';
import { DotWordPlay } from '../../design/brand/DotWordmark.tsx';
import { useCatalog, useSession } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import type { Tenant } from '../../api/types.ts';
import { LanguageSwitcher } from './LanguageSwitcher.tsx';
import './Footer.css';

export function backToTop() {
  if (prefersReducedMotion()) window.scrollTo(0, 0);
  else gsap.to(window, { scrollTo: 0, duration: 1.2, ease: 'sk.snap' });
  document.getElementById('main')?.focus({ preventScroll: true });
}

function Col({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={['sfoot__col', className].filter(Boolean).join(' ')}>
      <h2 className="sfoot__cap">{title}</h2>
      {children}
    </section>
  );
}

function FLink({ to, href, children }: { to?: string; href?: string; children: string }) {
  // Addresses stay plain text so they can wrap on narrow screens.
  if (href)
    return (
      <a className="sfoot__link" href={href}>
        {children}
      </a>
    );
  return (
    <Link className="sfoot__link" to={to!}>
      <FlipText text={children} />
    </Link>
  );
}

/**
 * Dark footer that sits "under" the page: the main sheet lifts off it and its
 * content slides up into place while it scrolls in (scrubbed, no motion when
 * reduced motion is on).
 */
export function FooterFrame({ cta, children, bar, wordmark, label }: { cta: ReactNode; children: ReactNode; bar: ReactNode; wordmark: string; label: string }) {
  const root = useRef<HTMLElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion() || !inner.current) return;
      gsap.from(inner.current, {
        yPercent: -22,
        opacity: 0.3,
        ease: 'none',
        scrollTrigger: { trigger: root.current, start: 'top bottom', end: 'top 15%', scrub: true },
      });
    },
    { scope: root },
  );

  return (
    <footer ref={root} className="sfoot">
      <div ref={inner} className="sfoot__inner">
        <div className="sfoot__cta container">{cta}</div>
        <div className="sfoot__grid container">{children}</div>
        <div className="sfoot__word container">
          <DotWordPlay text={wordmark} label={label} />
        </div>
        <div className="sfoot__bar container">{bar}</div>
      </div>
    </footer>
  );
}

export function BackToTop() {
  const { t } = useT();
  return (
    <button type="button" className="sfoot__top" onClick={backToTop}>
      <FlipText text={t('common.backToTop')} />
      <ChevronUp aria-hidden="true" className="sfoot__chev" size={14} strokeWidth={1.75} />
    </button>
  );
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
    <FooterFrame
      wordmark={b.displayName}
      label={t('footer.wordmark', { name: b.displayName })}
      cta={
        <>
          <p className="sfoot__cap">{t('footer.ctaEyebrow')}</p>
          <FlipChars as="p" text={t('footer.ctaTitle')} onScroll className="sfoot__title" />
          <ButtonLink to="/saunas" variant="light" size="lg">
            {t('footer.ctaButton')}
          </ButtonLink>
        </>
      }
      bar={
        <>
          <p className="sfoot__legal">
            {t('footer.copyright', { year: String(year), name: legalName })}
            <span aria-hidden="true"> • </span>
            {t(`vat.${b.vatDisplay}`)}
          </p>
          <Credit tone="on-ink" copyright={false} />
          <div className="sfoot__lang">
            <LanguageSwitcher align="end" />
          </div>
          <BackToTop />
        </>
      }
    >
      <Col title={t('footer.about', { name: b.displayName })} className="sfoot__about">
        <p className="sfoot__text">{b.tagline ?? t('footer.statement')}</p>
        {b.legalAddress && (
          <address className="sfoot__address">
            <span>{legalName}</span>
            {b.legalAddress.split('\n').map(line => (
              <span key={line}>{line}</span>
            ))}
          </address>
        )}
        <ul className="sfoot__inline">
          <li>
            <FLink to="/legal/imprint">{t('footer.imprint')}</FLink>
          </li>
          <li>
            <FLink to="/legal/privacy">{t('footer.privacy')}</FLink>
          </li>
          <li>
            <FLink to="/legal/terms">{t('footer.terms')}</FLink>
          </li>
        </ul>
      </Col>

      <Col title={t('footer.shop')} className="sfoot__c2">
        <ul>
          {top.map(s => (
            <li key={s.id}>
              <FLink to={`/saunas/${s.slug}`}>{s.name}</FLink>
            </li>
          ))}
          <li>
            <FLink to="/saunas">{t('footer.allSaunas')}</FLink>
          </li>
          <li>
            <FLink to="/showroom">{t('nav.showroom')}</FLink>
          </li>
        </ul>
      </Col>

      <Col title={t('footer.company')} className="sfoot__c2">
        <ul>
          <li>
            <FLink to="/how-it-works">{t('nav.howItWorks')}</FLink>
          </li>
          <li>
            <FLink to="/guide">{t('nav.guide')}</FLink>
          </li>
          <li>
            <FLink to="/about">{t('nav.about')}</FLink>
          </li>
          <li>
            <FLink to="/faq">{t('nav.faq')}</FLink>
          </li>
        </ul>
      </Col>

      <Col title={t('footer.account')} className="sfoot__c2">
        <ul>
          {signedIn ? (
            <>
              <li>
                <FLink to="/account">{t('nav.account')}</FLink>
              </li>
              <li>
                <FLink to="/account/configurations">{t('nav.configurations')}</FLink>
              </li>
              <li>
                <FLink to="/account/requests">{t('nav.requests')}</FLink>
              </li>
            </>
          ) : (
            <>
              <li>
                <FLink to="/account/login">{t('nav.login')}</FLink>
              </li>
              <li>
                <FLink to="/account/signup">{t('nav.signup')}</FLink>
              </li>
              <li>
                <FLink to="/account/login?next=/account/requests">{t('footer.requestStatus')}</FLink>
              </li>
            </>
          )}
        </ul>
      </Col>

      <Col title={t('footer.contact')} className="sfoot__c2">
        <ul>
          <li>
            <FLink to="/contact">{t('nav.contact')}</FLink>
          </li>
          {b.supportEmail && (
            <li>
              <FLink href={`mailto:${b.supportEmail}`}>{b.supportEmail}</FLink>
            </li>
          )}
          {b.supportPhone && (
            <li>
              <FLink href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</FLink>
            </li>
          )}
        </ul>
      </Col>
    </FooterFrame>
  );
}
