import type { ComponentType } from 'react';
import type { Session, Tenant } from '../../api/types.ts';
import type { ThemeFlavour } from '../../design/theme.ts';

export const LAYOUT_IDS = ['atelier', 'showroom', 'nordic', 'catalogue', 'journal'] as const;
export type LayoutId = (typeof LAYOUT_IDS)[number];
export const isLayoutId = (v: unknown): v is LayoutId => typeof v === 'string' && (LAYOUT_IDS as readonly string[]).includes(v);

export interface LayoutModule {
  Home: ComponentType;
}

/**
 * Each layout is its own lazy chunk (home page plus its CSS, which also
 * restyles the shared header and cards under `html[data-layout=…]`).
 */
export const LAYOUT_LOADERS: Record<LayoutId, () => Promise<LayoutModule>> = {
  atelier: () => import('./atelier/index.ts'),
  showroom: () => import('./showroom/index.ts'),
  nordic: () => import('./nordic/index.ts'),
  catalogue: () => import('./catalogue/index.ts'),
  journal: () => import('./journal/index.ts'),
};

interface LayoutMeta {
  flavour: ThemeFlavour;
  /** Extra Google Fonts family for the layout's type pairing, loaded on demand. */
  font?: string;
}

export const LAYOUT_META: Record<LayoutId, LayoutMeta> = {
  atelier: { flavour: 'default' },
  showroom: { flavour: 'dark' },
  nordic: { flavour: 'warm', font: 'Fraunces:opsz,wght@9..144,300..600' },
  catalogue: { flavour: 'default' },
  journal: { flavour: 'default', font: 'Instrument+Serif:ital@0;1' },
};

const KEY = 'sk.layoutPreview';

/** `?layout=` preview override: honoured in development and mock mode, or for a signed-in staff member. */
export function previewLayout(session: Session | undefined): LayoutId | null {
  const allowed = import.meta.env.DEV || import.meta.env.VITE_MOCK_API === '1' || session?.kind === 'staff';
  if (!allowed) return null;
  const q = new URLSearchParams(window.location.search).get('layout');
  try {
    if (q === 'off') sessionStorage.removeItem(KEY);
    else if (isLayoutId(q)) sessionStorage.setItem(KEY, q);
    const v = sessionStorage.getItem(KEY);
    return isLayoutId(v) ? v : null;
  } catch {
    return isLayoutId(q) ? q : null;
  }
}

export function resolveLayout(tenant: Tenant, session: Session | undefined): LayoutId {
  const own = tenant.branding.storefrontLayout;
  return previewLayout(session) ?? (isLayoutId(own) ? own : 'atelier');
}

const loadedFonts = new Set<string>();
export function loadLayoutFont(id: LayoutId) {
  const family = LAYOUT_META[id].font;
  if (!family || loadedFonts.has(family)) return;
  loadedFonts.add(family);
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
  document.head.appendChild(link);
}
