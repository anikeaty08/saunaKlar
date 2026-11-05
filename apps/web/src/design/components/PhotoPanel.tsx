import { LazyImage, PHOTO_H, PHOTO_W, photoSource } from './LazyImage.tsx';
import './PhotoPanel.css';

export interface PanelShot {
  /** Catalogue photo URL (its -480/-800/-1200 variants are picked up by photoSource). */
  src: string;
  alt: string;
  /** Short caption shown with this shot (e.g. "Kelo Barrel · Inside"). */
  caption?: string;
  /** object-position for the cover crop; the renders sit slightly below centre. */
  position?: string;
}

/**
 * Full-bleed photo backdrop for sign-in panels: one or two rendered photos
 * (typically outside and inside of one model) that slowly crossfade, a scrim
 * top and bottom so text on it keeps its contrast, and a caption per shot that
 * fades with its photo. Lazy, with intrinsic 3:2 size; cropped by cover only.
 * Reduced motion: the first shot stays, no crossfade.
 */
export function PhotoPanel({ shots, sizes = '50vw', className }: { shots: PanelShot[]; sizes?: string; className?: string }) {
  const list = shots.slice(0, 2);
  if (list.length === 0) return null;
  return (
    <div className={['photo-panel', list.length > 1 && 'photo-panel--fade', className].filter(Boolean).join(' ')}>
      {list.map(s => (
        <figure key={s.src} className="photo-panel__shot" style={s.position ? ({ '--photo-pos': s.position } as React.CSSProperties) : undefined}>
          <LazyImage {...photoSource(s.src)} alt={s.alt} width={PHOTO_W} height={PHOTO_H} sizes={sizes} className="photo-panel__img" />
          {s.caption && (
            <figcaption className="photo-panel__cap">
              <span className="photo-panel__dot" aria-hidden="true" />
              {s.caption}
            </figcaption>
          )}
        </figure>
      ))}
      <span className="photo-panel__scrim" aria-hidden="true" />
    </div>
  );
}
