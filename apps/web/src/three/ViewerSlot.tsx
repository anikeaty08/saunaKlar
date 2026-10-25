import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Box, Maximize2, Minimize2, RotateCcw } from 'lucide-react';
import { useT } from '../i18n/i18n.ts';
import { prefersSaveData } from '../motion/preferences.ts';
import { useInView } from '../design/useInView.ts';
import { Button, IconButton } from '../design/components/Button.tsx';
import { LazyImage } from '../design/components/LazyImage.tsx';
import { ErrorBoundary } from '../design/components/ErrorBoundary.tsx';
import { invalidateAssetSession, useAssetSession } from '../api/assetSession.ts';
import { SaunaGlyph } from '../storefront/components/SaunaGlyph.tsx';
import type { ViewerOptions, ViewerSpecs } from './types.ts';
import './ViewerSlot.css';

/** three.js, R3F and drei live in this chunk and load only when a viewer is needed. */
const SaunaViewer = lazy(() => import('./SaunaViewer.tsx'));

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
  } catch {
    return false;
  }
}

interface Props {
  name: string;
  specs: ViewerSpecs;
  options: ViewerOptions;
  lowUrl: string | null;
  highUrl: string | null;
  /** On the share page: asks for FULL asset cookies with the token. */
  shareToken?: string;
  allowHigh: boolean;
  thumbnailUrl: string | null;
  /** Start loading without waiting for the slot to scroll into view. */
  eager?: boolean;
}

/**
 * The 3D stage as it appears in the page: a placeholder (thumbnail or line
 * drawing) sits behind the canvas, a progress bar follows the real loader
 * progress, and the 3D chunk is requested only when the slot is near the
 * viewport (or on demand with data saver).
 */
export function ViewerSlot({ name, specs, options, lowUrl, highUrl, allowHigh, thumbnailUrl, eager, shareToken }: Props) {
  const { t } = useT();
  const [ref, inView] = useInView<HTMLDivElement>('100px');
  const [requested, setRequested] = useState(false);
  const [webgl] = useState(() => (typeof window === 'undefined' ? false : webglAvailable()));
  const [progress, setProgress] = useState<{ p: number; active: boolean }>({ p: 0, active: false });
  const [ready, setReady] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const [full, setFull] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const saveData = prefersSaveData();
  const wanted = webgl && (requested || (Boolean(inView || eager) && !saveData));
  const hasGlb = Boolean(lowUrl ?? highUrl);
  // Signed asset cookies must be in place before the first GLB request.
  const assetsReady = useAssetSession(wanted && hasGlb, shareToken);
  const load = wanted && (!hasGlb || assetsReady);
  const retried = useRef(false);
  const onProgress = useCallback(
    (p: number, active: boolean) => {
      setProgress({ p, active });
      // The parametric model has nothing to download; a GLB is ready at 100 %.
      if (!active && (!hasGlb || p === 100)) setReady(true);
    },
    [hasGlb],
  );

  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const toggleFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stage.current?.requestFullscreen?.();
  };

  const placeholder = thumbnailUrl ? (
    <LazyImage src={thumbnailUrl} alt="" width={1200} height={960} priority />
  ) : (
    <SaunaGlyph form={specs.form} widthMm={specs.widthMm} depthMm={specs.depthMm} heightMm={specs.heightMm} className="vslot__glyph" title={name} />
  );

  return (
    <div ref={ref} className="vslot-wrap">
      <div ref={stage} className={['vslot', ready && 'is-ready', full && 'is-full'].filter(Boolean).join(' ')}>
        <div className="vslot__placeholder" aria-hidden={load ? true : undefined}>
          {placeholder}
        </div>
        {load && (
          <ErrorBoundary
            fallback={(_e, reset) => {
              // A 403 on a model usually means expired or missing asset cookies: re-issue once and retry.
              if (hasGlb && !retried.current) {
                retried.current = true;
                invalidateAssetSession();
                // drei caches the failed load per URL: clear it, then remount.
                void import('@react-three/drei').then(m => {
                  for (const u of [lowUrl, highUrl]) if (u) m.useGLTF.clear(u);
                  reset();
                });
                return null;
              }
              return <p className="vslot__note">{t('three.noWebgl')}</p>;
            }}
          >
            <Suspense fallback={null}>
              <div className="vslot__canvas">
                <SaunaViewer specs={specs} options={options} lowUrl={lowUrl} highUrl={highUrl} allowHigh={allowHigh} label={t('three.canvasLabel', { name })} onProgress={onProgress} resetKey={resetKey} />
              </div>
            </Suspense>
          </ErrorBoundary>
        )}
        {load && !ready && (
          <div className="vslot__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.p} aria-label={t('detail.loading3d', { progress: progress.p })}>
            <span className="vslot__bar" style={{ transform: `scaleX(${Math.max(0.04, progress.p / 100)})` }} />
            <span className="mono vslot__pct">{t('detail.loading3d', { progress: progress.p })}</span>
          </div>
        )}
        {!webgl && <p className="vslot__note">{t('three.noWebgl')}</p>}
        {webgl && !load && (
          <div className="vslot__cta">
            <Button variant="ghost" icon={Box} onClick={() => setRequested(true)}>
              {t('detail.load3d')}
            </Button>
            {saveData && <p className="vslot__note">{t('detail.saveDataHint')}</p>}
          </div>
        )}
        {load && (
          <div className="vslot__tools">
            <span className="vslot__hint mono">{t('detail.viewHint')}</span>
            <IconButton icon={RotateCcw} label={t('three.reset')} onClick={() => setResetKey(k => k + 1)} size="sm" />
            <IconButton icon={full ? Minimize2 : Maximize2} label={full ? t('three.exitFullscreen') : t('three.fullscreen')} onClick={toggleFull} size="sm" />
          </div>
        )}
      </div>
    </div>
  );
}
