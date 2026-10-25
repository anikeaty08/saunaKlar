import { useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { SearchX } from 'lucide-react';
import { useCatalog } from '../../api/queries.ts';
import { useT } from '../../i18n/i18n.ts';
import { useFormat } from '../../i18n/format.ts';
import { ScrambleText } from '../../motion/ScrambleText.tsx';
import { useFlipLayout } from '../../motion/useFlipLayout.ts';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Select } from '../../design/components/Field.tsx';
import { Button } from '../../design/components/Button.tsx';
import { EmptyState } from '../../design/components/EmptyState.tsx';
import { ErrorPage } from '../../design/components/ErrorBoundary.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { SaunaCard, SaunaCardSkeleton, SaunaGrid } from '../components/SaunaCard.tsx';
import { specsOf } from '../components/specs.ts';
import './Saunas.css';

type Sort = 'featured' | 'price-asc' | 'price-desc' | 'capacity' | 'size';
type Size = 'any' | 'compact' | 'medium' | 'large';
type Place = 'any' | 'indoor' | 'outdoor';

export default function Saunas() {
  const { t } = useT();
  const fmt = useFormat();
  const catalog = useCatalog();
  const [params, setParams] = useSearchParams();
  useDocumentTitle(t('saunas.title'));

  const seats = params.get('seats') ?? 'any';
  const size = (params.get('size') ?? 'any') as Size;
  const place = (params.get('place') ?? 'any') as Place;
  const max = params.get('max') ?? 'any';
  const sort = (params.get('sort') ?? 'featured') as Sort;

  const grid = useRef<HTMLDivElement>(null);
  const items = catalog.data?.items ?? [];
  const currency = catalog.data?.currency ?? 'EUR';

  const priceSteps = useMemo(() => {
    if (!items.length) return [];
    const prices = items.map(i => i.priceFromMinor);
    const lo = Math.min(...prices);
    const hi = Math.max(...prices);
    const step = 500000;
    const out: number[] = [];
    for (let p = Math.ceil(lo / step) * step; p < hi; p += step) out.push(p);
    return out;
  }, [items]);

  const visible = useMemo(() => {
    const list = items.filter(i => {
      const s = specsOf(i);
      if (seats !== 'any' && s.persons < Number(seats)) return false;
      if (size === 'compact' && s.footprintM2 > 2.5) return false;
      if (size === 'medium' && (s.footprintM2 <= 2.5 || s.footprintM2 > 4.5)) return false;
      if (size === 'large' && s.footprintM2 <= 4.5) return false;
      if (place === 'indoor' && !s.indoor) return false;
      if (place === 'outdoor' && !s.outdoor) return false;
      if (max !== 'any' && i.priceFromMinor > Number(max)) return false;
      return true;
    });
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      featured: (a, b) => a.sortOrder - b.sortOrder,
      'price-asc': (a, b) => a.priceFromMinor - b.priceFromMinor,
      'price-desc': (a, b) => b.priceFromMinor - a.priceFromMinor,
      capacity: (a, b) => specsOf(b).persons - specsOf(a).persons,
      size: (a, b) => specsOf(a).footprintM2 - specsOf(b).footprintM2,
    };
    return [...list].sort(by[sort]);
  }, [items, seats, size, place, max, sort]);

  const { capture } = useFlipLayout(grid, [visible.map(v => v.id).join()]);

  const set = (key: string, value: string) => {
    capture();
    const next = new URLSearchParams(params);
    if (value === 'any' || (key === 'sort' && value === 'featured')) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const reset = () => {
    capture();
    setParams({}, { replace: true, preventScrollReset: true });
  };
  const filtered = params.toString() !== '' && !(params.size === 1 && params.has('sort'));

  if (catalog.error) return <ErrorPage error={catalog.error} onRetry={() => void catalog.refetch()} />;

  return (
    <div className="page container">
      <header className="page-hero saunas-hero">
        <ScrambleText as="p" className="eyebrow" text={t('saunas.eyebrow')} />
        <ScrambleText as="h1" className="page-title" text={t('saunas.title')} />
        <p className="lede">{t('saunas.lede')}</p>
      </header>

      <section className="filters" aria-label={t('saunas.filters')}>
        <Segmented
          label={t('saunas.capacity')}
          value={seats}
          onChange={v => set('seats', v)}
          options={[
            { value: 'any', label: t('saunas.capacityAny') },
            { value: '2', label: t('saunas.capacityValue', { count: 2 }) },
            { value: '4', label: t('saunas.capacityValue', { count: 4 }) },
            { value: '6', label: t('saunas.capacityValue', { count: 6 }) },
          ]}
          size="sm"
        />
        <Segmented
          label={t('saunas.placement')}
          value={place}
          onChange={v => set('place', v)}
          options={[
            { value: 'any', label: t('saunas.capacityAny') },
            { value: 'indoor', label: t('saunas.placementIndoor') },
            { value: 'outdoor', label: t('saunas.placementOutdoor') },
          ]}
          size="sm"
        />
        <Select
          label={t('saunas.size')}
          value={size}
          onChange={e => set('size', e.target.value)}
          options={[
            { value: 'any', label: t('saunas.sizeAny') },
            { value: 'compact', label: t('saunas.sizeCompact') },
            { value: 'medium', label: t('saunas.sizeMedium') },
            { value: 'large', label: t('saunas.sizeLarge') },
          ]}
          required
        />
        <Select
          label={t('saunas.price')}
          value={max}
          onChange={e => set('max', e.target.value)}
          options={[{ value: 'any', label: t('saunas.priceAny') }, ...priceSteps.map(p => ({ value: String(p), label: t('saunas.priceUpTo', { price: fmt.money(p, currency) }) }))]}
          required
        />
        <Select
          label={t('saunas.sort')}
          value={sort}
          onChange={e => set('sort', e.target.value)}
          options={[
            { value: 'featured', label: t('saunas.sortFeatured') },
            { value: 'price-asc', label: t('saunas.sortPriceAsc') },
            { value: 'price-desc', label: t('saunas.sortPriceDesc') },
            { value: 'capacity', label: t('saunas.sortCapacity') },
            { value: 'size', label: t('saunas.sortSize') },
          ]}
          required
        />
      </section>

      <div className="saunas-bar">
        <p className="mono" aria-live="polite">
          {catalog.isPending ? '—' : t('saunas.count', { count: visible.length })}
        </p>
        {filtered && (
          <Button variant="link" onClick={reset}>
            {t('saunas.reset')}
          </Button>
        )}
      </div>

      <SaunaGrid ref={grid}>
        {catalog.isPending
          ? Array.from({ length: 6 }, (_, i) => <SaunaCardSkeleton key={i} />)
          : visible.map((it, i) => <SaunaCard key={it.id} item={it} index={i} currency={currency} />)}
      </SaunaGrid>
      {!catalog.isPending && visible.length === 0 && (
        <EmptyState
          icon={SearchX}
          title={t('saunas.emptyTitle')}
          body={t('saunas.emptyBody')}
          action={
            <Button variant="ghost" onClick={reset}>
              {t('saunas.reset')}
            </Button>
          }
        />
      )}
    </div>
  );
}
