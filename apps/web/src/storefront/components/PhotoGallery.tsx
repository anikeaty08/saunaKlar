import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import { useT } from '../../i18n/i18n.ts';
import { IconButton } from '../../design/components/Button.tsx';
import { Dialog } from '../../design/components/Dialog.tsx';
import { Icon } from '../../design/components/Icon.tsx';
import { LazyImage, PHOTO_H, PHOTO_W, photoSource } from '../../design/components/LazyImage.tsx';
import { swipeStep, wrapIndex } from './product-preview.ts';
import './PhotoGallery.css';

export interface GalleryPhoto {
  url: string;
  /** What the photo shows ("Outside"), used in the alt text and caption. */
  view: string;
}

interface Props {
  /** Product name, for the alt texts and the lightbox title. */
  name: string;
  photos: GalleryPhoto[];
  /** Rendered over the main image's corner (e.g. a "3D" badge). */
  overlay?: ReactNode;
  /** Rendered width of the main image, for srcset. */
  sizes?: string;
}

/**
 * Product photo gallery: a large 3:2 main image with previous/next arrows and dots, a
 * thumbnail strip, arrow keys and swipe, and a lightbox on click. The first photo loads
 * eagerly (it is the page's largest image); the others only when shown.
 */
export function PhotoGallery({ name, photos, overlay, sizes = '(min-width: 960px) 58vw, 100vw' }: Props) {
  const { t } = useT();
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const count = photos.length;
  const go = useCallback((step: number) => setIndex(i => wrapIndex(i + step, count)), [count]);
  const close = useCallback(() => setOpen(false), []);
  if (count === 0) return null;
  const current = photos[wrapIndex(index, count)]!;
  const alt = (p: GalleryPhoto) => t('detail.photoAlt', { name, view: p.view });
  const many = count > 1;

  const onKey = (e: KeyboardEvent) => {
    if (!many) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else return;
    e.preventDefault();
  };
  const onDown = (e: PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    if (!s || !many) return;
    const step = swipeStep(e.clientX - s.x, e.clientY - s.y);
    if (step !== 0) {
      swiped.current = true;
      go(step);
    }
  };

  return (
    <div className="pgal" role="group" aria-roledescription={t('detail.gallery')} aria-label={t('detail.galleryOf', { name })} onKeyDown={onKey}>
      <div className="pgal__stage" onPointerDown={onDown} onPointerUp={onUp} onPointerCancel={() => (start.current = null)}>
        <button
          type="button"
          className="pgal__main"
          onClick={() => {
            if (!swiped.current) setOpen(true);
          }}
          aria-label={t('detail.enlargePhoto', { view: current.view })}
        >
          <LazyImage key={current.url} {...photoSource(current.url)} alt={alt(current)} width={PHOTO_W} height={PHOTO_H} sizes={sizes} priority={index === 0} />
          <span className="pgal__zoom" aria-hidden="true">
            <Icon icon={Expand} size="sm" />
          </span>
        </button>
        {overlay && <div className="pgal__overlay">{overlay}</div>}
        {many && (
          <>
            <IconButton icon={ChevronLeft} label={t('detail.prevPhoto')} onClick={() => go(-1)} className="pgal__arrow pgal__arrow--prev" />
            <IconButton icon={ChevronRight} label={t('detail.nextPhoto')} onClick={() => go(1)} className="pgal__arrow pgal__arrow--next" />
            <div className="pgal__dots" aria-hidden="true">
              {photos.map((p, i) => (
                <span key={p.url} className={i === index ? 'is-on' : undefined} />
              ))}
            </div>
          </>
        )}
        <p className="pgal__count mono" aria-live="polite">
          {current.view}
          {many && ` · ${t('detail.photoCount', { n: index + 1, total: count })}`}
        </p>
      </div>
      {many && (
        <ul className="pgal__thumbs">
          {photos.map((p, i) => (
            <li key={p.url}>
              <button type="button" className={['pgal__thumb', i === index && 'is-on'].filter(Boolean).join(' ')} aria-current={i === index || undefined} aria-label={t('detail.showPhoto', { view: p.view, n: i + 1, total: count })} onClick={() => setIndex(i)}>
                <LazyImage {...photoSource(p.url)} alt="" width={PHOTO_W} height={PHOTO_H} sizes="120px" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={open} onClose={close} title={name} description={many ? `${current.view} · ${t('detail.photoCount', { n: index + 1, total: count })}` : current.view} size="lg">
        {/* Arrow keys bubble up to the gallery's handler (the dialog sits inside it). */}
        <div className="pgal__lightbox" onPointerDown={onDown} onPointerUp={onUp}>
          <LazyImage key={current.url} {...photoSource(current.url)} alt={alt(current)} width={PHOTO_W} height={PHOTO_H} sizes="(min-width: 900px) 52rem, 100vw" />
          {many && (
            <div className="pgal__lbnav">
              <IconButton icon={ChevronLeft} label={t('detail.prevPhoto')} onClick={() => go(-1)} variant="ghost" />
              <IconButton icon={ChevronRight} label={t('detail.nextPhoto')} onClick={() => go(1)} variant="ghost" />
            </div>
          )}
        </div>
      </Dialog>
    </div>
  );
}
