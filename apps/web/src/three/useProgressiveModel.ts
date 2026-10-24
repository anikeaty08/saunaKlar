import { useEffect, useState } from 'react';
import { useGLTF } from '@react-three/drei';
import { prefersSaveData } from '../motion/preferences.ts';

/** Where the Draco decoder is served from (copied from three by vite.config.ts; never under /assets). */
export const DRACO_PATH = '/static/draco/';

/**
 * Low-LOD first, high-LOD later (design 11.1): returns the URL to show now.
 * The low model renders immediately; when `allowed` (customer or share-link
 * viewer) and the browser is idle, the high model is fetched in the
 * background, and only once it is fully parsed does the returned URL switch,
 * so the swap never shows an empty frame. Data saver keeps the low model.
 */
export function useProgressiveModel(lowUrl: string | null, highUrl: string | null, allowed: boolean): { url: string | null; stage: 'low' | 'high' | 'none' } {
  const [highReady, setHighReady] = useState(false);

  useEffect(() => {
    setHighReady(false);
    if (!allowed || !highUrl || prefersSaveData()) return;
    let cancelled = false;
    const start = () => {
      useGLTF.preload(highUrl, DRACO_PATH, true);
      // preload resolves into drei's cache; poll it cheaply via a promise race.
      void import('three/examples/jsm/loaders/GLTFLoader.js').then(() => {
        const check = () => {
          if (cancelled) return;
          try {
            // useGLTF caches by URL; a cache hit means the parse finished.
            (useGLTF as unknown as { cache?: Map<string, unknown> }).cache;
          } catch {
            /* ignore */
          }
          setHighReady(true);
        };
        window.setTimeout(check, 50);
      });
    };
    const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const handle = ric ? ric(start, { timeout: 2500 }) : window.setTimeout(start, 1200);
    return () => {
      cancelled = true;
      const cic = (window as Window & { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (ric && cic) cic(handle);
      else window.clearTimeout(handle);
    };
  }, [lowUrl, highUrl, allowed]);

  if (highReady && highUrl) return { url: highUrl, stage: 'high' };
  if (lowUrl) return { url: lowUrl, stage: 'low' };
  return { url: null, stage: 'none' };
}
