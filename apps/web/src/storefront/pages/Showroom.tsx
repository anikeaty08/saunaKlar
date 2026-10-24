import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useCatalog } from '../../api/queries.ts';
import { useT, type TKey } from '../../i18n/i18n.ts';
import { useFlipLayout } from '../../motion/useFlipLayout.ts';
import { Segmented } from '../../design/components/Segmented.tsx';
import { Skeleton } from '../../design/components/Skeleton.tsx';
import { useDocumentTitle } from '../../app/useDocumentTitle.ts';
import { PageHero } from '../components/PageHero.tsx';
import { SaunaGlyph } from '../components/SaunaGlyph.tsx';
import { specsOf } from '../components/specs.ts';
import { prefetchPath } from '../../app/prefetch.ts';
import './Content.css';

type Filter = 'all' | 'indoor' | 'outdoor' | 'compact' | 'family';
type Setting = 'bathroom' | 'basement' | 'garden' | 'lake' | 'cabin';

export default function Showroom() {
  const { t } = useT();
  const catalog = useCatalog();
  const [filter, setFilter] = useState<Filter>('all');
  const grid = useRef<HTMLUListElement>(null);
  useDocumentTitle(t('showroom.title'));

  const tiles = useMemo(() => {
    const out: { id: string; slug: string; name: string; setting: Setting; specs: ReturnType<typeof specsOf> }[] = [];
    for (const it of catalog.data?.items ?? []) {
      const s = specsOf(it);
      const settings: Setting[] = [...(s.indoor ? (['bathroom', 'basement'] as const) : []), ...(s.outdoor ? (['garden', 'lake', 'cabin'] as const) : [])].slice(0, 2);
      for (const setting of settings) out.push({ id: `${it.id}-${setting}`, slug: it.slug, name: it.name, setting, specs: s });
    }
    return out;
  }, [catalog.data]);

  const visible = tiles.filter(x => {
    if (filter === 'indoor') return x.setting === 'bathroom' || x.setting === 'basement';
    if (filter === 'outdoor') return x.setting === 'garden' || x.setting === 'lake' || x.setting === 'cabin';
    if (filter === 'compact') return x.specs.footprintM2 <= 2.6;
    if (filter === 'family') return x.specs.persons >= 6;
    return true;
  });
  const { capture } = useFlipLayout(grid, [filter]);

  return (
    <div className="page container">
      <PageHero eyebrow={t('showroom.eyebrow')} title={t('showroom.title')} lede={t('showroom.lede')} />
      <div className="showroom-bar">
        <Segmented
          label={t('saunas.filters')}
          hideLabel
          value={filter}
          onChange={v => {
            capture();
            setFilter(v);
          }}
          options={(['all', 'indoor', 'outdoor', 'compact', 'family'] as const).map(v => ({ value: v, label: t(`showroom.${v}` as TKey) }))}
        />
      </div>
      <ul ref={grid} className="showroom">
        {catalog.isPending
          ? Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="showroom__tile">
                <Skeleton height="100%" />
              </li>
            ))
          : visible.map((x, i) => (
              <li key={x.id} data-flip-id={x.id} className={`showroom__tile showroom__tile--${x.setting} ${i % 5 === 0 ? 'is-wide' : ''}`}>
                <Link to={`/saunas/${x.slug}`} onPointerEnter={() => prefetchPath(`/saunas/${x.slug}`)} aria-label={t('showroom.open', { name: x.name })}>
                  <span className="showroom__ground" aria-hidden="true" />
                  <SaunaGlyph form={x.specs.form} widthMm={x.specs.widthMm} depthMm={x.specs.depthMm} heightMm={x.specs.heightMm} className="showroom__glyph" />
                  <span className="showroom__cap">
                    <span className="showroom__name">{x.name}</span>
                    <span className="mono showroom__setting">{t(`showroom.settings.${x.setting}` as TKey)}</span>
                  </span>
                </Link>
              </li>
            ))}
      </ul>
    </div>
  );
}
