import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSauna } from './build.ts';
import { computeLayout, footprint } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import { DEFAULT_KIT_OPTIONS, type KitSpec } from './spec.ts';

const KEYS = ['wallIn', 'wallOut', 'ceiling', 'bench', 'benchPanel', 'floor', 'plinth', 'roof', 'glass', 'doorGlass', 'steel', 'black', 'stones', 'gap', 'led', 'wash', 'glow', 'fire', 'grille', 'salt', 'white'] as const;
const mats = () => Object.fromEntries(KEYS.map(k => [k, Object.assign(new THREE.MeshStandardMaterial(), { name: k })])) as unknown as KitMaterials;

const spec = (over: Partial<KitSpec['extras']> = {}, lights: Partial<KitSpec['lights']> = {}): KitSpec => ({
  ...structuredClone(DEFAULT_KIT_OPTIONS),
  form: 'glass-corner', width: 2.4, depth: 2.0, height: 2.1,
  extras: { ...DEFAULT_KIT_OPTIONS.extras, ...over },
  lights: { ...DEFAULT_KIT_OPTIONS.lights, ...lights },
});

describe('glass-corner form', () => {
  it('is a rectangle with a glass front, a timber right wall and a glass panel in it', () => {
    const { segments } = footprint(spec());
    expect(segments.map(s => [s.id, s.kind])).toEqual([['back', 'solid'], ['right', 'solid'], ['front', 'glass'], ['left', 'solid']]);
    const L = computeLayout(spec());
    expect(L.segments.find(s => s.id === 'front')!.door).toBeDefined();
    expect(L.segments.find(s => s.id === 'right')!.windows).toHaveLength(1);
    expect(L.benchWalls).toEqual(['back', 'left']);
  });

  it('builds with an L bench, frame and heater, and shows the LED strip and IR panel when asked', () => {
    const count = (s: KitSpec) => {
      const { group } = buildSauna(s, mats());
      let n = 0;
      group.traverse(x => { const m = x as THREE.Mesh; if (m.isMesh) n += m.geometry.getAttribute('position').count; });
      return n;
    };
    const base = count(spec());
    expect(base).toBeGreaterThan(0);
    expect(count(spec({ irPanel: true }))).toBeGreaterThan(base);
    expect(count(spec({}, { backrest: true }))).toBeGreaterThan(base);
  });
});
