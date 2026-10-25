import { useEffect } from 'react';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { useT } from '../i18n/i18n.ts';
import { hostConfig, storefrontUrl, type HostKind } from '../host.ts';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { Reveal } from '../motion/Reveal.tsx';
import { FlipText } from '../motion/FlipText.tsx';
import { ScrollProgress } from '../motion/ScrollProgress.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { Credit } from '../design/components/Credit.tsx';
import { Logo, LogoMark } from '../design/brand/Logo.tsx';
import { applyTheme } from '../design/theme.ts';
import { hideSplash } from '../app/splash.ts';
import { LanguageSwitcher } from '../storefront/layout/LanguageSwitcher.tsx';
import { BackToTop, FooterFrame, Languages } from '../storefront/layout/Footer.tsx';
import '../design/layout.css';
import './Platform.css';

const EXAMPLES = ['nordic', 'fjord', 'kelo'];
export const MANUFACTURER = import.meta.env.VITE_MANUFACTURER_NAME || 'Saunaklar';
const partnerEmail = () => import.meta.env.VITE_PARTNER_EMAIL || `partners@${hostConfig().platformDomain}`;

function useBareTheme(title: string) {
  useEffect(() => {
    applyTheme(null);
    hideSplash();
    document.title = title;
  }, [title]);
}

function adminUrl() {
  const cfg = hostConfig();
  return `${window.location.protocol}//${cfg.adminHost}${window.location.port ? `:${window.location.port}` : ''}/`;
}

function PlatformFrame({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const m = { manufacturer: MANUFACTURER };
  return (
    <div className="pf">
      <header className="pf__head container">
        <span className="pf__logo">
          <Logo size={28} draw />
        </span>
        <div className="cluster">
          <a href={adminUrl()} className="tlink tlink--plain pf__admin">
            <FlipText text={t('platform.admin')} />
            <Icon icon={ArrowUpRight} size="sm" />
          </a>
          <LanguageSwitcher compact />
        </div>
      </header>
      <main id="main" tabIndex={-1} className="main main--sheet">
        {children}
      </main>
      <FooterFrame
        name={MANUFACTURER}
        bar={
          <>
            <p className="sfoot__legal">{t('platform.footer', { year: String(new Date().getFullYear()), ...m })}</p>
            <Credit tone="on-ink" copyright={false} />
            <BackToTop />
          </>
        }
      >
        <div className="sfoot__top-row container">
          <div className="sfoot__cta">
            <p className="sfoot__cap">{t('platform.joinEyebrow')}</p>
            <p className="sfoot__title">{t('platform.joinTitle', m)}</p>
            <div className="sfoot__actions">
              <a href={`mailto:${partnerEmail()}`} className="btn btn--light btn--lg">
                {t('platform.joinCta')}
                <Icon icon={ArrowRight} size="sm" />
              </a>
            </div>
          </div>
          <div className="sfoot__card">
            <span className="sfoot__card-head">
              <LogoMark size={28} />
              <span className="sfoot__card-name">{MANUFACTURER}</span>
            </span>
            <span className="sfoot__badge">{t('platform.badge')}</span>
            <span className="sfoot__reach">
              <a href={`mailto:${partnerEmail()}`}>{partnerEmail()}</a>
            </span>
          </div>
        </div>
        <nav className="sfoot__cols container" aria-label={t('footer.nav')}>
          <section>
            <h2 className="sfoot__cap">{t('platform.examples')}</h2>
            <ul>
              {EXAMPLES.map(s => (
                <li key={s}>
                  <a className="sfoot__link" href={storefrontUrl(s)}>
                    <FlipText text={`${s}.${hostConfig().platformDomain}`} />
                  </a>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="sfoot__cap">{t('platform.signIn')}</h2>
            <ul>
              <li>
                <a className="sfoot__link" href={adminUrl()}>
                  <FlipText text={t('platform.admin')} />
                </a>
              </li>
              <li className="pf__note">{t('platform.resellerSignIn')}</li>
            </ul>
          </section>
          <section>
            <h2 className="sfoot__cap">{t('footer.language')}</h2>
            <Languages />
          </section>
        </nav>
      </FooterFrame>
      <ScrollProgress />
    </div>
  );
}

function Examples() {
  const { t } = useT();
  return (
    <section className="pf__examples container">
      <p className="eyebrow">{t('platform.examples')}</p>
      <p className="pf__examples-lede">{t('platform.examplesLede')}</p>
      <ul>
        {EXAMPLES.map((s, i) => (
          <li key={s}>
            <a href={storefrontUrl(s)} className="pf__example">
              <span className="mono pf__num">{String(i + 1).padStart(2, '0')}</span>
              <FlipText text={`${s}.${hostConfig().platformDomain}`} />
              <Icon icon={ArrowUpRight} size="md" />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PlatformPage() {
  const { t, m, f } = useT();
  useBareTheme(`${MANUFACTURER} · ${t('platform.eyebrow')}`);
  const domain = hostConfig().platformDomain;
  const vars = { manufacturer: MANUFACTURER, slug: 'your-shop', domain };
  return (
    <PlatformFrame>
      <section className="pf__hero container">
        <LogoMark size={44} draw delay={document.getElementById('splash') ? 1 : 0.2} className="pf__mark" />
        <ScrambleText as="p" className="eyebrow" text={t('platform.eyebrow')} />
        <h1 className="pf__title">
          <span>{t('platform.titleA', vars)}</span> <em>{t('platform.titleB')}</em>
        </h1>
        <p className="lede pf__lede">{t('platform.lede', vars)}</p>
        <div className="pf__ctas">
          <a href={`mailto:${partnerEmail()}`} className="btn btn--primary btn--lg">
            {t('platform.joinCta')}
            <Icon icon={ArrowRight} size="sm" />
          </a>
          <a href={storefrontUrl(EXAMPLES[0]!)} className="btn btn--ghost btn--lg">
            {t('platform.seeExample')}
          </a>
        </div>
      </section>

      <section className="pf__section container" aria-labelledby="pf-benefits">
        <p className="eyebrow">{t('platform.benefitsEyebrow')}</p>
        <h2 id="pf-benefits" className="pf__h2">
          {t('platform.benefitsTitle')}
        </h2>
        <Reveal as="ul" className="pf__benefits">
          {m.platform.benefits.map((b, i) => (
            <li key={b.title} className="pf__benefit">
              <span className="mono pf__num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{b.title}</h3>
              <p>{f(b.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="pf__section container" aria-labelledby="pf-how">
        <p className="eyebrow">{t('platform.howEyebrow')}</p>
        <h2 id="pf-how" className="pf__h2">
          {t('platform.howTitle')}
        </h2>
        <Reveal as="ol" className="pf__steps">
          {m.platform.how.map((s, i) => (
            <li key={s.title}>
              <span className="pf__step-num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <Examples />
    </PlatformFrame>
  );
}

/** Shown on a storefront-shaped host that has no (active) storefront. */
export function UnknownHost({ reason, attempted }: { reason: 'unknown-host' | 'reserved-slug' | 'suspended'; attempted?: string | undefined }) {
  const { t } = useT();
  useBareTheme(t('platform.unknownTitle'));
  const host = attempted ?? window.location.hostname;
  return (
    <PlatformFrame>
      <section className="pf__hero pf__hero--unknown container">
        <ScrambleText as="p" className="eyebrow" text={t('platform.unknownEyebrow')} />
        <ScrambleText as="h1" className="pf__title" text={reason === 'suspended' ? t('platform.suspendedTitle') : t('platform.unknownTitle')} />
        <p className="lede">
          {reason === 'suspended' ? t('platform.suspendedBody') : reason === 'reserved-slug' ? t('platform.reservedBody', { host }) : t('platform.unknownBody', { host })}
        </p>
      </section>
      <Examples />
    </PlatformFrame>
  );
}

export function PlatformRoot({ host }: { host: Extract<HostKind, { kind: 'platform' }> }) {
  if (host.reason === 'root') return <PlatformPage />;
  return <UnknownHost reason={host.reason} attempted={host.attempted} />;
}
