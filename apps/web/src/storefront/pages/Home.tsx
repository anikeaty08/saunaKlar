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
      gsap.from('.home-hero__line-inner', { yPercent: 110, duration: 1.2, stagger: 0.1, ease: 'sk.out', delay: 0.15 });
      gsap.from('.home-hero__after', { autoAlpha: 0, y: 20, duration: 1, stagger: 0.08, delay: 0.7 });
      gsap.to('.home-hero__scroll-dot', { y: 18, repeat: -1, yoyo: true, duration: 1.1, ease: 'sine.inOut' });
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
      <section ref={hero} className="home-hero container">
        <div className="home-hero__top home-hero__after">
          <ScrambleText as="p" className="eyebrow" text={`${t('home.eyebrow')} — ${name}`} />
          <p className="eyebrow">N° {String(tenant.catalogVersion).padStart(3, '0')}</p>
        </div>
        <h1 className="home-hero__title">
          <span className="sr-only">{`${t('home.heroTitleA')} ${t('home.heroTitleB')} ${t('home.heroTitleC')}`}</span>
          {[t('home.heroTitleA'), t('home.heroTitleB'), t('home.heroTitleC')].map((line, i) => (
            <span key={i} className={`home-hero__line home-hero__line--${i}`} aria-hidden="true">
              <span className="home-hero__line-inner">
                <ScrambleText text={line} delay={0.3 + i * 0.15} aria-hidden="true" />
              </span>
            </span>
          ))}
        </h1>
        <div className="home-hero__art" aria-hidden="true">
          {hs && (
            <DrawOn delay={0.5}>
              <SaunaGlyph form={hs.form} widthMm={hs.widthMm} depthMm={hs.depthMm} heightMm={hs.heightMm} strokeWidth={0.9} />
            </DrawOn>
          )}
        </div>
        <div className="home-hero__foot">
          <p className="lede home-hero__after">{t('home.heroLede', { name })}</p>
          <div className="home-hero__ctas home-hero__after">
            <Magnetic>
              <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
                {t('home.ctaPrimary')}
              </ButtonLink>
            </Magnetic>
            <TextLink to="/how-it-works" tone="underline">
              {t('home.ctaSecondary')}
            </TextLink>
          </div>
          <dl className="home-hero__stats home-hero__after">
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
        <span className="home-hero__scroll home-hero__after" aria-hidden="true">
          <span className="home-hero__scroll-dot" />
          <span className="mono">{t('home.scroll')}</span>
        </span>
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
