import { useSyncExternalStore } from 'react';

const query = '(prefers-reduced-motion: reduce)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia?.(query);
  mq?.addEventListener('change', cb);
  return () => mq?.removeEventListener('change', cb);
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && Boolean(window.matchMedia?.(query).matches);
}

/** Re-renders when the OS setting changes. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}

interface NetworkInformation { saveData?: boolean; effectiveType?: string }

/** Data saver on, or a 2G-class connection: skip optional downloads (3D auto-load, high LOD). */
export function prefersSaveData(): boolean {
  if (typeof navigator === 'undefined') return false;
  const c = (navigator as Navigator & { connection?: NetworkInformation }).connection;
  return Boolean(c?.saveData) || /(^|-)2g$/.test(c?.effectiveType ?? '');
}
