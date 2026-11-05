/**
 * Warms the 3D viewer chunk (three/drei/fiber + the viewer) without blocking
 * anything. Call from a card's onPointerEnter/onFocus or `preloadViewerWhenIdle()`.
 */
let started = false;

export function preloadViewer(): void {
  if (started) return;
  started = true;
  void Promise.all([import('./SaunaViewer.tsx'), import('./kit/assets.ts').then(m => m.preloadKitAssets())]).catch(() => {
    started = false;
  });
}

export function preloadViewerWhenIdle(): void {
  if (typeof window === 'undefined') return;
  const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }).requestIdleCallback;
  if (ric) ric(preloadViewer, { timeout: 4000 });
  else setTimeout(preloadViewer, 2000);
}
