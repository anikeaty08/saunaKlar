import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import partsUrl from '../../../apps/web/src/three/kit/assets/kit-parts.glb?url';
import knottyUrl from '../../../apps/web/src/three/kit/assets/wall-knotty.jpg?url';
import knottyNUrl from '../../../apps/web/src/three/kit/assets/wall-knotty-n.png?url';
import clearUrl from '../../../apps/web/src/three/kit/assets/wall-clear.jpg?url';
import clearNUrl from '../../../apps/web/src/three/kit/assets/wall-clear-n.png?url';
import slatUrl from '../../../apps/web/src/three/kit/assets/slat.jpg?url';
import woodMeans from '../../../apps/web/src/three/kit/assets/wood.json';
import { partsFrom } from '../../../apps/web/src/three/kit/assets.ts';
import { TEXTURE_SIZE } from '../../../apps/web/src/three/kit/textures.ts';
import { makeMaterials } from '../../../apps/web/src/three/kit/materials.ts';
import { buildSauna } from '../../../apps/web/src/three/kit/build.ts';
import { interiorView } from '../../../apps/web/src/three/kit/interior.ts';
import { kitOptionsOf } from '../../../apps/web/src/three/kit/spec.ts';
import { saunaDetails } from '../../../apps/web/src/api/mock-data.ts';

const tl = new THREE.TextureLoader();
const tex = (u: string, size: [number, number], srgb: boolean) => tl.loadAsync(u).then(t => { t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1 / size[0], 1 / size[1]); return t; });

function defaults(d: any): string[] {
  return d.groups.flatMap((g: any) => {
    const def = g.options.filter((o: any) => o.isDefault).map((o: any) => o.id);
    if (g.selectionType === 'SINGLE' && def.length === 0 && g.required) return [g.options[0].id];
    return g.selectionType === 'SINGLE' ? def.slice(0, 1) : def;
  });
}
const attr = (d: any, c: string) => d.attributes.find((a: any) => a.code === c)?.value;

(window as any).exportAll = async () => {
  const gltf = await new GLTFLoader().loadAsync(partsUrl);
  const B = TEXTURE_SIZE.boards, S = TEXTURE_SIZE.slat, m = woodMeans as any;
  const assets = { parts: partsFrom(gltf.scene), wood: {
    knotty: { map: await tex(knottyUrl, B, true), normal: await tex(knottyNUrl, B, false), mean: m['wall-knotty'] },
    clear: { map: await tex(clearUrl, B, true), normal: await tex(clearNUrl, B, false), mean: m['wall-clear'] },
    slat: { map: await tex(slatUrl, S, true), mean: m.slat } } };
  const out: any[] = [];
  for (const d of saunaDetails()) {
    const sel = defaults(d);
    // Show the extras the photos show: LED strips, headrests, bucket, thermometer, IR where offered.
    for (const g of d.groups) for (const o of g.options) if (/led|headrest|bucket|thermo|ir|backrest/i.test(o.code ?? '') && g.selectionType === 'MULTI' && !sel.includes(o.id)) sel.push(o.id);
    const form = String(attr(d, 'form'));
    const W = Number(attr(d, 'width_mm')) / 1000, D = Number(attr(d, 'depth_mm')) / 1000, H = Number(attr(d, 'height_mm')) / 1000;
    const levels = Number(attr(d, 'bench_levels') ?? 2) < 2 ? 1 : 2;
    const options = kitOptionsOf(d.groups as any, sel, levels as 1 | 2);
    const spec = { ...options, form, width: W, depth: D, height: H } as any;
    const M = makeMaterials(spec, assets as any);
    const { group, lights } = buildSauna(spec, M, assets.parts);
    // Additive glow cards are a real-time trick; Blender lights the room for real.
    const drop: THREE.Object3D[] = [];
    group.traverse(o => { const mat = (o as THREE.Mesh).material as THREE.Material; if (mat && (mat as any).blending === THREE.AdditiveBlending) drop.push(o); });
    drop.forEach(o => o.parent!.remove(o));
    group.traverse(o => { const mesh = o as THREE.Mesh; if (mesh.isMesh) { const mat = mesh.material as THREE.MeshStandardMaterial; for (const [k, v] of Object.entries(M)) if (v === mat) mat.name = k; } });
    const glb = await new GLTFExporter().parseAsync(group, { binary: true }) as ArrayBuffer;
    const bytes = new Uint8Array(glb); let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    out.push({ slug: d.slug, form, W, D, H, glb: btoa(bin), lights, view: interiorView(spec) });
  }
  return out;
};
