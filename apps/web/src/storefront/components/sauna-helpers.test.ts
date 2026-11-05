import { describe, expect, it } from 'vitest';
import { initStep, oneAtATime, stepGroupCode } from './sauna-helpers.ts';

describe('initStep', () => {
  const clean = { slug: 'fjord', configurationId: null, dirty: false };

  it('starts from the defaults for another model', () => {
    expect(initStep('kelo', null, null, clean)).toBe('defaults');
  });

  it('keeps an unsaved draft of the same model', () => {
    expect(initStep('fjord', null, null, { ...clean, dirty: true })).toBeNull();
  });

  it('resets a store still bound to a saved configuration when the URL has no id', () => {
    // Opened ?id=A, then /configure/fjord: Save must not write to A.
    expect(initStep('fjord', null, null, { ...clean, configurationId: 'A' })).toBe('defaults');
  });

  it('loads the configuration named in the URL once it arrives', () => {
    expect(initStep('fjord', 'A', null, clean)).toBeNull();
    expect(initStep('fjord', 'A', 'A', clean)).toBe('load');
    expect(initStep('fjord', 'B', 'B', { ...clean, configurationId: 'A', dirty: true })).toBe('load');
  });

  it('does not wipe unsaved edits when the same configuration is refetched', () => {
    expect(initStep('fjord', 'A', 'A', { ...clean, configurationId: 'A', dirty: true })).toBeNull();
    expect(initStep('fjord', 'A', 'A', { ...clean, configurationId: 'A' })).toBe('load');
  });
});

describe('oneAtATime', () => {
  it('starts a call only after the one in flight settles', async () => {
    const log: string[] = [];
    let n = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const run = oneAtATime(async () => {
      const i = ++n;
      log.push(`start ${i}`);
      if (i === 1) await gate;
      log.push(`end ${i}`);
      return i;
    });
    const a = run();
    const b = run();
    await Promise.resolve();
    expect(log).toEqual(['start 1']);
    release();
    expect(await Promise.all([a, b])).toEqual([1, 2]);
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
  });

  it('runs the next call after a failure', async () => {
    let n = 0;
    const run = oneAtATime(async () => {
      if (++n === 1) throw new Error('offline');
      return n;
    });
    const a = run();
    const b = run();
    await expect(a).rejects.toThrow('offline');
    expect(await b).toBe(2);
  });
});

describe('stepGroupCode', () => {
  const groups = [{ code: 'wood' }, { code: 'heater' }];
  it('returns the code of a group of this model', () => {
    expect(stepGroupCode('heater', groups)).toBe('heater');
  });
  it('ignores a missing or unknown step', () => {
    expect(stepGroupCode(null, groups)).toBeNull();
    expect(stepGroupCode('', groups)).toBeNull();
    expect(stepGroupCode('roof', groups)).toBeNull();
  });
});
