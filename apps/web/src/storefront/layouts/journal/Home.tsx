import { useRef } from 'react';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { gsap, useGSAP } from '../../../motion/gsap.ts';
import { prefersReducedMotion } from '../../../motion/preferences.ts';
import { ButtonLink } from '../../../design/components/Button.tsx';
import { Icon } from '../../../design/components/Icon.tsx';
import { TextLink } from '../../../design/components/TextLink.tsx';
import { FeaturedPanels, HowSteps, Statement } from '../shared/sections.tsx';
import { Media } from '../shared/Media.tsx';
import { splashDelay, useHome } from '../shared/useHome.ts';
import './journal.css';

/**
 * Journal: a magazine. A masthead in very large serif type, three chapters
 * (heat, wood, ritual) as alternating image and text spreads, then the
 * collection, the reseller's statement and the steps.
 */
export function Home() {
  const { t, m, vars, name, items, currency, pending, hero } = useHome();
  const root = useRef<HTMLDivElement>(null);
  const year = new Date().getFullYear();

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;
      const d = splashDelay();
      gsap.from('.jr-mast__word > span', { yPercent: 105, duration: 1.4, stagger: 0.08, ease: 'sk.snap', delay: 0.25 + d });
      gsap.from('.jr-mast__fade', { autoAlpha: 0, y: 14, duration: 1, stagger: 0.07, ease: 'sk.outSoft', delay: 0.75 + d });
      gsap.from('.jr-mast__rule', { scaleX: 0, transformOrigin: '0 50%', duration: 1.4, ease: 'expo.inOut', delay: 0.1 + d });

      gsap.utils.toArray<HTMLElement>('.jr-spread').forEach(el => {
        const media = el.querySelector('.jr-spread__media .lmedia');
        if (media) {
          gsap.fromTo(media, { yPercent: -8, scale: 1.12 }, { yPercent: 8, scale: 1.12, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
        }
        gsap.from(el.querySelector('.jr-spread__frame'), {
          clipPath: 'inset(12% 8% 12% 8%)',
          duration: 1.4,
          ease: 'expo.inOut',
          scrollTrigger: { trigger: el, start: 'top 80%', once: true },
        });
        gsap.from(el.querySelectorAll('.jr-spread__text > *'), {
          y: 30,
          autoAlpha: 0,
          duration: 1,
          stagger: 0.08,
          ease: 'sk.outSoft',
          scrollTrigger: { trigger: el, start: 'top 70%', once: true },
        });
      });
    },
    { scope: root },
  );

  const pics = [hero, ...items.filter(i => i !== hero)];
  const words = [t('home.heroTitleA'), t('home.heroTitleB'), t('home.heroTitleC')];

  return (
    <div ref={root} className="journal">
      <header className="jr-mast container">
        <p className="jr-mast__meta jr-mast__fade mono">
          <span>{name}</span>
          <span>{t('home.eyebrow', vars)}</span>
          <span>{year}</span>
        </p>
        <span className="jr-mast__rule" aria-hidden="true" />
        <h1 className="jr-mast__title">
          <span className="sr-only">{words.join(' ')}</span>
          {words.map((w, i) => (
            <span key={i} className={`jr-mast__word jr-mast__word--${i}`} aria-hidden="true">
              <span>{w}</span>
            </span>
          ))}
        </h1>
        <div className="jr-mast__foot">
          <p className="jr-mast__lede jr-mast__fade">{t('home.heroLede', vars)}</p>
          <div className="jr-mast__ctas jr-mast__fade">
            <ButtonLink to="/saunas" size="lg" iconAfter={ArrowRight}>
              {t('home.ctaPrimary')}
            </ButtonLink>
            <a href="#jr-ch-0" className="jr-mast__down">
              {m.home.chapters[0]?.kicker} <Icon icon={ArrowDown} size="sm" />
            </a>
          </div>
        </div>
      </header>

      <div className="jr-chapters">
        {m.home.chapters.map((c, i) => (
          <section key={c.title} id={`jr-ch-${i}`} className={`jr-spread container${i % 2 ? ' jr-spread--flip' : ''}`} aria-labelledby={`jr-ch-t-${i}`}>
            <figure className="jr-spread__frame">
              <div className="jr-spread__media">
                <Media item={pics[i % Math.max(pics.length, 1)]} strokeWidth={0.6} />
              </div>
              <figcaption className="jr-spread__num" aria-hidden="true">
                {String(i + 1).padStart(2, '0')}
              </figcaption>
            </figure>
            <div className="jr-spread__text">
              <p className="jr-kicker">{c.kicker}</p>
              <h2 id={`jr-ch-t-${i}`} className="jr-spread__title">
                {c.title}
              </h2>
              <p className="jr-spread__body">{c.body}</p>
            </div>
          </section>
        ))}
      </div>

      <section className="jr-section container" aria-labelledby="jr-collection">
        <header className="jr-head">
          <p className="jr-kicker">{t('home.featuredEyebrow')}</p>
          <h2 id="jr-collection" className="jr-h2">
            {t('home.featuredTitle')}
          </h2>
          <p className="jr-head__lede">{t('home.featuredLede', vars)}</p>
        </header>
        {!pending && <FeaturedPanels items={items.slice(0, 4)} currency={currency} />}
        <p className="jr-more">
          <TextLink to="/saunas" tone="underline">
            {t('home.viewAll')}
          </TextLink>
        </p>
      </section>

      <Statement name={name} />

      <section className="jr-section container jr-how" aria-labelledby="jr-how">
        <header className="jr-head">
          <p className="jr-kicker">{t('home.howEyebrow')}</p>
          <h2 id="jr-how" className="jr-h2">
            {t('home.howTitle')}
          </h2>
        </header>
        <HowSteps name={name} />
      </section>
    </div>
  );
}
