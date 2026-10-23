import { useState, type CSSProperties } from 'react';
import './LazyImage.css';

export interface ImageSource {
  /** Base URL without extension variants, e.g. an API-provided thumbnail URL. */
  src: string;
  /** Widths available as `${src}-${w}.avif|webp|jpg`. When omitted, `src` is used as is. */
  widths?: number[];
}

interface Props extends ImageSource {
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  /** Above the fold: eager + high fetch priority. */
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}

const set = (src: string, widths: number[], ext: string) => widths.map(w => `${src}-${w}.${ext} ${w}w`).join(', ');

/**
 * AVIF → WebP → JPEG with srcset, lazy by default, async decoding, intrinsic
 * size (no layout shift) and a shimmer placeholder that fades out on load.
 */
export function LazyImage({ src, widths, alt, width, height, sizes = '100vw', priority, className, style }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const img = (
    <img
      src={widths ? `${src}-${widths[widths.length - 1]}.jpg` : src}
      srcSet={widths ? set(src, widths, 'jpg') : undefined}
      sizes={widths ? sizes : undefined}
      alt={alt}
      width={width}
      height={height}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      className="lazy-img__img"
    />
  );
  return (
    <span className={['lazy-img', loaded && 'is-loaded', failed && 'is-failed', className].filter(Boolean).join(' ')} style={{ aspectRatio: `${width} / ${height}`, ...style }}>
      {widths ? (
        <picture>
          <source type="image/avif" srcSet={set(src, widths, 'avif')} sizes={sizes} />
          <source type="image/webp" srcSet={set(src, widths, 'webp')} sizes={sizes} />
          {img}
        </picture>
      ) : (
        img
      )}
    </span>
  );
}
