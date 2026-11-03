import { useEffect, useMemo } from 'react';
import type * as THREE from 'three';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';
import { buildSauna } from './build.ts';
import { disposeMaterials, makeMaterials, materialKey } from './materials.ts';
import type { KitSpec } from './spec.ts';

/**
 * A sauna built by the construction kit from the model's form and size and the
 * selected options. Materials are rebuilt only when a finish changes; geometry
 * is rebuilt (a few milliseconds) when anything else changes.
 */
export function KitSauna({ specs, options }: { specs: ViewerSpecs; options: ViewerOptions }) {
  const spec: KitSpec = useMemo(
    () => ({ ...options, form: specs.form, width: specs.widthMm / 1000, depth: specs.depthMm / 1000, height: specs.heightMm / 1000 }),
    [options, specs.form, specs.widthMm, specs.depthMm, specs.heightMm],
  );
  const key = JSON.stringify(spec);
  const matKey = materialKey(spec);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the finishes only
  const materials = useMemo(() => makeMaterials(spec), [matKey]);
  useEffect(() => () => disposeMaterials(materials), [materials]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the full spec
  const built = useMemo(() => buildSauna(spec, materials), [key, materials]);
  useEffect(
    () => () => {
      built.group.traverse(o => {
        const m = o as THREE.Mesh;
        if (m.isMesh) m.geometry.dispose();
      });
    },
    [built],
  );
  return (
    <group>
      <primitive object={built.group} />
      {built.lights.map((l, i) => (
        <pointLight key={i} position={l.position} color={l.color} intensity={l.intensity} distance={l.distance} decay={1.6} />
      ))}
    </group>
  );
}
