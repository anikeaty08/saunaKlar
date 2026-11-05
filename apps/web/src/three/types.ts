import type { SaunaForm } from '../storefront/components/SaunaGlyph.tsx';
import { DEFAULT_KIT_OPTIONS, type KitOptions } from './kit/spec.ts';

/** What the 3D sauna needs from the selected options (see kit/spec.ts). */
export type ViewerOptions = KitOptions;

export interface ViewerSpecs {
  form: SaunaForm;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  /**
   * `kit` (default): built by the construction kit from form, size and options.
   * `asset`: show the model's uploaded GLB instead (a fixed model that ignores options).
   * `reference`: rebuild the measured six-sided construction for selected sizes.
   */
  source?: 'kit' | 'asset' | 'reference';
}

/** Room placement as stored with a configuration (millimetres, degrees). */
export interface PlacementValue {
  positionXMm: number;
  positionZMm: number;
  rotationDeg: number;
}

export const DEFAULT_VIEWER_OPTIONS: ViewerOptions = DEFAULT_KIT_OPTIONS;
