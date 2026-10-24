import { describe, expect, it } from 'vitest';
import type { ModelRules } from '@saunaklar/rules';
import { fromSelection } from '../../src/domain/catalog.ts';

/** The catalog's "from" price uses the cheapest valid selection (follow-up 4). */
const opt = (id: string, isDefault = false) => ({ id, code: id, isDefault });
const base = (): ModelRules => ({
  groups: [
    { id: 'wood', code: 'wood', selectionType: 'SINGLE', required: true, options: [opt('spruce', true), opt('aspen'), opt('cedar')] },
    { id: 'heater', code: 'heater', selectionType: 'SINGLE', required: true, options: [opt('h9', true), opt('h6')] },
    { id: 'extras', code: 'extras', selectionType: 'MULTI', required: false, options: [opt('led'), opt('audio')] },
  ],
  requires: [],
  excludes: [],
});
const prices = new Map(Object.entries({ spruce: 50, aspen: 20, cedar: 90, h9: 300, h6: 100, led: 0, audio: 40 }));
const sorted = (a: string[]) => [...a].sort();

describe('fromSelection', () => {
  it('takes the cheapest option of every required group and nothing optional', () => {
    expect(sorted(fromSelection(base(), prices))).toEqual(['aspen', 'h6']);
  });

  it('breaks price ties in favour of the default option', () => {
    const tie = new Map(prices).set('spruce', 20);
    expect(sorted(fromSelection(base(), tie))).toEqual(['h6', 'spruce']);
  });

  it('falls back to the default selection when the cheapest combination is excluded', () => {
    const rules = { ...base(), excludes: [{ optionAId: 'aspen', optionBId: 'h6' }] };
    expect(sorted(fromSelection(rules, prices))).toEqual(['h9', 'spruce']);
  });

  it('falls back to the default selection when the cheapest option requires something', () => {
    const rules = { ...base(), requires: [{ optionId: 'h6', requiredOptionId: 'audio' }] };
    expect(sorted(fromSelection(rules, prices))).toEqual(['h9', 'spruce']);
  });

  it('keeps the cheapest combination as a lower bound when the defaults are invalid too', () => {
    const rules = { ...base(), excludes: [{ optionAId: 'aspen', optionBId: 'h6' }, { optionAId: 'spruce', optionBId: 'h9' }] };
    expect(sorted(fromSelection(rules, prices))).toEqual(['aspen', 'h6']);
  });

  it('is empty for a model without required groups', () => {
    expect(fromSelection({ groups: [base().groups[2]!], requires: [], excludes: [] }, prices)).toEqual([]);
  });
});
