import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import type { CatalogItem } from '../../../api/types.ts';
import { gsap, useGSAP } from '../../../motion/gsap.ts';
import { prefersReducedMotion } from '../../../motion/preferences.ts';
import { Reveal } from '../../../motion/Reveal.tsx';
import { Icon } from '../../../design/components/Icon.tsx';
import { LazyImage } from '../../../design/components/LazyImage.tsx';
import { Skeleton } from '../../../design/components/Skeleton.tsx';
import { useFormat } from '../../../i18n/format.ts';
import { SaunaGlyph } from '../../components/SaunaGlyph.tsx';
import { specsOf } from '../../components/specs.ts';
import { splashDelay, useHome } from '../shared/useHome.ts';
import './showroom.css';

const ROOMY = '(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)';

function Media({ item, className }: { item: CatalogItem; className?: string }) {
  const s = specsOf(item);
  return (
    <div className={className}>
      {item.assets.thumbnailUrl ? (
        <LazyImage src={item.assets.thumbnailUrl} alt="" width={1600} height={1200} />
      ) : (
        <SaunaGlyph form={s.form} widthMm={s.widthMm} depthMm={s.depthMm} heightMm={s.heightMm} className="sw-glyph" strokeWidth={0.6} />
      )}
    </div>
  );
}

/** Horizontal rail of saunas: pinned and scrubbed sideways on roomy screens, a swipeable strip elsewhere. */
function Rail({ items, currency }: { items: CatalogItem[]; currency: string }) {
  const { t, vars } = useHome();
  const fmt = useFormat();
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      if (!items.length) return;
      const mm = gsap.matchMedia();
      mm.add(ROOMY, () => {
        const track = root.current?.querySelector<HTMLElement>('.sw-rail__track');
        if (!track) return;
        const dist = () => Math.max(0, track.scrollWidth - window.innerWidth);
        gsap.to(track, {
          x: () => -dist(),
          ease: 'none',
          scrollTrigger: { trigger: root.current, start: 'top top', end: () => `+=${dist()}`, pin: true, scrub: 0.6, invalidateOnRefresh: true },
        });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [items.length] },
  );

  return (
    <section ref={root} className="sw-rail" aria-labelledby="featured">
      <div className="sw-rail__head container">
        <div>
          <p className="eyebrow">{t('home.featuredEyebrow')}</p>
          <h2 id="featured" className="sw-h2">
            {t('home.featuredTitle')}
          </h2>
        </div>
        <p className="sw-rail__lede">{t('home.featuredLede', vars)}</p>
      </div>
      <ul className="sw-rail__track">
        {items.length === 0
          ? [0, 1, 2].map(i => (
              <li key={i} className="sw-card">
                <Skeleton width="100%" height="100%" />
              </li>
            ))
          : items.map((it, i) => {
              const s = specsOf(it);
              return (
                <li key={it.id} className="sw-card">
                  <Link to={`/saunas/${it.slug}`} className="sw-card__link" aria-label={t('saunas.view', { name: it.name })}>
                    <Media item={it} className="sw-card__media" />
                    <span className="sw-card__num mono">{String(i + 1).padStart(2, '0')}</span>
                    <span className="sw-card__body">
                      <span className="sw-card__name">{it.name}</span>
                      <span className="sw-card__meta mono">
                        {t('saunas.seats', { count: s.persons })} · {t('common.from')} {fmt.money(it.priceFromMinor, currency)}
                      </span>
                    </span>
                    <span className="sw-card__go" aria-hidden="true">
                      <Icon icon={ArrowUpRight} size="md" />
                    </span>
                  </Link>
                </li>
              );
            })}
        <li className="sw-card sw-card--all">
          <Link to="/saunas" className="sw-card__link">
            <span className="sw-card__name">{t('home.viewAll')}</span>
            <Icon icon={ArrowRight} size="lg" />
          </Link>
        </li>
      </ul>
      <p className="sw-rail__hint mono container" aria-hidden="true">
        {t('home.railHint')} →
      </p>
    </section>
  );
}

/**
 * Showroom: dark and cinematic. A full-bleed photograph under the header,
 * light type, a sideways rail through the collection, a statement that lights
 * up word by word, and the visit-and-install promise.
 */
export function Home() {
  const { t, m, f, vars, items, currency, hero } = useHome();
  const fmt = useFormat();
  const root = useRef<HTMLDivElement>(null);
  const statement = t('home.statement').split(' ');

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const d = splashDelay();
      gsap.from('.sw-hero__media', { scale: 1.18, duration: 2.6, ease: 'sk.outSoft', delay: d });
      gsap.to('.sw-hero__media', { yPercent: 12, ease: 'none', scrollTrigger: { trigger: '.sw-hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.from('.sw-hero__line > span', { yPercent: 110, duration: 1.3, stagger: 0.1, ease: 'sk.snap', delay: 0.4 + d });
      gsap.from('.sw-hero__fade', { autoAlpha: 0, y: 18, duration: 1, stagger: 0.08, ease: 'sk.outSoft', delay: 0.8 + d });
      gsap.fromTo('.sw-statement__w', { opacity: 0.18 }, { opacity: 1, stagger: 0.05, ease: 'none', scrollTrigger: { trigger: '.sw-statement', start: 'top 75%', end: 'bottom 55%', scrub: true } });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="showroom">
      <section className="sw-hero">
        <div className="sw-hero__media" aria-hidden="true">
          {hero && <Media item={hero} className="sw-hero__img" />}
        </div>
        <div className="sw-hero__shade" aria-hidden="true" />
        <div className="sw-hero__content container">
          <p className="sw-badge sw-hero__fade">{t('home.eyebrow', vars)}</p>
          <h1 className="sw-hero__title">
            <span className="sr-only">{`${t('home.heroTitleA')} ${t('home.heroTitleB')} ${t('home.heroTitleC')}`}</span>
            {[t('home.heroTitleA'), t('home.heroTitleB'), t('home.heroTitleC')].map((line, i) => (
              <span key={i} className="sw-hero__line" aria-hidden="true">
                <span>{line}</span>
              </span>
            ))}
          </h1>
          <p className="sw-hero__lede sw-hero__fade">{t('home.heroLede', vars)}</p>
          <div className="sw-hero__ctas sw-hero__fade">
            <Link to="/saunas" className="btn btn--light btn--lg">
              {t('home.ctaPrimary')}
              <Icon icon={ArrowRight} size="sm" />
            </Link>
            <Link to="/how-it-works" className="btn btn--ghost btn--lg">
              {t('home.ctaSecondary')}
            </Link>
          </div>
        </div>
        {hero && (
          <Link to={`/saunas/${hero.slug}`} className="sw-hero__tag sw-hero__fade">
            <span className="mono">01</span>
            <span>{hero.name}</span>
            <span className="mono">
              {t('common.from')} {fmt.money(hero.priceFromMinor, currency)}
            </span>
          </Link>
        )}
      </section>

      <Rail items={items} currency={currency} />

      <section className="sw-statement container">
        <p className="eyebrow">{t('home.statementEyebrow')}</p>
        <p className="sw-statement__text">
          {statement.map((w, i) => (
            <span key={i} className="sw-statement__w">
              {w}{' '}
            </span>
          ))}
        </p>
      </section>

      <section className="sw-section container" aria-labelledby="sr-how">
        <p className="eyebrow">{t('home.howEyebrow')}</p>
        <h2 id="sr-how" className="sw-h2">
          {t('home.howTitle')}
        </h2>
        <Reveal as="ol" className="sw-steps">
          {m.home.howSteps.map((s, i) => (
            <li key={s.title}>
              <span className="sw-steps__num">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="sw-visit container" aria-labelledby="sw-visit">
        <div>
          <p className="eyebrow">{t('home.visitEyebrow')}</p>
          <h2 id="sw-visit" className="sw-h2">
            {t('home.visitTitle')}
          </h2>
          <p className="sw-visit__body">{t('home.visitBody')}</p>
          <Link to="/contact" className="btn btn--light btn--lg">
            {t('footer.ctaSecondary')}
          </Link>
        </div>
        <ul className="sw-visit__trust">
          {m.home.trust.slice(0, 3).map(s => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
