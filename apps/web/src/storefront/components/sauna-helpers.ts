import { defaultSelection, type ModelRules } from '@saunaklar/rules';
import type { SaunaDetail } from '../../api/types.ts';
import type { ViewerOptions } from '../../three/types.ts';
import { kitOptionsOf } from '../../three/kit/spec.ts';

export function rulesOf(s: Pick<SaunaDetail, 'groups' | 'rules'>): ModelRules {
  return {
    groups: s.groups.map(g => ({ id: g.id, code: g.code, selectionType: g.selectionType, required: g.required, options: g.options.map(o => ({ id: o.id, code: o.code, isDefault: o.isDefault })) })),
    requires: s.rules.requires,
    excludes: s.rules.excludes,
  };
}

export function defaultSelectionOf(s: Pick<SaunaDetail, 'groups' | 'rules'>): string[] {
  return defaultSelection(rulesOf(s));
}

/**
 * Maps selected options onto the construction kit (wood, door, heater, bench
 * styles, backrests, lights, extras) by option code; see three/kit/spec.ts for
 * the codes it understands. Unknown codes are ignored, so any catalogue renders.
 */
export function viewerOptionsOf(s: Pick<SaunaDetail, 'groups' | 'attributes'>, selection: readonly string[]): ViewerOptions {
  const levels = s.attributes.find(a => a.code === 'bench_levels')?.value;
  return kitOptionsOf(s.groups, selection, typeof levels === 'number' && levels < 2 ? 1 : 2);
}
