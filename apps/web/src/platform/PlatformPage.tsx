import { useEffect } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useT } from '../i18n/i18n.ts';
import { hostConfig, storefrontUrl, type HostKind } from '../host.ts';
import { ScrambleText } from '../motion/ScrambleText.tsx';
import { Reveal } from '../motion/Reveal.tsx';
import { Marquee } from '../motion/Marquee.tsx';
import { FlipText } from '../motion/FlipText.tsx';
import { Icon } from '../design/components/Icon.tsx';
import { applyTheme } from '../design/theme.ts';
import { hideSplash } from '../app/splash.ts';
import { LanguageSwitcher } from '../storefront/layout/LanguageSwitcher.tsx';
import { BackToTop, FooterFrame } from '../storefront/layout/Footer.tsx';
import { FlipChars } from '../motion/FlipChars.tsx';
import { Logo } from '../design/brand/Logo.tsx';
import { Credit } from '../design/components/Credit.tsx';
import './Platform.css';

const EXAMPLES = ['nordic', 'fjord', 'kelo'];

function useBareTheme(title: string) {
  useEffect(() => {
    applyTheme(null);
    hideSplash();
    document.title = title;
  }, [title]);
}

function PlatformFrame({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  const cfg = hostConfig();
  const adminUrl = `${window.location.protocol}//${cfg.adminHost}${window.location.port ? `:${window.location.port}` : ''}/`;
  return (
    <div className="pf">
      <header className="pf__head container">
        <span className="pf__logo">
          <Logo size={28} draw />
        </span>
        <div className="cluster">
          <a href={adminUrl} className="tlink tlink--plain pf__admin">
            <FlipText text={t('platform.admin')} />
            <Icon icon={ArrowUpRight} size="sm" />
          </a>
          <LanguageSwitcher compact />
        </div>
      </header>
      <main id="main" className="main main--sheet">
        {children}
      </main>
      <FooterFrame
        wordmark="Saunaklar"
        label={t('footer.wordmark', { name: 'Saunaklar' })}
        cta={
          <>
            <p className="sfoot__cap">{t('platform.ctaEyebrow')}</p>
            <FlipChars as="p" text={t('platform.ctaTitle')} onScroll className="sfoot__title" />
            <a href={adminUrl} className="btn btn--light btn--lg">
              {t('platform.ctaButton')}
            </a>
          </>
        }
        bar={
          <>
            <p className="sfoot__legal">{t('platform.footer', { year: String(new Date().getFullYear()) })}</p>
            <Credit tone="on-ink" copyright={false} />
            <BackToTop />
          </>
        }
      >
        <section className="sfoot__col sfoot__about">
          <h2 className="sfoot__cap">{t('platform.about')}</h2>
          <p className="sfoot__text">{t('platform.lede')}</p>
        </section>
        <section className="sfoot__col sfoot__c2">
          <h2 className="sfoot__cap">{t('platform.examples')}</h2>
          <ul>
            {EXAMPLES.map(s => (
              <li key={s}>
                <a className="sfoot__link" href={storefrontUrl(s)}>
                  <FlipText text={s} />
                </a>
              </li>
            ))}
          </ul>
        </section>
        <section className="sfoot__col sfoot__c2">
          <h2 className="sfoot__cap">{t('platform.staff')}</h2>
          <ul>
            <li>
              <a className="sfoot__link" href={adminUrl}>
                <FlipText text={t('platform.admin')} />
              </a>
            </li>
          </ul>
        </section>
      </FooterFrame>
    </div>
  );
}

function Examples() {
  const { t } = useT();
  return (
    <section className="pf__examples container">
      <p className="eyebrow">{t('platform.examples')}</p>
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
  useBareTheme('Saunaklar');
  const domain = hostConfig().platformDomain;
  return (
    <PlatformFrame>
      <section className="pf__hero container">
        <ScrambleText as="p" className="eyebrow" text={t('platform.eyebrow')} />
        <ScrambleText as="h1" className="pf__title" text={t('platform.title')} />
        <p className="lede">{t('platform.lede')}</p>
      </section>
      <Marquee className="pf__marquee" speed={40}>
        {['{slug}', domain, '—', 'alpha-spa', 'nordic', 'fjord', 'kelo', '—'].map((w, i) => (
          <span key={i} className="pf__marquee-word">
            {w === '{slug}' ? '*' : w}
          </span>
        ))}
      </Marquee>
      <Reveal as="ol" className="pf__features container">
        {m.platform.features.map((feat, i) => (
          <li key={feat.title}>
            <span className="mono pf__num">{String(i + 1).padStart(2, '0')}</span>
            <h2>{feat.title}</h2>
            <p>{f(feat.body, { slug: '{slug}', domain })}</p>
          </li>
        ))}
      </Reveal>
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
