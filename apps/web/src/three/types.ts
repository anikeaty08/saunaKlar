import type { SaunaForm } from '../storefront/components/SaunaGlyph.tsx';

/** What the parametric model needs from the selected options. */
export interface ViewerOptions {
  woodColor: string;
  door: 'clear' | 'bronze' | 'satin' | 'timber';
  backrestLight: boolean;
  benchLight: boolean;
  starCeiling: boolean;
  woodStove: boolean;
}

export interface ViewerSpecs {
  form: SaunaForm;
  widthMm: number;
  depthMm: number;
  heightMm: number;
}

/** Room placement as stored with a configuration (millimetres, degrees). */
export interface PlacementValue {
  positionXMm: number;
  positionZMm: number;
  rotationDeg: number;
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = {
  woodColor: '#dcc39b',
  door: 'clear',
  backrestLight: true,
  benchLight: false,
  starCeiling: false,
  woodStove: false,
};
