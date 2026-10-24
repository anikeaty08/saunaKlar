import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import type { CatalogItem } from '../../../api/types.ts';
import { useFormat } from '../../../i18n/format.ts';
import { useFlipLayout } from '../../../motion/useFlipLayout.ts';
import { Segmented } from '../../../design/components/Segmented.tsx';
import { Select } from '../../../design/components/Field.tsx';
import { Skeleton } from '../../../design/components/Skeleton.tsx';
import { ButtonLink } from '../../../design/components/Button.tsx';
import { Icon } from '../../../design/components/Icon.tsx';
import { specsOf } from '../../components/specs.ts';
import { Media } from '../shared/Media.tsx';
import { useHome } from '../shared/useHome.ts';
import './catalogue.css';

type Seats = 'any' | '2' | '4' | '6';
type Place = 'any' | 'indoor' | 'outdoor';
type Sort = 'featured' | 'price-asc' | 'price-desc' | 'seats';

function Card({ item, currency }: { item: CatalogItem; currency: string }) {
  const { t } = useHome();
  const fmt = useFormat();
  const s = specsOf(item);
  const saving = item.listPriceMinor - item.priceFromMinor;
  return (
    <li className="ct-card" data-flip-id={item.id}>
      <Link to={`/saunas/${item.slug}`} className="ct-card__link" aria-label={t('saunas.view', { name: item.name })}>
        <span className="ct-card__media">
          <Media item={item} strokeWidth={0.9} />
          {saving > 0 && <span className="ct-card__save mono">−{fmt.money(saving, currency)}</span>}
        </span>
        <span className="ct-card__name">{item.name}</span>
        <span className="ct-card__specs">
          <span>{t('saunas.seats', { count: s.persons })}</span>
          <span>{t('saunas.dimensions', { w: fmt.mm(s.widthMm), d: fmt.mm(s.depthMm), h: fmt.mm(s.heightMm) })}</span>
          <span>{[s.indoor && t('saunas.placementIndoor'), s.outdoor && t('saunas.placementOutdoor')].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="ct-card__price">
          <span className="ct-card__from">{t('common.from')}</span>
          {saving > 0 && <s className="mono">{fmt.money(item.listPriceMinor, currency)}</s>}
          <span className="ct-card__amount mono">{fmt.money(item.priceFromMinor, currency)}</span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Catalogue: product first, for resellers with many models. A compact header,
 * a short hero, then every sauna with a filter and sort bar and dense cards.
 */
export function Home() {
  const { t, m, f, vars, items, currency, pending } = useHome();
  const [seats, setSeats] = useState<Seats>('any');
  const [place, setPlace] = useState<Place>('any');
  const [sort, setSort] = useState<Sort>('featured');

  const shown = useMemo(() => {
    const list = items.filter(it => {
      const s = specsOf(it);
      if (seats !== 'any' && s.persons < Number(seats)) return false;
      if (place === 'indoor' && !s.indoor) return false;
      if (place === 'outdoor' && !s.outdoor) return false;
      return true;
    });
    if (sort === 'price-asc') list.sort((a, b) => a.priceFromMinor - b.priceFromMinor);
    if (sort === 'price-desc') list.sort((a, b) => b.priceFromMinor - a.priceFromMinor);
    if (sort === 'seats') list.sort((a, b) => specsOf(b).persons - specsOf(a).persons);
    return list;
  }, [items, seats, place, sort]);
  const grid = useRef<HTMLUListElement>(null);
  useFlipLayout(grid, [seats, place, sort, shown.length]);

  return (
    <div className="catalogue">
      <section className="ct-hero container">
        <div>
          <p className="ct-badge">{t('home.eyebrow', vars)}</p>
          <h1 className="ct-hero__title">{t('home.catalogueTitle')}</h1>
        </div>
        <div className="ct-hero__side">
          <p>{t('home.catalogueLede')}</p>
          <p className="ct-hero__local">{t('home.heroLede', vars)}</p>
        </div>
      </section>

      <section className="container" aria-label={t('home.catalogueTitle')}>
        <div className="ct-bar" role="group" aria-label={t('saunas.filters')}>
          <Segmented
            label={t('saunas.capacity')}
            value={seats}
            onChange={v => setSeats(v as Seats)}
            size="sm"
            options={[
              { value: 'any', label: t('saunas.capacityAny') },
              { value: '2', label: t('saunas.capacityValue', { count: 2 }) },
              { value: '4', label: t('saunas.capacityValue', { count: 4 }) },
              { value: '6', label: t('saunas.capacityValue', { count: 6 }) },
            ]}
          />
          <Segmented
            label={t('saunas.placement')}
            value={place}
            onChange={v => setPlace(v as Place)}
            size="sm"
            options={[
              { value: 'any', label: t('saunas.placementAny') },
              { value: 'indoor', label: t('saunas.placementIndoor') },
              { value: 'outdoor', label: t('saunas.placementOutdoor') },
            ]}
          />
          <Select
            label={t('saunas.sort')}
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            options={[
              { value: 'featured', label: t('saunas.sortFeatured') },
              { value: 'price-asc', label: t('saunas.sortPriceAsc') },
              { value: 'price-desc', label: t('saunas.sortPriceDesc') },
              { value: 'seats', label: t('saunas.sortCapacity') },
            ]}
            className="ct-bar__sort"
            required
          />
          <p className="ct-bar__count mono" aria-live="polite">
            {t('saunas.count', { count: shown.length })}
          </p>
        </div>
        <ul ref={grid} className="ct-grid">
          {pending
            ? [0, 1, 2, 3].map(i => (
                <li key={i} className="ct-card">
                  <Skeleton width="100%" height="14rem" />
                </li>
              ))
            : shown.map(it => <Card key={it.id} item={it} currency={currency} />)}
        </ul>
        {!pending && shown.length === 0 && (
          <div className="ct-empty">
            <p>{t('saunas.emptyTitle')}</p>
            <button
              type="button"
              className="tlink"
              onClick={() => {
                setSeats('any');
                setPlace('any');
              }}
            >
              {t('saunas.reset')}
            </button>
          </div>
        )}
      </section>

      <section className="ct-how container" aria-labelledby="ct-how">
        <h2 id="ct-how" className="ct-h2">
          {t('home.howTitle')}
        </h2>
        <ol className="ct-steps">
          {m.home.howSteps.map((s, i) => (
            <li key={s.title}>
              <span className="ct-steps__num mono">{String(i + 1).padStart(2, '0')}</span>
              <h3>{s.title}</h3>
              <p>{f(s.body, vars)}</p>
            </li>
          ))}
        </ol>
        <div className="ct-how__cta">
          <ButtonLink to="/how-it-works" variant="ghost">
            {t('home.ctaSecondary')}
          </ButtonLink>
          <Link to="/contact" className="ct-how__contact">
            {t('footer.ctaSecondary')} <Icon icon={ArrowRight} size="sm" />
          </Link>
        </div>
      </section>
    </div>
  );
}
