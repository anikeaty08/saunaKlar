import { useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowUpRight, Plus } from 'lucide-react';
import type { CatalogItem } from '../../api/types.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { gsap, useGSAP } from '../../motion/gsap.ts';
import { prefersReducedMotion } from '../../motion/preferences.ts';
import { Icon } from '../../design/components/Icon.tsx';
import { LazyImage } from '../../design/components/LazyImage.tsx';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import { specsOf } from '../components/specs.ts';

/** Pinning and fanning need room and motion; below this they are plain stacks. */
const ROOMY = '(min-width: 1024px) and (min-height: 640px) and (prefers-reduced-motion: no-preference)';

/** A large statement, then the principle cards fanning out of a stack as it scrolls in. */
export function Statement({ name }: { name: string }) {
  const { t, m, f } = useT();
  const root = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(ROOMY, () => {
        const cards = gsap.utils.toArray<HTMLElement>('.stmt__card');
        const mid = (cards.length - 1) / 2;
        gsap.from(cards, {
          x: (i: number) => (mid - i) * 260,
          y: (i: number) => Math.abs(i - mid) * -30 + 60,
          rotate: (i: number) => (mid - i) * 7,
          ease: 'none',
          scrollTrigger: { trigger: '.stmt__cards', start: 'top 85%', end: 'top 30%', scrub: 0.6 },
        });
      });
      if (!prefersReducedMotion())
        gsap.from('.stmt__text', { y: 40, autoAlpha: 0, duration: 1.1, ease: 'sk.outSoft', scrollTrigger: { trigger: '.stmt__text', start: 'top 85%', once: true } });
      return () => mm.revert();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="stmt section container" aria-labelledby="stmt-title">
      <p className="eyebrow">{t('home.statementEyebrow')}</p>
      <h2 id="stmt-title" className="stmt__text">
        {t('home.statement')}
      </h2>
      <ul className="stmt__cards">
        {m.home.trust.map((c, i) => (
          <li key={c.title} className="stmt__card">
            <span className="stmt__num mono">{String(i + 1).padStart(2, '0')}</span>
            <h3>{c.title}</h3>
            <p>{f(c.body, { name })}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Featured saunas as full-bleed panels. On roomy screens each panel pins and
 * the next one slides up over it like a curtain while the covered one sinks
 * back; elsewhere they are a simple stack.
 */
export function FeaturedPanels({ items, currency }: { items: CatalogItem[]; currency: string }) {
  const { t } = useT();
  const fmt = useFormat();
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!items.length) return;
      const mm = gsap.matchMedia();
      mm.add(ROOMY, () => {
        const panels = gsap.utils.toArray<HTMLElement>('.fpanel');
        panels.forEach((p, i) => {
          const next = panels[i + 1];
          if (!next) return;
          gsap.timeline({ scrollTrigger: { trigger: p, start: 'top top', endTrigger: next, end: 'top top', pin: true, pinSpacing: false, scrub: true } }).to(
            p.querySelector('.fpanel__in'),
            { scale: 0.9, autoAlpha: 0.35, ease: 'none' },
          );
          gsap.fromTo(next, { clipPath: 'inset(12% 6% 0 6% round 28px)' }, { clipPath: 'inset(0% 0% 0 0% round 0px)', ease: 'none', scrollTrigger: { trigger: next, start: 'top bottom', end: 'top top', scrub: true } });
        });
      });
      return () => mm.revert();
    },
    { scope: root, dependencies: [items.length] },
  );

  return (
    <div ref={root} className="fpanels">
      {items.map((it, i) => {
        const s = specsOf(it);
        return (
          <article key={it.id} className="fpanel">
            <div className="fpanel__in">
              <div className="fpanel__media" aria-hidden="true">
                {it.assets.thumbnailUrl ? (
                  <LazyImage src={it.assets.thumbnailUrl} alt="" width={1600} height={1000} />
                ) : (
                  <SaunaGlyph form={s.form} widthMm={s.widthMm} depthMm={s.depthMm} heightMm={s.heightMm} className="fpanel__glyph" strokeWidth={0.6} />
                )}
              </div>
              <div className="fpanel__body container">
                <p className="fpanel__count mono">
                  {String(i + 1).padStart(2, '0')} / {String(items.length).padStart(2, '0')}
                </p>
                <h3 className="fpanel__name">{it.name}</h3>
                <p className="fpanel__meta mono">
                  {t('saunas.seats', { count: s.persons })} · {t('saunas.dimensions', { w: fmt.mm(s.widthMm), d: fmt.mm(s.depthMm), h: fmt.mm(s.heightMm) })}
                </p>
                <div className="fpanel__foot">
                  <p className="fpanel__price">
                    <span>{t('common.from')}</span> <span className="mono">{fmt.money(it.priceFromMinor, currency)}</span>
                  </p>
                  <Link to={`/saunas/${it.slug}`} className="btn btn--light btn--lg" aria-label={`${t('home.panelCta')}: ${it.name}`}>
                    {t('home.panelCta')}
                    <Icon icon={ArrowUpRight} size="sm" />
                  </Link>
                </div>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function Step({ index, title, body, open, onToggle }: { index: number; title: string; body: string; open: boolean; onToggle: () => void }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useGSAP(
    () => {
      const el = panel.current;
      if (!el) return;
      if (first.current || prefersReducedMotion()) {
        first.current = false;
        gsap.set(el, { height: open ? 'auto' : 0 });
        return;
      }
      gsap.to(el, { height: open ? 'auto' : 0, duration: 0.7, ease: 'sk.snap' });
    },
    { dependencies: [open] },
  );
  return (
    <li className={['hsteps__item', open && 'is-open'].filter(Boolean).join(' ')}>
      <span className="hsteps__ghost" aria-hidden="true">
        {String(index + 1).padStart(2, '0')}
      </span>
      <h3 className="hsteps__heading">
        <button type="button" className="hsteps__trigger" aria-expanded={open} aria-controls={`${id}-p`} id={`${id}-b`} onClick={onToggle}>
          <span className="hsteps__num mono">{String(index + 1).padStart(2, '0')}</span>
          <span className="hsteps__title">{title}</span>
          <Icon icon={Plus} size="md" className="hsteps__icon" />
        </button>
      </h3>
      <div ref={panel} id={`${id}-p`} role="region" aria-labelledby={`${id}-b`} className="hsteps__panel" inert={!open || undefined}>
        <p className="hsteps__body">{body}</p>
      </div>
    </li>
  );
}

/** How it works: four steps as an accordion (one open at a time) with large ghost numbers. */
export function HowSteps({ name }: { name: string }) {
  const { m, f } = useT();
  const [open, setOpen] = useState(0);
  return (
    <ol className="hsteps">
      {m.home.howSteps.map((s, i) => (
        <Step key={s.title} index={i} title={s.title} body={f(s.body, { name })} open={open === i} onToggle={() => setOpen(o => (o === i ? -1 : i))} />
      ))}
    </ol>
  );
}
