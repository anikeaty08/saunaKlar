import { useState, type CSSProperties } from 'react';
import { ImageOff } from 'lucide-react';
import { Icon } from './Icon.tsx';
import './LazyImage.css';

export interface ImageSource {
  /** The image URL. With `widths`, its resized variants sit next to it (see below). */
  src: string;
  /**
   * Widths available as `<name>-<w>.webp` beside `<name>.<ext>`, plus `<name>-<largest>.jpg`
   * as the fallback for browsers without WebP. When omitted, `src` is used as is.
   */
  widths?: number[];
}

interface Props extends ImageSource {
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  /** Above the fold (LCP): eager + high fetch priority. */
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Variant widths produced for the catalogue photos (`<name>-480.webp` … `<name>-1200.jpg`). */
export const PHOTO_WIDTHS = [480, 800, 1200];

/** Our own catalogue photos come with resized variants; other URLs (uploads, CDNs) are used as is. */
export function photoSource(url: string): ImageSource {
  return /^\/catalogue\/[^?#]+\.(jpe?g|png)$/i.test(url) ? { src: url, widths: PHOTO_WIDTHS } : { src: url };
}

/** Sauna photographs are rendered at 3:2; cards and grids use that ratio so nothing is cropped twice. */
export const PHOTO_W = 1200;
export const PHOTO_H = 800;

const stem = (src: string) => src.replace(/\.[a-z0-9]+$/i, '');
const set = (base: string, widths: number[], ext: string) => widths.map(w => `${base}-${w}.${ext} ${w}w`).join(', ');

/**
 * WebP with srcset (JPEG fallback), lazy by default, async decoding, intrinsic
 * size (no layout shift) and a shimmer placeholder that fades out on load. If the
 * variants are missing it retries the original once; if that fails too it shows a
 * quiet placeholder with the alt text instead of an empty box.
 */
export function LazyImage({ src, widths, alt, width, height, sizes = '100vw', priority, className, style }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [plain, setPlain] = useState(false);
  const variants = widths && widths.length > 0 && !plain ? widths : null;
  const base = stem(src);
  const img = (
    <img
      src={variants ? `${base}-${variants[variants.length - 1]}.jpg` : src}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding={priority ? 'sync' : 'async'}
      fetchPriority={priority ? 'high' : 'auto'}
      onLoad={() => setLoaded(true)}
      onError={() => (variants ? setPlain(true) : setFailed(true))}
      className="lazy-img__img"
    />
  );
  return (
    <span className={['lazy-img', loaded && 'is-loaded', failed && 'is-failed', className].filter(Boolean).join(' ')} style={{ aspectRatio: `${width} / ${height}`, ...style }}>
      {variants ? (
        <picture>
          <source type="image/webp" srcSet={set(base, variants, 'webp')} sizes={sizes} />
          {img}
        </picture>
      ) : (
        img
      )}
      {failed && (
        <span className="lazy-img__fallback" aria-hidden={alt ? undefined : true}>
          <Icon icon={ImageOff} size="md" />
          {alt && <span className="lazy-img__alt">{alt}</span>}
        </span>
      )}
    </span>
  );
}
