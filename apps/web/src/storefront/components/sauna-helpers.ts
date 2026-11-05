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

/** What the configurator store holds, as far as deciding whether to re-initialise it. */
export interface DraftState {
  slug: string | null;
  configurationId: string | null;
  dirty: boolean;
}

/**
 * How the configurator page should (re)initialise the store:
 * `load` the saved configuration from the URL, start from the model's
 * `defaults`, or keep what the store holds (`null`).
 *
 * Without an `id` the page edits a new, unsaved draft, so a store still bound
 * to a saved configuration (opened earlier with `?id=`) must be reset, or Save
 * would write to that configuration. With an `id`, the loaded data replaces
 * the store unless it is the same configuration with unsaved edits (a refetch
 * must not wipe them).
 */
export function initStep(slug: string, idParam: string | null, loadedId: string | null, store: DraftState): 'load' | 'defaults' | null {
  if (idParam) {
    if (!loadedId || loadedId !== idParam) return null;
    return store.configurationId !== loadedId || !store.dirty ? 'load' : null;
  }
  return store.slug !== slug || store.configurationId !== null ? 'defaults' : null;
}

/**
 * Runs `fn` one call at a time: a call made while another is in flight starts
 * when that one settles. Used so Save and Send never create two configurations.
 */
export function oneAtATime<T>(fn: () => Promise<T>): () => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return () => {
    const run = last.then(fn, fn);
    last = run.catch(() => undefined);
    return run;
  };
}

/**
 * The option group a `?step=<groupCode>` deep link (from the detail page's "Customise"
 * links) asks the configurator to open on, or null when the code names no group of this model.
 */
export function stepGroupCode(step: string | null, groups: readonly { code: string }[]): string | null {
  return step && groups.some(g => g.code === step) ? step : null;
}
