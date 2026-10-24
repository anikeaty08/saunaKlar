import { useRef } from 'react';
import { Link } from 'react-router';
import { ArrowRight, Phone } from 'lucide-react';
import { gsap, useGSAP } from '../../../motion/gsap.ts';
import { prefersReducedMotion } from '../../../motion/preferences.ts';
import { Reveal } from '../../../motion/Reveal.tsx';
import { ButtonLink } from '../../../design/components/Button.tsx';
import { Icon } from '../../../design/components/Icon.tsx';
import { TextLink } from '../../../design/components/TextLink.tsx';
import { SaunaCard, SaunaCardSkeleton, SaunaGrid } from '../../components/SaunaCard.tsx';
import { Media } from '../shared/Media.tsx';
import { splashDelay, useHome } from '../shared/useHome.ts';
import './nordic.css';

/** Wood swatches for the materials band, in the order of guide.woods (spruce, alder, thermo aspen, kelo). */
const WOOD = ['#dcc39b', '#c48d5e', '#a8774a', '#8d7a66'];

/**
 * Nordic: warm and crafted. Wood-and-paper surfaces (theme flavour "warm"),
 * Fraunces headings, a split hero with the photograph on the left, rounded
 * cards and a band about the timber.
 */
export function Home() {
  const { t, m, f, vars, tenant, items, currency, pending, hero } = useHome();
  const root = useRef<HTMLDivElement>(null);
  const phone = tenant.branding.supportPhone;

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const d = splashDelay();
      gsap.from('.nd-hero__photo', { clipPath: 'inset(0 0 100% 0 round 28px)', duration: 1.5, ease: 'expo.inOut', delay: 0.2 + d });
      gsap.from('.nd-hero__photo .lmedia', { scale: 1.15, duration: 2, ease: 'sk.outSoft', delay: 0.2 + d });
      gsap.from('.nd-hero__in > *', { y: 26, autoAlpha: 0, duration: 1, stagger: 0.08, ease: 'sk.outSoft', delay: 0.6 + d });
      gsap.from('.nd-wood__swatch', { scaleY: 0, transformOrigin: '50% 100%', duration: 1, stagger: 0.1, ease: 'sk.snap', scrollTrigger: { trigger: '.nd-wood', start: 'top 75%', once: true } });
    },
    { scope: root },
  );

  return (
    <div ref={root} className="nordic">
      <section className="nd-hero container">
        <div className="nd-hero__photo">
          <Media item={hero} />
        </div>
        <div className="nd-hero__text">
          <div className="nd-hero__in">
            <p className="nd-badge">{t('home.eyebrow', vars)}</p>
            <h1 className="nd-hero__title">
              {t('home.heroTitleA')} {t('home.heroTitleB')} <em>{t('home.heroTitleC')}</em>
            </h1>
            <p className="nd-hero__lede">{t('home.heroLede', vars)}</p>
            <div className="nd-hero__ctas">
              <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
                {t('home.ctaPrimary')}
              </ButtonLink>
              <TextLink to="/how-it-works" tone="underline">
                {t('home.ctaSecondary')}
              </TextLink>
            </div>
            <p className="nd-hero__local">
              <span>{t('home.local')}</span>
              {phone && (
                <a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>
                  <Icon icon={Phone} size="sm" /> {phone}
                </a>
              )}
            </p>
          </div>
        </div>
      </section>

      <section className="nd-section container" aria-labelledby="featured">
        <header className="nd-head">
          <div>
            <p className="eyebrow">{t('home.featuredEyebrow')}</p>
            <h2 id="featured" className="nd-h2">
              {t('home.featuredTitle')}
            </h2>
          </div>
          <p className="nd-head__lede">{t('home.featuredLede', vars)}</p>
        </header>
        <Reveal as={SaunaGrid}>
          {pending
            ? [0, 1, 2].map(i => <SaunaCardSkeleton key={i} />)
            : items.slice(0, 6).map((it, i) => <SaunaCard key={it.id} item={it} index={i} currency={currency} />)}
        </Reveal>
        <p className="nd-more">
          <ButtonLink to="/saunas" variant="ghost">
            {t('home.viewAll')}
          </ButtonLink>
        </p>
      </section>

      <section className="nd-wood" aria-labelledby="nd-wood">
        <div className="container nd-wood__grid">
          <div>
            <p className="eyebrow">{t('home.materialsEyebrow')}</p>
            <h2 id="nd-wood" className="nd-h2">
              {t('home.materialsTitle')}
            </h2>
            <p className="nd-wood__lede">{t('home.materialsLede', vars)}</p>
            <Link to="/guide" className="nd-wood__link">
              {t('nav.guide')} <Icon icon={ArrowRight} size="sm" />
            </Link>
          </div>
          <ul className="nd-wood__list">
            {m.guide.woods.map((w, i) => (
              <li key={w.title}>
                <span className="nd-wood__swatch" style={{ background: WOOD[i] }} aria-hidden="true" />
                <h3>{w.title}</h3>
                <p>{w.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="nd-section container" aria-labelledby="nd-how">
        <header className="nd-head">
          <div>
            <p className="eyebrow">{t('home.howEyebrow')}</p>
            <h2 id="nd-how" className="nd-h2">
              {t('home.howTitle')}
            </h2>
          </div>
        </header>
        <Reveal as="ol" className="nd-steps">
          {m.home.howSteps.map((s, i) => (
            <li key={s.title}>
              <span className="nd-steps__num">{i + 1}</span>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </Reveal>
      </section>

      <section className="nd-section container nd-visit" aria-labelledby="nd-visit">
        <div className="nd-visit__card">
          <p className="eyebrow">{t('home.visitEyebrow')}</p>
          <h2 id="nd-visit" className="nd-h2">
            {t('home.visitTitle')}
          </h2>
          <p>{t('home.visitBody')}</p>
          <ButtonLink to="/contact" variant="ghost" size="lg">
            {t('footer.ctaSecondary')}
          </ButtonLink>
        </div>
        <ul className="nd-visit__trust">
          {m.home.trust.map(s => (
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
