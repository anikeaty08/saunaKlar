import type * as THREE from 'three';
import { buildBenches } from './benches.ts';
import { buildFixtures } from './fixtures.ts';
import { barrel, cabinRoof, hexRoof } from './forms.ts';
import { computeLayout } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import type { PartPiece } from './assets.ts';
import { Parts, type LightSpec } from './parts.ts';
import type { KitSpec } from './spec.ts';
import { buildStructure, flatRoof } from './structure.ts';

/** Real lights per sauna; the rest of the glow is emissive geometry. */
const MAX_LIGHTS = 6;

/** Builds the whole sauna for a spec: one merged mesh per material, plus a few lights. */
export function buildSauna(spec: KitSpec, M: KitMaterials, library?: Map<string, PartPiece[]>): { group: THREE.Group; lights: LightSpec[] } {
  const P = new Parts(new Set<THREE.Material>([M.wallIn, M.wallOut, M.bench, M.benchPanel, M.black, M.roof, M.plinth]), library, slot => M[slot as keyof KitMaterials]);
  // A barrel always runs along its longer side; built along z and turned when wider than deep.
  const turn = spec.form === 'barrel' && spec.width > spec.depth;
  if (spec.form === 'barrel') {
    barrel(P, M, turn ? { ...spec, width: spec.depth, depth: spec.width } : spec);
  } else {
    const L = computeLayout(spec);
    buildStructure(P, M, L, spec);
    if (spec.form === 'hex') hexRoof(P, M, L, spec);
    else if (spec.form === 'cabin') cabinRoof(P, M, L, spec);
    else flatRoof(P, M, L);
    // The IR panel goes on the longest bench wall.
    const irBand = spec.extras.irPanel ? [...L.bands].filter(b => b.level === 'upper').sort((a, b) => segLength(L, b.segment) - segLength(L, a.segment))[0] : undefined;
    const { irAt } = buildBenches(P, M, L, spec, irBand?.segment ?? null);
    buildFixtures(P, M, L, spec, irAt, irBand ? L.segments.find(s => s.id === irBand.segment)! : null);
  }
  const lights = [...P.lights].sort((a, b) => b.intensity - a.intensity).slice(0, MAX_LIGHTS);
  const group = P.toGroup(`sauna-${spec.form}`);
  if (!turn) return { group, lights };
  group.rotation.y = Math.PI / 2;
  // (x, z) → (z, −x): the same quarter turn for the lights.
  return { group, lights: lights.map(l => ({ ...l, position: [l.position[2], l.position[1], -l.position[0]] as [number, number, number] })) };
}

function segLength(L: ReturnType<typeof computeLayout>, id: string): number {
  return L.segments.find(s => s.id === id)?.length ?? 0;
}
