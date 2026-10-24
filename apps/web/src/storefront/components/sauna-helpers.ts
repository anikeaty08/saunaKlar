import { defaultSelection, type ModelRules } from '@saunaklar/rules';
import type { SaunaDetail } from '../../api/types.ts';
import type { ViewerOptions } from '../../three/types.ts';

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
 * Maps selected options onto the parametric model's inputs by group/option
 * code (wood colour from the swatch, door type, lighting). Unknown codes are
 * ignored, so a catalogue with other options still renders.
 */
export function viewerOptionsOf(s: Pick<SaunaDetail, 'groups'>, selection: readonly string[]): ViewerOptions {
  const sel = new Set(selection);
  const chosen = (code: string) => s.groups.find(g => g.code === code)?.options.filter(o => sel.has(o.id)) ?? [];
  const wood = chosen('wood')[0];
  const door = chosen('door')[0]?.code ?? 'clear';
  const lights = chosen('lighting').map(o => o.code);
  const heater = chosen('heater')[0]?.code ?? 'electric-6';
  return {
    woodColor: wood?.swatchColor ?? '#d9b98a',
    door: door === 'timber' ? 'timber' : door === 'bronze' ? 'bronze' : door === 'satin' ? 'satin' : 'clear',
    backrestLight: lights.includes('backrest-led'),
    benchLight: lights.includes('bench-led'),
    starCeiling: lights.includes('starlight'),
    woodStove: heater === 'wood-stove',
  };
}
