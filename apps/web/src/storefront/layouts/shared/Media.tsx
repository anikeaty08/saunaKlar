import '../../components/SaunaCard.css';
import './sections.css';
import type { CatalogItem } from '../../../api/types.ts';
import { LazyImage } from '../../../design/components/LazyImage.tsx';
import { SaunaGlyph } from '../../components/SaunaGlyph.tsx';
import { specsOf } from '../../components/specs.ts';

/** A sauna's photo, or its line drawing when it has none. Fills its (positioned) parent. */
export function Media({ item, className, strokeWidth = 0.7 }: { item: CatalogItem | undefined; className?: string; strokeWidth?: number }) {
  if (!item) return <div className={['lmedia', className].filter(Boolean).join(' ')} />;
  const s = specsOf(item);
  return (
    <div className={['lmedia', className].filter(Boolean).join(' ')}>
      {item.assets.thumbnailUrl ? (
        <LazyImage src={item.assets.thumbnailUrl} alt="" width={1600} height={1200} />
      ) : (
        <SaunaGlyph form={s.form} widthMm={s.widthMm} depthMm={s.depthMm} heightMm={s.heightMm} className="lmedia__glyph" strokeWidth={strokeWidth} />
      )}
    </div>
  );
}
