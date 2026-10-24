import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ArrowUp } from 'lucide-react';
import { gsap, ScrollTrigger, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { FlipText } from '../../motion/FlipText.tsx';
import { Credit } from '../../design/components/Credit.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { LogoMark } from '../../design/brand/Logo.tsx';
import { useCatalog, useSession } from '../../api/queries.ts';
import { LOCALES, LOCALE_NAMES, setLocale, useT } from '../../i18n/i18n.ts';
import type { Tenant } from '../../api/types.ts';
import './Footer.css';

export function backToTop() {
  if (prefersReducedMotion()) window.scrollTo(0, 0);
  else gsap.to(window, { scrollTo: 0, duration: 1.2, ease: 'sk.snap' });
  document.getElementById('main')?.focus({ preventScroll: true });
}

/**
 * The page-to-footer moment. The footer sits under the page sheet: where it
 * fits the viewport it is sticky at the bottom, so the sheet (rounded bottom,
 * lifting shadow) slides off it and uncovers it in place. While it is
 * uncovered a paper-coloured veil fades out (paper turns to ink across the
 * edge), the content settles from 94 % and the big name rises out of the
 * bottom edge. Everything animated is opacity or transform on the footer
 * alone, so it stays on the compositor. Taller than the viewport (phones),
 * the footer scrolls normally with a light parallax instead. Reduced motion:
 * no scrub, the footer is simply there.
 */
export function FooterFrame({ children, name, bar }: { children: ReactNode; name: string; bar: ReactNode }) {
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const el = root.current;
      if (!el) return;
      const sheet = document.querySelector<HTMLElement>('.main--sheet');
      const fits = () => el.offsetHeight <= window.innerHeight && window.innerWidth >= 720;
      const apply = () => el.classList.toggle('sfoot--reveal', fits());
      apply();
      if (prefersReducedMotion()) {
        window.addEventListener('resize', apply);
        return () => window.removeEventListener('resize', apply);
      }
      const veil = el.querySelector('.sfoot__veil');
      const inner = el.querySelector('.sfoot__inner');
      const word = el.querySelector('.sfoot__name-in');
      // From the sheet's bottom edge touching the viewport bottom until the footer is fully uncovered.
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sheet ?? el,
          start: sheet ? 'bottom bottom' : 'top bottom',
          end: () => (sheet ? (fits() ? `bottom ${window.innerHeight - el.offsetHeight}px` : 'bottom 25%') : 'top 25%'),
          scrub: 0.4,
          invalidateOnRefresh: true,
        },
      });
      tl.fromTo(veil, { autoAlpha: 1 }, { autoAlpha: 0, ease: 'power1.in', duration: 0.6 }, 0)
        .fromTo(inner, { scale: 0.94, transformOrigin: '50% 100%' }, { scale: 1, ease: 'sk.outSoft', duration: 1 }, 0)
        .fromTo(word, { yPercent: 70 }, { yPercent: 0, ease: 'sk.outSoft', duration: 1 }, 0.1);
      const onResize = () => {
        apply();
        ScrollTrigger.refresh();
      };
      window.addEventListener('resize', onResize);
      // Route changes resize the sheet; keep the start and end in step with it.
      let t = 0;
      const ro = new ResizeObserver(() => {
        clearTimeout(t);
        t = window.setTimeout(onResize, 120);
      });
      if (sheet) ro.observe(sheet);
      return () => {
        window.removeEventListener('resize', onResize);
        ro.disconnect();
        clearTimeout(t);
      };
    },
    { scope: root },
  );

  return (
    <footer ref={root} className="sfoot">
      <div className="sfoot__inner">
        {children}
        <p className="sfoot__name" aria-hidden="true">
          <span className="sfoot__name-in">
            {name}
            <i className="sfoot__dot" />
          </span>
        </p>
        <div className="sfoot__bar container">{bar}</div>
      </div>
      <div className="sfoot__veil" aria-hidden="true" />
    </footer>
  );
}

export function BackToTop() {
  const { t } = useT();
  return (
    <button type="button" className="sfoot__top" onClick={backToTop}>
      <FlipText text={t('common.backToTop')} />
      <Icon icon={ArrowUp} size="sm" />
    </button>
  );
}

function FLink({ to, children }: { to: string; children: string }) {
  return (
    <Link className="sfoot__link" to={to}>
      <FlipText text={children} />
    </Link>
  );
}

export function Languages() {
  const { t, locale } = useT();
  return (
    <ul className="sfoot__langs" aria-label={t('nav.language')}>
      {LOCALES.map(l => (
        <li key={l}>
          <button type="button" lang={l} className="sfoot__lang" aria-pressed={l === locale} onClick={() => void setLocale(l)}>
            {LOCALE_NAMES[l]}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Footer({ tenant }: { tenant: Tenant }) {
  const { t } = useT();
  const b = tenant.branding;
  const catalog = useCatalog().data;
  const session = useSession().data;
  const top = catalog?.items.slice(0, 4) ?? [];
  const legalName = b.legalName ?? b.displayName;
  const signedIn = session?.kind === 'customer';
  const vat = t(`vat.${b.vatDisplay}`);

  return (
    <FooterFrame
      name={b.displayName}
      bar={
        <>
          <p className="sfoot__legal">
            {t('footer.copyright', { year: String(new Date().getFullYear()), name: legalName })} <span aria-hidden="true">·</span> {vat}
          </p>
          <ul className="sfoot__legal-links">
            <li>
              <Link to="/legal/imprint">{t('footer.imprint')}</Link>
            </li>
            <li>
              <Link to="/legal/privacy">{t('footer.privacy')}</Link>
            </li>
            <li>
              <Link to="/legal/terms">{t('footer.terms')}</Link>
            </li>
          </ul>
          <Credit tone="on-ink" copyright={false} />
          <BackToTop />
        </>
      }
    >
      <div className="sfoot__top-row container">
        <div className="sfoot__cta">
          <p className="sfoot__cap">{t('footer.ctaEyebrow', { name: b.displayName })}</p>
          <p className="sfoot__title">{t('footer.ctaTitle')}</p>
          <div className="sfoot__actions">
            <Link to="/saunas" className="btn btn--light btn--lg">
              {t('footer.ctaButton')}
              <Icon icon={ArrowRight} size="sm" />
            </Link>
            <Link to="/contact" className="sfoot__ghost">
              <FlipText text={t('footer.ctaSecondary')} />
            </Link>
          </div>
        </div>

        <address className="sfoot__card">
          <span className="sfoot__card-head">
            {b.logoUrl ? <img src={b.logoUrl} alt="" className="sfoot__logo" /> : <LogoMark size={28} />}
            <span className="sfoot__card-name">{b.displayName}</span>
          </span>
          <span className="sfoot__badge">{t('footer.authorised', { manufacturer: tenant.manufacturer.name })}</span>
          {b.legalAddress && (
            <span className="sfoot__addr">
              {b.legalAddress.split('\n').map(line => (
                <span key={line}>{line}</span>
              ))}
            </span>
          )}
          <span className="sfoot__reach">
            {b.supportPhone && <a href={`tel:${b.supportPhone.replace(/[^+\d]/g, '')}`}>{b.supportPhone}</a>}
            {b.supportEmail && <a href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>}
          </span>
        </address>
      </div>

      <nav className="sfoot__cols container" aria-label={t('footer.nav')}>
        <section>
          <h2 className="sfoot__cap">{t('footer.shop')}</h2>
          <ul>
            {top.map(s => (
              <li key={s.id}>
                <FLink to={`/saunas/${s.slug}`}>{s.name}</FLink>
              </li>
            ))}
            <li>
              <FLink to="/saunas">{t('footer.allSaunas')}</FLink>
            </li>
          </ul>
        </section>
        <section>
          <h2 className="sfoot__cap">{t('footer.help')}</h2>
          <ul>
            <li>
              <FLink to="/how-it-works">{t('nav.howItWorks')}</FLink>
            </li>
            <li>
              <FLink to="/guide">{t('nav.guide')}</FLink>
            </li>
            <li>
              <FLink to="/faq">{t('nav.faq')}</FLink>
            </li>
            <li>
              <FLink to="/about">{t('nav.about')}</FLink>
            </li>
            <li>
              <FLink to="/contact">{t('nav.contact')}</FLink>
            </li>
          </ul>
        </section>
        <section>
          <h2 className="sfoot__cap">{t('footer.account')}</h2>
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
              </>
            )}
          </ul>
        </section>
        <section>
          <h2 className="sfoot__cap">{t('footer.language')}</h2>
          <Languages />
        </section>
      </nav>
    </FooterFrame>
  );
}
