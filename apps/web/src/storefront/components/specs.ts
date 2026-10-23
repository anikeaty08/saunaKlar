import type { Attribute, CatalogItem } from '../../api/types.ts';
import type { SaunaForm } from './SaunaGlyph.tsx';

const num = (attrs: Attribute[], code: string, fallback = 0): number => {
  const v = attrs.find(a => a.code === code)?.value;
  return typeof v === 'number' ? v : fallback;
};
const text = (attrs: Attribute[], code: string): string | null => {
  const v = attrs.find(a => a.code === code)?.value;
  return typeof v === 'string' ? v : null;
};

const FORMS: SaunaForm[] = ['box', 'panorama', 'corner', 'barrel', 'hex', 'cabin'];

/** Typed view of the attributes the storefront uses for filters, drawings and 3D. */
export function specsOf(item: Pick<CatalogItem, 'attributes'>) {
  const a = item.attributes;
  const form = text(a, 'form');
  const placement = text(a, 'placement') ?? '';
  return {
    persons: num(a, 'capacity_persons', 2),
    widthMm: num(a, 'width_mm', 1800),
    depthMm: num(a, 'depth_mm', 1800),
    heightMm: num(a, 'height_mm', 2100),
    heaterKw: num(a, 'heater_kw'),
    form: (FORMS as string[]).includes(form ?? '') ? (form as SaunaForm) : 'box',
    indoor: /indoor/i.test(placement),
    outdoor: /outdoor/i.test(placement),
    footprintM2: (num(a, 'width_mm', 1800) * num(a, 'depth_mm', 1800)) / 1e6,
  };
}

export type Specs = ReturnType<typeof specsOf>;
