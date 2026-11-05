import type { Attribute, CatalogItem, SaunaDetail } from '../../api/types.ts';
import type { SaunaForm } from './SaunaGlyph.tsx';

const num = (attrs: Attribute[], code: string, fallback = 0): number => {
  const v = attrs.find(a => a.code === code)?.value;
  return typeof v === 'number' ? v : fallback;
};
const text = (attrs: Attribute[], code: string): string | null => {
  const v = attrs.find(a => a.code === code)?.value;
  return typeof v === 'string' ? v : null;
};

const FORMS: SaunaForm[] = ['box', 'panorama', 'corner', 'glass-corner', 'barrel', 'hex', 'cabin'];

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
    source: text(a, 'model_source') === 'asset' ? ('asset' as const) : text(a, 'model_source') === 'reference' ? ('reference' as const) : ('kit' as const),
    benchLevels: num(a, 'bench_levels', 2) >= 2 ? (2 as const) : (1 as const),
    indoor: /indoor/i.test(placement),
    outdoor: /outdoor/i.test(placement),
    footprintM2: (num(a, 'width_mm', 1800) * num(a, 'depth_mm', 1800)) / 1e6,
  };
}

export type Specs = ReturnType<typeof specsOf>;

/** Resolve server-priced dimension options into the same dimensions shown by the viewer. */
export function configuredSpecsOf(item: Pick<SaunaDetail, 'attributes' | 'groups'>, selection: readonly string[]): Specs {
  const specs = specsOf(item);
  const selected = new Set(selection);
  for (const group of item.groups) {
    const dimension = /^(?:size-)?(width|depth|height)$/.exec(group.code)?.[1];
    if (!dimension) continue;
    const option = group.options.find(o => selected.has(o.id));
    const match = option && new RegExp(`^(?:size-)?${dimension}-(\\d{4})$`).exec(option.code);
    if (!match) continue;
    const mm = Number(match[1]);
    if (mm < 1000 || mm > 9999) continue;
    if (dimension === 'width') specs.widthMm = mm;
    if (dimension === 'depth') specs.depthMm = mm;
    if (dimension === 'height') specs.heightMm = mm;
  }
  specs.footprintM2 = specs.widthMm * specs.depthMm / 1e6;
  return specs;
}
