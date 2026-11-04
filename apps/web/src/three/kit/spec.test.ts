import { describe, expect, it } from 'vitest';
import { DEFAULT_KIT_OPTIONS, kitOptionsOf, type KitGroup } from './spec.ts';

const group = (code: string, ...codes: string[]): KitGroup => ({
  code,
  options: codes.map(c => ({ id: `${code}:${c}`, code: c, swatchColor: c === 'red-cedar' ? '#9b5a3c' : null })),
});
const pick = (...ids: string[]) => ids;

describe('kitOptionsOf', () => {
  it('returns the defaults when nothing is chosen', () => {
    expect(kitOptionsOf([], [])).toEqual(DEFAULT_KIT_OPTIONS);
  });

  it('reads the platform seed codes', () => {
    const groups = [
      group('wood', 'spruce', 'red-cedar'),
      group('heater', 'heater-6kw', 'heater-9kw', 'heater-wood'),
      group('door', 'door-clear', 'door-bronze', 'door-wood'),
      group('control', 'control-basic', 'control-wifi'),
      group('lighting', 'led-backrest', 'led-underbench', 'star-ceiling', 'ceiling-panel'),
      group('extras', 'bucket-set', 'salt-wall', 'aroma', 'audio', 'ir-panel', 'headrests', 'thermometer'),
    ];
    const o = kitOptionsOf(groups, pick('wood:red-cedar', 'heater:heater-9kw', 'door:door-wood', 'control:control-wifi', 'lighting:led-backrest', 'lighting:star-ceiling', 'lighting:ceiling-panel', 'extras:bucket-set', 'extras:salt-wall', 'extras:ir-panel', 'extras:headrests', 'extras:thermometer'));
    expect(o.wallWood).toEqual({ color: '#9b5a3c', grain: 'clear' });
    expect(o.benchWood.grain).toBe('clear');
    expect(o.heater).toBe('electric-large');
    expect(o.door).toBe('timber');
    expect(o.control).toBe(true);
    expect(o.lights).toEqual({ backrest: true, underBench: false, stars: true, ceilingPanel: true });
    expect(o.extras).toMatchObject({ bucket: true, saltWall: true, irPanel: true, headrests: true, thermometer: true, aroma: false, audio: false });
    expect(kitOptionsOf(groups, pick('heater:heater-wood')).heater).toBe('stove');
    expect(kitOptionsOf(groups, pick('heater:heater-6kw')).heater).toBe('electric');
  });

  it('reads the demo catalogue codes', () => {
    const groups = [
      group('heater', 'electric-6', 'electric-9', 'storage-10', 'wood-stove'),
      group('control', 'dial', 'digital', 'app'),
      group('door', 'clear', 'bronze', 'satin', 'timber'),
      group('lighting', 'backrest-led', 'bench-led', 'starlight'),
      group('extras', 'aroma', 'bucket', 'backrests', 'stone-floor'),
    ];
    const o = kitOptionsOf(groups, pick('heater:storage-10', 'control:dial', 'door:satin', 'lighting:bench-led', 'extras:stone-floor'));
    expect(o.heater).toBe('storage');
    expect(o.control).toBe(false);
    expect(o.door).toBe('satin');
    expect(o.lights.underBench).toBe(true);
    expect(o.extras.stoneFloor).toBe(true);
    // Backrests are sold as an extra here, so none is drawn until chosen.
    expect(o.backrest).toBe('none');
    expect(kitOptionsOf(groups, pick('extras:backrests')).backrest).toBe('continuous');
    expect(kitOptionsOf(groups, pick('heater:electric-9')).heater).toBe('electric-large');
  });

  it('reads the bench, backrest and exterior groups', () => {
    const groups = [
      group('bench-layout', 'bench-straight', 'bench-l', 'bench-u'),
      group('bench-front', 'front-boards', 'front-framed', 'front-open'),
      group('bench-end', 'end-waterfall', 'end-framed', 'end-plain'),
      group('bench-edge', 'edge-rounded', 'edge-square'),
      group('backrest', 'backrest-continuous', 'backrest-panels', 'backrest-none'),
      group('bench-wood', 'bench-aspen', 'bench-alder'),
      group('exterior', 'exterior-wood', 'exterior-slate', 'exterior-thermo'),
    ];
    const o = kitOptionsOf(groups, pick('bench-layout:bench-u', 'bench-front:front-open', 'bench-end:end-framed', 'bench-edge:edge-square', 'backrest:backrest-panels', 'bench-wood:bench-alder', 'exterior:exterior-slate'), 1);
    expect(o.bench).toEqual({ layout: 'u', levels: 1, front: 'open', end: 'framed', edge: 'square' });
    expect(o.backrest).toBe('panels');
    expect(o.benchWood.grain).toBe('clear');
    expect(o.exterior).toBe('slate');
    const p = kitOptionsOf(groups, pick('bench-layout:bench-l', 'bench-front:front-framed', 'backrest:backrest-none', 'exterior:exterior-thermo'));
    expect(p.bench.layout).toBe('l');
    expect(p.bench.front).toBe('framed');
    expect(p.backrest).toBe('none');
    expect(p.exterior).toBe('thermo');
    expect(kitOptionsOf(groups, pick('bench-layout:bench-straight')).bench.layout).toBe('straight');
  });
});
