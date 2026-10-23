/**
 * Option rules for one sauna model (design 7.4/7.5): which groups a model
 * exposes, whether a group takes one option (SINGLE) or several (MULTI),
 * whether it is required, and the requires/excludes rules between options.
 *
 * `validate` is the authority used before a configuration is locked; the
 * database repeats the structural checks. `toggle` is the interactive helper
 * the configurator uses so a customer can never reach an invalid state by
 * clicking: it pulls in required options and drops conflicting ones.
 */

export type SelectionType = 'SINGLE' | 'MULTI';

export interface RuleOption {
  id: string;
  code: string;
  isDefault: boolean;
}

export interface RuleGroup {
  id: string;
  code: string;
  selectionType: SelectionType;
  required: boolean;
  options: RuleOption[];
}

export interface ModelRules {
  groups: RuleGroup[];
  /** `optionId` can only be chosen together with `requiredOptionId`. */
  requires: { optionId: string; requiredOptionId: string }[];
  /** The two options can never be chosen together. */
  excludes: { optionAId: string; optionBId: string }[];
}

export type IssueCode =
  | 'UNKNOWN_OPTION'
  | 'DUPLICATE_OPTION'
  | 'SINGLE_GROUP_MULTIPLE'
  | 'REQUIRED_GROUP_EMPTY'
  | 'REQUIRES_MISSING'
  | 'EXCLUDED_PAIR';

export interface Issue {
  code: IssueCode;
  message: string;
  optionIds: string[];
  groupId?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: Issue[];
}

interface Index {
  optionGroup: Map<string, RuleGroup>;
  option: Map<string, RuleOption>;
  requires: Map<string, string[]>;
  requiredBy: Map<string, string[]>;
  excludes: Map<string, string[]>;
}

const cache = new WeakMap<ModelRules, Index>();

function index(rules: ModelRules): Index {
  const hit = cache.get(rules);
  if (hit) return hit;
  const idx: Index = { optionGroup: new Map(), option: new Map(), requires: new Map(), requiredBy: new Map(), excludes: new Map() };
  for (const g of rules.groups) for (const o of g.options) {
    idx.optionGroup.set(o.id, g);
    idx.option.set(o.id, o);
  }
  const push = (m: Map<string, string[]>, k: string, v: string) => m.set(k, [...(m.get(k) ?? []), v]);
  for (const r of rules.requires) {
    push(idx.requires, r.optionId, r.requiredOptionId);
    push(idx.requiredBy, r.requiredOptionId, r.optionId);
  }
  for (const x of rules.excludes) {
    push(idx.excludes, x.optionAId, x.optionBId);
    push(idx.excludes, x.optionBId, x.optionAId);
  }
  cache.set(rules, idx);
  return idx;
}

const label = (idx: Index, id: string) => idx.option.get(id)?.code ?? id;

export function validate(rules: ModelRules, selected: readonly string[]): ValidationResult {
  const idx = index(rules);
  const issues: Issue[] = [];
  const set = new Set<string>();
  for (const id of selected) {
    if (set.has(id)) issues.push({ code: 'DUPLICATE_OPTION', message: `Option ${label(idx, id)} is selected twice.`, optionIds: [id] });
    set.add(id);
    if (!idx.option.has(id)) issues.push({ code: 'UNKNOWN_OPTION', message: `Option ${id} is not available for this sauna.`, optionIds: [id] });
  }
  for (const g of rules.groups) {
    const chosen = g.options.filter(o => set.has(o.id)).map(o => o.id);
    if (g.selectionType === 'SINGLE' && chosen.length > 1) {
      issues.push({ code: 'SINGLE_GROUP_MULTIPLE', message: `Choose only one option for ${g.code}.`, optionIds: chosen, groupId: g.id });
    }
    if (g.required && chosen.length === 0) {
      issues.push({ code: 'REQUIRED_GROUP_EMPTY', message: `Choose an option for ${g.code}.`, optionIds: [], groupId: g.id });
    }
  }
  for (const id of set) {
    for (const req of idx.requires.get(id) ?? []) {
      if (!set.has(req)) issues.push({ code: 'REQUIRES_MISSING', message: `${label(idx, id)} requires ${label(idx, req)}.`, optionIds: [id, req] });
    }
  }
  for (const x of rules.excludes) {
    if (set.has(x.optionAId) && set.has(x.optionBId)) {
      issues.push({ code: 'EXCLUDED_PAIR', message: `${label(idx, x.optionAId)} cannot be combined with ${label(idx, x.optionBId)}.`, optionIds: [x.optionAId, x.optionBId] });
    }
  }
  return { valid: issues.length === 0, issues };
}

/** The model's default options, completed so the result is valid where the rules allow it. */
export function defaultSelection(rules: ModelRules): string[] {
  let sel: string[] = [];
  for (const g of rules.groups) {
    const defaults = g.options.filter(o => o.isDefault);
    const pick = g.selectionType === 'SINGLE' ? defaults.slice(0, 1) : defaults;
    if (g.selectionType === 'SINGLE' && g.required && pick.length === 0 && g.options[0]) pick.push(g.options[0]);
    for (const o of pick) sel = toggle(rules, sel, o.id, true).selection;
  }
  return sel;
}

export interface ToggleResult {
  selection: string[];
  /** Options added because the chosen one requires them. */
  added: string[];
  /** Options removed because of a conflict or a dependency. */
  removed: string[];
  /** Set when the change is not allowed (e.g. emptying a required single group). */
  rejected?: string;
}

/**
 * Turns an option on or off and repairs the selection: a SINGLE group keeps
 * one option, required options are pulled in transitively, options that
 * exclude anything now selected are dropped, and options that depended on a
 * removed option are removed too.
 */
export function toggle(rules: ModelRules, current: readonly string[], optionId: string, on: boolean): ToggleResult {
  const idx = index(rules);
  const group = idx.optionGroup.get(optionId);
  if (!group) return { selection: [...current], added: [], removed: [], rejected: 'Unknown option.' };
  const sel = new Set(current);
  const before = new Set(current);

  if (!on) {
    if (!sel.has(optionId)) return { selection: [...current], added: [], removed: [] };
    if (group.required && group.options.filter(o => sel.has(o.id)).length === 1) {
      return { selection: [...current], added: [], removed: [], rejected: `A ${group.code} option is required; choose another one instead.` };
    }
    removeWithDependents(idx, sel, optionId);
    return diff(before, sel);
  }

  // Turning on: collect the option and everything it requires, transitively.
  const wanted: string[] = [];
  const stack = [optionId];
  while (stack.length) {
    const id = stack.pop()!;
    if (wanted.includes(id)) continue;
    wanted.push(id);
    for (const r of idx.requires.get(id) ?? []) stack.push(r);
  }
  // Two wanted options that exclude each other cannot be satisfied.
  for (const a of wanted) for (const b of idx.excludes.get(a) ?? []) {
    if (wanted.includes(b)) return { selection: [...current], added: [], removed: [], rejected: `${label(idx, a)} cannot be combined with ${label(idx, b)}.` };
  }
  // Two wanted options in the same SINGLE group cannot be satisfied either.
  const singleSeen = new Map<string, string>();
  for (const id of wanted) {
    const g = idx.optionGroup.get(id)!;
    if (g.selectionType !== 'SINGLE') continue;
    const other = singleSeen.get(g.id);
    if (other && other !== id) return { selection: [...current], added: [], removed: [], rejected: `${label(idx, id)} and ${label(idx, other)} are alternatives.` };
    singleSeen.set(g.id, id);
  }
  for (const id of wanted) {
    const g = idx.optionGroup.get(id)!;
    if (g.selectionType === 'SINGLE') {
      for (const o of g.options) if (o.id !== id && sel.has(o.id)) removeWithDependents(idx, sel, o.id, wanted);
    }
    for (const x of idx.excludes.get(id) ?? []) if (sel.has(x)) removeWithDependents(idx, sel, x, wanted);
    sel.add(id);
  }
  return diff(before, sel);
}

function removeWithDependents(idx: Index, sel: Set<string>, id: string, keep: readonly string[] = []): void {
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (!sel.has(cur) || keep.includes(cur) && cur !== id) continue;
    sel.delete(cur);
    for (const dep of idx.requiredBy.get(cur) ?? []) stack.push(dep);
  }
}

function diff(before: Set<string>, after: Set<string>): ToggleResult {
  return {
    selection: [...after],
    added: [...after].filter(x => !before.has(x)),
    removed: [...before].filter(x => !after.has(x)),
  };
}

export interface Availability {
  optionId: string;
  selected: boolean;
  /** What else would change if the customer clicked this option now. */
  wouldAdd: string[];
  wouldRemove: string[];
  blockedReason?: string;
}

/** Explains, per option, the consequence of clicking it, for the UI. */
export function availability(rules: ModelRules, current: readonly string[]): Availability[] {
  const sel = new Set(current);
  return rules.groups.flatMap(g => g.options.map(o => {
    const r = toggle(rules, current, o.id, !sel.has(o.id));
    return {
      optionId: o.id,
      selected: sel.has(o.id),
      wouldAdd: r.added.filter(x => x !== o.id),
      wouldRemove: r.removed.filter(x => x !== o.id),
      ...(r.rejected ? { blockedReason: r.rejected } : {}),
    };
  }));
}
