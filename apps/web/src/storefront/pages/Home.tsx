import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useCatalog, useTenantData } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { Reveal } from '../../motion/Reveal.tsx';
import { Magnetic } from '../../motion/Magnetic.tsx';
import { NumberTicker } from '../../motion/NumberTicker.tsx';
import { ButtonLink } from '../../design/components/Button.tsx';
import { SectionHeading } from '../../design/components/SectionHeading.tsx';
import { TextLink } from '../../design/components/TextLink.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { SaunaCard, SaunaCardSkeleton, SaunaGrid } from '../components/SaunaCard.tsx';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import { DrawOn } from '../components/DrawOn.tsx';
import { LogoMark } from '../../design/brand/Logo.tsx';
import { specsOf } from '../components/specs.ts';
import './Home.css';

export default function Home() {
  const { t, m, f } = useT();
  const tenant = useTenantData();
  const catalog = useCatalog();
  const name = tenant.branding.displayName;
  useDocumentTitle(null);
  const hero = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      gsap.from('.home-hero__line-inner', { yPercent: 110, duration: 1.3, stagger: 0.12, ease: 'sk.snap', delay: 0.45 });
      gsap.from('.home-hero__after', { autoAlpha: 0, y: 18, duration: 1, stagger: 0.08, ease: 'sk.outSoft', delay: 0.9 });
      gsap.from('.home-hero__glow', { autoAlpha: 0, scale: 0.85, duration: 2.2, ease: 'sk.outSoft' });
      gsap.to('.home-hero__scroll-dot', { yPercent: 260, repeat: -1, duration: 1.6, ease: 'sk.snap' });
    },
    { scope: hero },
  );

  const items = catalog.data?.items ?? [];
  const featured = items.slice(0, 3);
  const heroModel = items.find(i => specsOf(i).form === 'panorama') ?? items[0];
  const hs = heroModel ? specsOf(heroModel) : null;
  const maxSeats = items.reduce((mx, i) => Math.max(mx, specsOf(i).persons), 0) || 8;

  return (
    <div className="home">
      <section ref={hero} className="home-hero">
        <div className="home-hero__scene" aria-hidden="true">
          <div className="home-hero__glow" />
          {hs && (
            <DrawOn delay={0.9} className="home-hero__art">
              <SaunaGlyph form={hs.form} widthMm={hs.widthMm} depthMm={hs.depthMm} heightMm={hs.heightMm} strokeWidth={0.6} />
            </DrawOn>
          )}
          <div className="home-hero__floor" />
        </div>

        <div className="home-hero__center container">
          <LogoMark className="home-hero__mark" size={44} draw delay={0.2} />
          <ScrambleText as="p" className="eyebrow home-hero__after" text={`${t('home.eyebrow')} — ${name}`} />
          <h1 className="home-hero__title">
            <span className="sr-only">{`${t('home.heroTitleA')} ${t('home.heroTitleB')} ${t('home.heroTitleC')}`}</span>
            {[t('home.heroTitleA'), t('home.heroTitleB'), t('home.heroTitleC')].map((line, i) => (
              <span key={i} className={`home-hero__line home-hero__line--${i}`} aria-hidden="true">
                <span className="home-hero__line-inner">{line}</span>
              </span>
            ))}
          </h1>
          <p className="lede home-hero__lede home-hero__after">{t('home.heroLede', { name })}</p>
          <div className="home-hero__ctas home-hero__after">
            <Magnetic>
              <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
                {t('home.ctaPrimary')}
              </ButtonLink>
            </Magnetic>
            <ButtonLink to="/how-it-works" size="lg" variant="ghost">
              {t('home.ctaSecondary')}
            </ButtonLink>
          </div>
        </div>

        <div className="home-hero__base container home-hero__after">
          <p className="eyebrow">N° {String(tenant.catalogVersion).padStart(3, '0')}</p>
          <span className="home-hero__scroll" aria-hidden="true">
            <span className="home-hero__scroll-line">
              <span className="home-hero__scroll-dot" />
            </span>
            <span className="mono">{t('home.scroll')}</span>
          </span>
          <dl className="home-hero__stats">
            <div>
              <dt>{t('home.stats.models')}</dt>
              <dd>
                <NumberTicker value={items.length || 6} format={n => String(Math.round(n)).padStart(2, '0')} />
              </dd>
            </div>
            <div>
              <dt>{t('home.stats.seats')}</dt>
              <dd>
                <NumberTicker value={maxSeats} format={n => String(Math.round(n)).padStart(2, '0')} />
              </dd>
            </div>
            <div>
              <dt>{t('home.stats.days')}</dt>
              <dd>
                <NumberTicker value={30} format={n => String(Math.round(n)).padStart(2, '0')} />
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="section container" aria-labelledby="featured">
        <SectionHeading
          index="01"
          eyebrow={t('home.featuredEyebrow')}
          title={t('home.featuredTitle')}
          lede={t('home.featuredLede')}
          action={
            <TextLink to="/saunas" tone="underline">
              {t('home.viewAll')}
            </TextLink>
          }
        />
        <Reveal as={SaunaGrid} id="featured">
          {catalog.isPending
            ? [0, 1, 2].map(i => <SaunaCardSkeleton key={i} />)
            : featured.map((it, i) => <SaunaCard key={it.id} item={it} index={i} currency={catalog.data!.currency} size="lg" />)}
        </Reveal>
      </section>

      <section className="section container">
        <SectionHeading index="02" eyebrow={t('home.howEyebrow')} title={t('home.howTitle')} />
        <Reveal as="ol" className="home-steps">
          {m.home.steps.map((s, i) => (
            <li key={s.title} className="home-step">
              <span className="home-step__num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="home-step__title">{s.title}</h3>
              <p className="home-step__body">{s.body}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="section container">
        <SectionHeading index="03" eyebrow={t('home.trustEyebrow')} title={t('home.trustTitle')} />
        <Reveal as="ul" className="home-trust">
          {m.home.trust.map(s => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{f(s.body, { name })}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="section container">
        <div className="home-cta">
          <ScrambleText as="h2" className="home-cta__title" text={t('home.ctaTitle')} trigger="inview" />
          <div className="home-cta__side">
            <p>{t('home.ctaBody')}</p>
            <Magnetic>
              <ButtonLink to="/saunas" variant="ghost" size="lg" iconAfter={ArrowRight}>
                {t('home.ctaButton')}
              </ButtonLink>
            </Magnetic>
          </div>
        </div>
      </section>
    </div>
  );
}
