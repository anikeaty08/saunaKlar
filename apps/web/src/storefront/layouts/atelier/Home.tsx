import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { gsap, useGSAP } from '../../../motion/gsap.ts';
import { prefersReducedMotion } from '../../../motion/preferences.ts';
import { Reveal } from '../../../motion/Reveal.tsx';
import { NumberTicker } from '../../../motion/NumberTicker.tsx';
import { ButtonLink } from '../../../design/components/Button.tsx';
import { Icon } from '../../../design/components/Icon.tsx';
import { LazyImage } from '../../../design/components/LazyImage.tsx';
import { TextLink } from '../../../design/components/TextLink.tsx';
import { useFormat } from '../../../i18n/format.ts';
import { SaunaCard, SaunaCardSkeleton, SaunaGrid } from '../../components/SaunaCard.tsx';
import { SaunaGlyph } from '../../components/SaunaGlyph.tsx';
import { specsOf } from '../../components/specs.ts';
import { splashDelay, useHome } from '../shared/useHome.ts';
import './atelier.css';

const ROMAN = ['I', 'II', 'III', 'IV'];

/**
 * Atelier: editorial and calm. A centred serif headline with room around it,
 * one framed photograph, a refined three-column collection, a quiet statement
 * and the four steps as numbered columns.
 */
export function Home() {
  const { t, m, f, vars, items, currency, pending, maxSeats, hero } = useHome();
  const fmt = useFormat();
  const root = useRef<HTMLDivElement>(null);
  const hs = hero ? specsOf(hero) : null;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const d = splashDelay();
      gsap.from('.at-hero__line > span', { yPercent: 110, duration: 1.3, stagger: 0.1, ease: 'sk.snap', delay: 0.3 + d });
      gsap.from('.at-hero__fade', { autoAlpha: 0, y: 16, duration: 1, stagger: 0.08, ease: 'sk.outSoft', delay: 0.7 + d });
      gsap.from('.at-frame', { clipPath: 'inset(18% 12% 0% 12% round 28px)', duration: 1.6, ease: 'expo.inOut', delay: 0.6 + d });
      gsap.from('.at-frame .at-frame__media', { scale: 1.12, duration: 2, ease: 'sk.outSoft', delay: 0.6 + d });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="atelier">
      <section className="at-hero container">
        <p className="at-badge at-hero__fade">{t('home.eyebrow', vars)}</p>
        <h1 className="at-hero__title">
          <span className="sr-only">{`${t('home.heroTitleA')} ${t('home.heroTitleB')} ${t('home.heroTitleC')}`}</span>
          {[t('home.heroTitleA'), t('home.heroTitleB'), t('home.heroTitleC')].map((line, i) => (
            <span key={i} className={`at-hero__line at-hero__line--${i}`} aria-hidden="true">
              <span>{line}</span>
            </span>
          ))}
        </h1>
        <p className="at-hero__lede at-hero__fade">{t('home.heroLede', vars)}</p>
        <div className="at-hero__ctas at-hero__fade">
          <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
            {t('home.ctaPrimary')}
          </ButtonLink>
          <TextLink to="/how-it-works" tone="underline">
            {t('home.ctaSecondary')}
          </TextLink>
        </div>
      </section>

      <section className="container" aria-label={hero?.name}>
        <figure className="at-frame">
          <div className="at-frame__media">
            {hero?.assets.thumbnailUrl ? (
              <LazyImage src={hero.assets.thumbnailUrl} alt="" width={2100} height={900} />
            ) : (
              hs && <SaunaGlyph form={hs.form} widthMm={hs.widthMm} depthMm={hs.depthMm} heightMm={hs.heightMm} className="at-frame__glyph" strokeWidth={0.6} />
            )}
          </div>
          {hero && (
            <figcaption className="at-frame__cap">
              <span className="at-frame__name">{hero.name}</span>
              <span className="mono">
                {t('common.from')} {fmt.money(hero.priceFromMinor, currency)}
              </span>
              <Link to={`/saunas/${hero.slug}`} className="at-frame__go">
                {t('home.panelCta')} <Icon icon={ArrowRight} size="sm" />
              </Link>
            </figcaption>
          )}
        </figure>
      </section>

      <Reveal as="dl" className="at-facts container">
        <div>
          <dd>
            <NumberTicker value={items.length || 6} format={n => String(Math.round(n))} />
          </dd>
          <dt>{t('home.stats.models')}</dt>
        </div>
        <div>
          <dd>
            <NumberTicker value={maxSeats} format={n => String(Math.round(n))} />
          </dd>
          <dt>{t('home.stats.seats')}</dt>
        </div>
        <div>
          <dd>30</dd>
          <dt>{t('home.stats.days')}</dt>
        </div>
      </Reveal>

      <section className="at-section container" aria-labelledby="featured">
        <header className="at-head">
          <p className="eyebrow">{t('home.featuredEyebrow')}</p>
          <h2 id="featured" className="at-h2">
            {t('home.featuredTitle')}
          </h2>
          <p className="at-head__lede">{t('home.featuredLede', vars)}</p>
        </header>
        <Reveal as={SaunaGrid}>
          {pending
            ? [0, 1, 2].map(i => <SaunaCardSkeleton key={i} />)
            : items.slice(0, 6).map((it, i) => <SaunaCard key={it.id} item={it} index={i} currency={currency} />)}
        </Reveal>
        <p className="at-more">
          <TextLink to="/saunas" tone="underline">
            {t('home.viewAll')}
          </TextLink>
        </p>
      </section>

      <section className="at-quote container">
        <p className="eyebrow">{t('home.statementEyebrow')}</p>
        <blockquote>{t('home.statement')}</blockquote>
      </section>

      <section className="at-section container" aria-labelledby="at-how">
        <header className="at-head">
          <p className="eyebrow">{t('home.howEyebrow')}</p>
          <h2 id="at-how" className="at-h2">
            {t('home.howTitle')}
          </h2>
        </header>
        <Reveal as="ol" className="at-steps">
          {m.home.howSteps.map((s, i) => (
            <li key={s.title}>
              <span className="at-steps__num">{ROMAN[i]}</span>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="at-section container" aria-labelledby="at-trust">
        <header className="at-head">
          <p className="eyebrow">{t('home.trustEyebrow')}</p>
          <h2 id="at-trust" className="at-h2">
            {t('home.trustTitle')}
          </h2>
        </header>
        <Reveal as="ul" className="at-trust">
          {m.home.trust.map(s => (
            <li key={s.title}>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>
    </div>
  );
}
