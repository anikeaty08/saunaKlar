import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildSauna } from './build.ts';
import type { KitMaterials } from './materials.ts';
import { kitOptionsOf, type KitGroup, type SaunaForm } from './spec.ts';

const KEYS = ['wallIn', 'wallOut', 'ceiling', 'bench', 'benchPanel', 'floor', 'plinth', 'roof', 'glass', 'doorGlass', 'steel', 'black', 'stones', 'gap', 'led', 'wash', 'glow', 'fire', 'grille', 'salt', 'white'] as const;
const fakeMaterials = () => Object.fromEntries(KEYS.map(k => [k, Object.assign(new THREE.MeshStandardMaterial(), { name: k })])) as unknown as KitMaterials;

/** The seed's option groups (packages/db/src/seed.ts); `multi` groups are add-ons. */
const GROUPS: Record<string, { required: boolean; multi?: boolean; options: string[] }> = {
  wood: { required: true, options: ['pine', 'spruce', 'aspen', 'thermo-aspen', 'red-cedar'] },
  heater: { required: true, options: ['heater-6kw', 'heater-9kw', 'heater-wood', 'heater-storage'] },
  control: { required: false, multi: true, options: ['control-basic', 'control-wifi'] },
  door: { required: true, options: ['door-clear', 'door-bronze', 'door-satin', 'door-wood'] },
  'bench-layout': { required: false, options: ['bench-straight', 'bench-l', 'bench-u'] },
  'bench-wood': { required: false, options: ['bench-aspen', 'bench-alder', 'bench-thermo-aspen'] },
  'bench-front': { required: false, options: ['front-boards', 'front-framed', 'front-open'] },
  'bench-end': { required: false, options: ['end-waterfall', 'end-framed', 'end-plain'] },
  'bench-edge': { required: false, options: ['edge-rounded', 'edge-square'] },
  backrest: { required: false, options: ['backrest-continuous', 'backrest-panels', 'backrest-none'] },
  exterior: { required: false, options: ['exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  lighting: { required: false, multi: true, options: ['led-backrest', 'led-underbench', 'star-ceiling', 'ceiling-panel'] },
  extras: { required: false, multi: true, options: ['audio', 'aroma', 'bucket-set', 'ir-panel', 'headrests', 'thermometer', 'salt-wall', 'stone-floor'] },
};
const SWATCH: Record<string, string> = { spruce: '#e8d4a8', aspen: '#efe3c8', 'thermo-aspen': '#8a5a3b', 'red-cedar': '#a0522d', 'bench-aspen': '#efe3c8', 'bench-alder': '#c48d5e', 'bench-thermo-aspen': '#8a5a3b' };
/** The seven seeded models: form, size (mm) and the options each does not offer. */
const MODELS: { slug: string; form: SaunaForm; w: number; d: number; h: number; without: string[] }[] = [
  { slug: 'espoo-compact', form: 'box', w: 1400, d: 1200, h: 2000, without: ['heater-9kw', 'salt-wall', 'star-ceiling', 'bench-u', 'end-waterfall', 'end-framed', 'end-plain', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'kelo-barrel', form: 'barrel', w: 2000, d: 2400, h: 2050, without: ['bench-straight', 'bench-l', 'bench-u', 'front-boards', 'front-framed', 'front-open', 'end-waterfall', 'end-framed', 'end-plain', 'backrest-continuous', 'backrest-panels', 'backrest-none', 'ir-panel', 'headrests', 'stone-floor', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'fjord-panorama', form: 'panorama', w: 2200, d: 1800, h: 2100, without: [] },
  { slug: 'lappi-corner', form: 'corner', w: 1600, d: 1600, h: 2050, without: ['heater-wood', 'bench-u', 'salt-wall', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'kide-glass-corner', form: 'glass-corner', w: 2400, d: 2000, h: 2100, without: ['spruce', 'red-cedar', 'heater-wood', 'bench-u', 'door-wood', 'salt-wall', 'stone-floor', 'exterior-wood', 'exterior-thermo', 'exterior-slate'] },
  { slug: 'aurora-hex', form: 'hex', w: 2400, d: 2100, h: 2600, without: [] },
  { slug: 'saimaa-garden-house', form: 'cabin', w: 3000, d: 2400, h: 2600, without: ['heater-6kw'] },
];

function groupsOf(m: (typeof MODELS)[number]): KitGroup[] {
  return Object.entries(GROUPS)
    .map(([code, g]) => ({ code, options: g.options.filter(o => !m.without.includes(o)).map(o => ({ id: o, code: o, swatchColor: SWATCH[o] ?? null })) }))
    .filter(g => g.options.length);
}
function defaults(groups: KitGroup[]): string[] {
  return groups.filter(g => GROUPS[g.code]!.required).map(g => g.options[0]!.id);
}
/** Geometry per material plus the lights: what the eye can tell apart. */
function look(m: (typeof MODELS)[number], selection: string[]) {
  const o = kitOptionsOf(groupsOf(m), selection, m.d < 1600 ? 1 : 2);
  const spec = { ...o, form: m.form, width: m.w / 1000, depth: m.d / 1000, height: m.h / 1000 };
  const { group, lights } = buildSauna(spec, fakeMaterials());
  const parts: string[] = [];
  group.traverse(x => {
    const mesh = x as THREE.Mesh;
    if (!mesh.isMesh) return;
    const p = mesh.geometry.getAttribute('position');
    let sum = 0;
    for (let i = 0; i < p.count; i++) sum += p.getX(i) * 1.3 + p.getY(i) * 1.7 + p.getZ(i) * 1.9;
    parts.push(`${(mesh.material as THREE.Material).name}:${p.count}:${sum.toFixed(3)}`);
  });
  const finishes = JSON.stringify([o.wallWood, o.benchWood, o.door, o.exterior]);
  return { geometry: parts.sort().join('|') + JSON.stringify(lights), finishes, used: new Set(parts.map(p => p.split(':')[0])) };
}

/**
 * Options the kit cannot show on that model. Empty: the seed no longer offers bench ends on the
 * compact box (no exposed bench end) nor the salt wall on the corner sauna (no free wall).
 */
const KNOWN_GAPS: string[] = [];

describe('seed options on every model', () => {
  it('every offered option changes the 3D sauna', () => {
    const gaps: string[] = [];
    for (const m of MODELS) {
      const groups = groupsOf(m);
      const base = defaults(groups);
      for (const g of groups) {
        const rest = base.filter(id => !g.options.some(o => o.id === id));
        const none = look(m, rest);
        const looks = g.options.map(o => ({ code: o.id, ...look(m, [...rest, o.id]) }));
        for (const [i, a] of looks.entries()) {
          // Add-ons must add something; alternatives must differ from each other.
          const same = GROUPS[g.code]!.multi
            ? a.geometry === none.geometry
            : looks.some((b, j) => j !== i && b.geometry === a.geometry && b.finishes === a.finishes);
          if (same) gaps.push(`${m.slug} ${g.code}/${a.code}`);
        }
        if (g.code === 'bench-wood' && !looks[0]!.used.has('bench')) gaps.push(`${m.slug} bench-wood (no bench)`);
        if (g.code === 'exterior' && !looks[0]!.used.has('wallOut')) gaps.push(`${m.slug} exterior (no cladding)`);
      }
    }
    expect(gaps).toEqual(KNOWN_GAPS);
  });
});
