import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { availability, defaultSelection, toggle, validate, type ModelRules } from '../src/index.ts';

// Mirrors the manifest example in the design: wood (SINGLE, required), extras (MULTI).
const rules: ModelRules = {
  groups: [
    { id: 'g-wood', code: 'wood', selectionType: 'SINGLE', required: true, options: [
      { id: 'cedar', code: 'cedar', isDefault: true },
      { id: 'spruce', code: 'spruce', isDefault: false },
      { id: 'thermo-ash', code: 'thermo-ash', isDefault: false },
    ] },
    { id: 'g-extras', code: 'extras', selectionType: 'MULTI', required: false, options: [
      { id: 'led', code: 'led-lights', isDefault: false },
      { id: 'audio', code: 'audio', isDefault: false },
      { id: 'salt', code: 'salt', isDefault: false },
    ] },
  ],
  requires: [{ optionId: 'audio', requiredOptionId: 'led' }],
  excludes: [{ optionAId: 'spruce', optionBId: 'salt' }],
};

describe('validate', () => {
  it('accepts a valid selection', () => {
    expect(validate(rules, ['cedar', 'audio', 'led'])).toEqual({ valid: true, issues: [] });
  });
  it('reports every rule violation', () => {
    const codes = (sel: string[]) => validate(rules, sel).issues.map(i => i.code).sort();
    expect(codes([])).toEqual(['REQUIRED_GROUP_EMPTY']);
    expect(codes(['cedar', 'spruce'])).toEqual(['SINGLE_GROUP_MULTIPLE']);
    expect(codes(['cedar', 'audio'])).toEqual(['REQUIRES_MISSING']);
    expect(codes(['spruce', 'salt'])).toEqual(['EXCLUDED_PAIR']);
    expect(codes(['cedar', 'nope'])).toEqual(['UNKNOWN_OPTION']);
    expect(codes(['cedar', 'led', 'led'])).toEqual(['DUPLICATE_OPTION']);
  });
});

describe('toggle', () => {
  it('replaces the option in a SINGLE group', () => {
    expect(toggle(rules, ['cedar'], 'spruce', true)).toMatchObject({ selection: ['spruce'], removed: ['cedar'], added: ['spruce'] });
  });
  it('pulls in required options', () => {
    const r = toggle(rules, ['cedar'], 'audio', true);
    expect(r.selection.sort()).toEqual(['audio', 'cedar', 'led']);
  });
  it('removes dependents when a requirement is turned off', () => {
    expect(toggle(rules, ['cedar', 'audio', 'led'], 'led', false).selection).toEqual(['cedar']);
  });
  it('drops excluded options', () => {
    expect(toggle(rules, ['cedar', 'salt'], 'spruce', true).selection.sort()).toEqual(['spruce']);
  });
  it('refuses a conflict that would empty a required group', () => {
    expect(toggle(rules, ['spruce'], 'salt', true).rejected).toMatch(/choose another wood/);
  });
  it('refuses to empty a required SINGLE group', () => {
    expect(toggle(rules, ['cedar'], 'cedar', false).rejected).toMatch(/required/);
  });
  it('refuses unknown options', () => {
    expect(toggle(rules, ['cedar'], 'x', true).rejected).toBeDefined();
  });
  it('property: any click sequence from the default stays valid', () => {
    const ids = rules.groups.flatMap(g => g.options.map(o => o.id));
    fc.assert(fc.property(fc.array(fc.tuple(fc.constantFrom(...ids), fc.boolean()), { maxLength: 30 }), clicks => {
      let sel = defaultSelection(rules);
      for (const [id, on] of clicks) sel = toggle(rules, sel, id, on).selection;
      expect(validate(rules, sel).issues).toEqual([]);
    }));
  });
});

describe('defaultSelection and availability', () => {
  it('starts from the defaults', () => {
    expect(defaultSelection(rules)).toEqual(['cedar']);
  });
  it('explains consequences of a click', () => {
    const a = availability(rules, ['cedar', 'salt']);
    expect(a.find(x => x.optionId === 'spruce')).toMatchObject({ wouldRemove: expect.arrayContaining(['cedar', 'salt']) });
    expect(a.find(x => x.optionId === 'audio')).toMatchObject({ wouldAdd: ['led'] });
  });
});
