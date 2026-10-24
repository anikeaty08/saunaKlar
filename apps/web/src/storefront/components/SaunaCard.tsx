import { Link } from 'react-router';
import { ArrowUpRight } from 'lucide-react';
import type { CatalogItem } from '../../api/types.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { FlipText } from '../../motion/FlipText.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { LazyImage } from '../../design/components/LazyImage.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { useInView } from '../../design/useInView.ts';
import { prefetchPath } from '../../app/prefetch.ts';
import { SaunaGlyph } from './SaunaGlyph.tsx';
import { specsOf } from './specs.ts';
import './SaunaCard.css';

interface Props {
  item: CatalogItem;
  currency: string;
  index: number;
  size?: 'md' | 'lg';
}

/** Catalogue card: drawing or thumbnail, name with flip, seats and size, list → discounted price. */
export function SaunaCard({ item, currency, index, size = 'md' }: Props) {
  const { t } = useT();
  const fmt = useFormat();
  const s = specsOf(item);
  const [ref, inView] = useInView<HTMLDivElement>('300px');
  const to = `/saunas/${item.slug}`;
  const saving = item.listPriceMinor - item.priceFromMinor;
  return (
    <article className={`scard scard--${size}`} data-flip-id={item.id}>
      <Link to={to} className="scard__link" onPointerEnter={() => prefetchPath(to)} onFocus={() => prefetchPath(to)} aria-label={t('saunas.view', { name: item.name })}>
        <div ref={ref} className="scard__media">
          <span className="scard__index mono">{String(index + 1).padStart(2, '0')}</span>
          {saving > 0 && <span className="scard__save mono">−{fmt.money(saving, currency)}</span>}
          {item.assets.thumbnailUrl ? (
            <LazyImage src={item.assets.thumbnailUrl} alt="" width={800} height={600} />
          ) : inView ? (
            <SaunaGlyph form={s.form} widthMm={s.widthMm} depthMm={s.depthMm} heightMm={s.heightMm} className="scard__glyph" />
          ) : (
            <Skeleton width="60%" height="60%" />
          )}
          <span className="scard__go" aria-hidden="true">
            <Icon icon={ArrowUpRight} size="md" />
          </span>
        </div>
        <div className="scard__body">
          <h3 className="scard__name">
            <FlipText text={item.name} />
          </h3>
          <p className="scard__meta mono">
            <span>{t('saunas.seats', { count: s.persons })}</span>
            <span aria-hidden="true">·</span>
            <span>{t('saunas.dimensions', { w: fmt.mm(s.widthMm), d: fmt.mm(s.depthMm), h: fmt.mm(s.heightMm) })}</span>
          </p>
          <p className="scard__price">
            <span className="scard__from">{t('common.from')}</span>
            {saving > 0 && <s className="scard__list mono">{fmt.money(item.listPriceMinor, currency)}</s>}
            <span className="scard__amount mono">{fmt.money(item.priceFromMinor, currency)}</span>
          </p>
        </div>
      </Link>
    </article>
  );
}

export function SaunaCardSkeleton() {
  return (
    <div className="scard" aria-hidden="true">
      <div className="scard__media">
        <Skeleton width="55%" height="55%" />
      </div>
      <div className="scard__body">
        <Skeleton width="60%" height="1.6rem" />
        <Skeleton width="80%" height="0.8rem" style={{ marginTop: '0.75rem' }} />
        <Skeleton width="35%" height="1.1rem" style={{ marginTop: '1rem' }} />
      </div>
    </div>
  );
}

/** Responsive grid for cards. */
export function SaunaGrid({ children, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div className="sgrid" {...rest}>
      {children}
    </div>
  );
}
