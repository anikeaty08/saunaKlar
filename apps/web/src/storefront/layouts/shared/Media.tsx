import '../../components/SaunaCard.css';
import './sections.css';
import type { CatalogItem } from '../../../api/types.ts';
import { LazyImage, PHOTO_H, PHOTO_W, photoSource } from '../../../design/components/LazyImage.tsx';
import { SaunaGlyph } from '../../components/SaunaGlyph.tsx';
import { specsOf } from '../../components/specs.ts';

interface Props {
  item: CatalogItem | undefined;
  className?: string;
  /** Extra class for the line drawing shown when there is no photo. */
  glyphClassName?: string;
  strokeWidth?: number;
  /** Rendered width hint for the srcset, e.g. `(min-width: 900px) 50vw, 100vw`. */
  sizes?: string;
  /** The page's LCP image: eager, high fetch priority. */
  priority?: boolean;
  /**
   * Alt text. Defaults to the sauna's name, because the photo is the product picture;
   * pass `''` when the name is already the accessible name of a surrounding link.
   */
  alt?: string;
}

/** A sauna's photo, or its line drawing when it has none. Fills its (positioned) parent. */
export function Media({ item, className, glyphClassName, strokeWidth = 0.7, sizes = '100vw', priority, alt }: Props) {
  const cls = ['lmedia', className].filter(Boolean).join(' ');
  if (!item) return <div className={cls} />;
  const s = specsOf(item);
  return (
    <div className={cls}>
      {item.assets.thumbnailUrl ? (
        <LazyImage {...photoSource(item.assets.thumbnailUrl)} alt={alt ?? item.name} width={PHOTO_W} height={PHOTO_H} sizes={sizes} priority={priority} />
      ) : (
        <SaunaGlyph form={s.form} widthMm={s.widthMm} depthMm={s.depthMm} heightMm={s.heightMm} className={['lmedia__glyph', glyphClassName].filter(Boolean).join(' ')} strokeWidth={strokeWidth} />
      )}
    </div>
  );
}
