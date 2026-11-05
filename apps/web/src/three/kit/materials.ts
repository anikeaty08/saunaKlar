import * as THREE from 'three';
import type { KitAssets, WoodSet } from './assets.ts';
import type { KitSpec, WoodFinish } from './spec.ts';
import { glowTexture, grilleTexture, pebbleTexture, slateTextures, washTexture } from './textures.ts';

/**
 * One material per finish slot, shared by every part of a sauna, so the whole
 * cabin is a handful of draw calls. Wood materials take the Blender-made grain
 * maps (assets.ts) and tint them to the selected wood's swatch colour.
 */
export interface KitMaterials {
  wallIn: THREE.MeshStandardMaterial;
  wallOut: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  bench: THREE.MeshStandardMaterial;
  benchPanel: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  plinth: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  doorGlass: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  stones: THREE.MeshStandardMaterial;
  gap: THREE.MeshStandardMaterial;
  led: THREE.MeshBasicMaterial;
  wash: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  fire: THREE.MeshBasicMaterial;
  grille: THREE.MeshStandardMaterial;
  salt: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
}

const LED = '#ffd29a';

/** Tint that turns a coloured Blender map into the finish's colour (per channel, linear). */
function tintFor(set: WoodSet, finish: WoodFinish | string, factor = 1): THREE.Color {
  const c = new THREE.Color(typeof finish === 'string' ? finish : finish.color);
  return new THREE.Color(c.r / set.mean[0], c.g / set.mean[1], c.b / set.mean[2]).multiplyScalar(factor * 0.97);
}

function woodMaterial(sets: KitAssets['wood'], finish: WoodFinish, roughness = 0.78, factor = 1): THREE.MeshStandardMaterial {
  const set = finish.grain === 'knotty' ? sets.knotty : sets.clear;
  return new THREE.MeshStandardMaterial({ map: set.map, normalMap: set.normal ?? null, normalScale: new THREE.Vector2(0.6, 0.6), color: tintFor(set, finish, factor), roughness, envMapIntensity: 0.55 });
}

function glass(door: KitSpec['door'], isDoor: boolean): THREE.MeshStandardMaterial {
  const d = isDoor ? door : door === 'timber' ? 'clear' : door;
  const look = d === 'bronze' ? { color: '#6b4a2c', opacity: 0.55, roughness: 0.06 } : d === 'satin' ? { color: '#eef0ee', opacity: 0.82, roughness: 0.55 } : { color: '#d6e6e8', opacity: 0.16, roughness: 0.03 };
  return new THREE.MeshStandardMaterial({ ...look, transparent: true, metalness: 0.15, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.4 });
}

/** Cache key: only the spec fields that change materials. */
export function materialKey(spec: KitSpec): string {
  return JSON.stringify([spec.wallWood, spec.benchWood, spec.door, spec.exterior, spec.extras.stoneFloor, spec.form]);
}

/** The materials for a spec; `sets` are the wood maps from useKitAssets (shared, not disposed here). */
export function makeMaterials(spec: KitSpec, sets: KitAssets['wood']): KitMaterials {
  const wood = (finish: WoodFinish, roughness?: number, factor?: number) => woodMaterial(sets, finish, roughness, factor);
  const outdoor = spec.form === 'barrel' || spec.form === 'hex' || spec.form === 'cabin';
  const slat = sets.slat.map;
  const benchTint = (f: number) => tintFor(sets.slat, spec.benchWood, f);
  const bench = new THREE.MeshStandardMaterial({ map: slat, color: benchTint(1), roughness: 0.72, envMapIntensity: 0.6 });
  const exterior = (() => {
    if (spec.exterior === 'slate') {
      const s = slateTextures();
      return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, color: '#ffffff', roughness: 0.82, metalness: 0.05 });
    }
    if (spec.exterior === 'thermo') return wood({ color: '#6e4a30', grain: 'clear' }, 0.8);
    // Outdoors the same wood weathers a little darker than inside.
    return wood(spec.wallWood, 0.8, outdoor ? 0.88 : 1);
  })();
  const floor = spec.extras.stoneFloor
    ? new THREE.MeshStandardMaterial({ map: pebbleTexture(), roughness: 0.9 })
    : new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 0.95 });
  const roof = outdoor
    ? (() => {
        const s = slateTextures();
        return new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, color: '#8c8f93', roughness: 0.9 });
      })()
    : // Indoor cabins are closed by a wooden top, as in the owner's photos.
      exterior.clone();
  return {
    wallIn: wood(spec.wallWood),
    wallOut: exterior,
    ceiling: wood(spec.wallWood, 0.8, 1.03),
    bench,
    benchPanel: new THREE.MeshStandardMaterial({ map: slat, color: benchTint(0.97), roughness: 0.74, envMapIntensity: 0.6 }),
    floor,
    plinth: new THREE.MeshStandardMaterial({ color: '#2b2928', roughness: 0.9 }),
    roof,
    glass: glass(spec.door, false),
    doorGlass: glass(spec.door, true),
    steel: new THREE.MeshStandardMaterial({ color: '#b9bdc2', metalness: 0.55, roughness: 0.32 }),
    black: new THREE.MeshStandardMaterial({ color: '#1d1e20', metalness: 0.45, roughness: 0.5 }),
    stones: new THREE.MeshStandardMaterial({ color: '#5d5a56', roughness: 0.95, flatShading: true }),
    gap: new THREE.MeshStandardMaterial({ color: '#2a2018', roughness: 1 }),
    led: new THREE.MeshBasicMaterial({ color: LED, toneMapped: false }),
    wash: new THREE.MeshBasicMaterial({ color: LED, map: washTexture(), transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false }),
    glow: new THREE.MeshBasicMaterial({ color: LED, map: glowTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }),
    fire: new THREE.MeshBasicMaterial({ color: '#ff8a3c', toneMapped: false }),
    grille: new THREE.MeshStandardMaterial({ map: grilleTexture(), emissive: '#3a0c06', emissiveIntensity: 0.4, roughness: 0.55 }),
    salt: new THREE.MeshStandardMaterial({ color: '#f2a477', emissive: '#c4581f', emissiveIntensity: 0.35, roughness: 0.7 }),
    white: new THREE.MeshStandardMaterial({ color: '#efefec', roughness: 0.5 }),
  };
}

export function disposeMaterials(m: KitMaterials) {
  for (const mat of Object.values(m)) (mat as THREE.Material).dispose();
}
