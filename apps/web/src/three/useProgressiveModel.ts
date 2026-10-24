import { useEffect, useState } from 'react';
import { prefersSaveData } from '../motion/preferences.ts';

/** Where the Draco decoder is served from (copied from three by vite.config.ts; never under /assets). */
export const DRACO_PATH = '/static/draco/';

export interface ProgressiveModel {
  /** Shown immediately. */
  lowUrl: string | null;
  /** Set once the high model should start streaming; null while it should not. */
  highUrl: string | null;
}

/**
 * Low-LOD first, high-LOD later (design 11.1). The low model is shown at
 * once; when `allowed` (customer or share-link viewer) and the browser is
 * idle, `highUrl` is released so `<ProgressiveGlb>` starts loading it inside
 * a Suspense boundary whose fallback is the low model — the swap happens only
 * after the high model has fully parsed, and the low one is then unmounted
 * and disposed. Data saver keeps the low model.
 */
export function useProgressiveModel(lowUrl: string | null, highUrl: string | null, allowed: boolean): ProgressiveModel {
  const [release, setRelease] = useState(false);

  useEffect(() => {
    setRelease(false);
    if (!allowed || !highUrl || prefersSaveData()) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => setRelease(true), { timeout: 2500 });
      return () => w.cancelIdleCallback?.(h);
    }
    const h = window.setTimeout(() => setRelease(true), 1200);
    return () => window.clearTimeout(h);
  }, [lowUrl, highUrl, allowed]);

  return { lowUrl: lowUrl ?? highUrl, highUrl: release && lowUrl ? highUrl : null };
}
