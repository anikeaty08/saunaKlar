import { useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import partsUrl from './assets/kit-parts.glb?url';
import knottyUrl from './assets/wall-knotty.jpg?url';
import knottyNUrl from './assets/wall-knotty-n.png?url';
import clearUrl from './assets/wall-clear.jpg?url';
import clearNUrl from './assets/wall-clear-n.png?url';
import slatUrl from './assets/slat.jpg?url';
import woodMeans from './assets/wood.json';
import { TEXTURE_SIZE } from './textures.ts';

/**
 * The parts and wood textures made in Blender (tools/blender). Detailed
 * fixtures (heaters with real stones, the IR panel, dials, headrests, bucket)
 * come from kit-parts.glb; the kit places them in its own frames. Materials
 * named `kit:<slot>` are swapped for the sauna's material in that slot.
 */
export interface PartPiece {
  geometry: THREE.BufferGeometry;
  /** A kit material slot, or the part's own material. */
  material: string | THREE.Material;
}

export interface WoodSet {
  map: THREE.Texture;
  normal?: THREE.Texture;
  /** Mean linear colour of the map, so a finish's swatch can be matched. */
  mean: [number, number, number];
}

export interface KitAssets {
  parts: Map<string, PartPiece[]>;
  wood: { knotty: WoodSet; clear: WoodSet; slat: WoodSet };
}

const URLS = [knottyUrl, knottyNUrl, clearUrl, clearNUrl, slatUrl];

function prepare(t: THREE.Texture, size: [number, number], srgb: boolean): THREE.Texture {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size[0], 1 / size[1]);
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function partsFrom(scene: THREE.Object3D): Map<string, PartPiece[]> {
  const parts = new Map<string, PartPiece[]>();
  scene.updateMatrixWorld(true);
  for (const node of scene.children) {
    const inv = node.matrixWorld.clone().invert();
    const pieces: PartPiece[] = [];
    node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = mesh.geometry.clone();
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
      const mat = mesh.material as THREE.Material;
      pieces.push({ geometry: g, material: mat.name.startsWith('kit:') ? mat.name.slice(4) : mat });
    });
    parts.set(node.name, pieces);
  }
  return parts;
}

/** Loads (suspends until ready) the Blender-made parts and wood textures. */
export function useKitAssets(): KitAssets {
  const gltf = useGLTF(partsUrl);
  const [knotty, knottyN, clear, clearN, slat] = useTexture(URLS);
  return useMemo(() => {
    const B = TEXTURE_SIZE.boards, S = TEXTURE_SIZE.slat;
    const m = woodMeans as unknown as Record<string, [number, number, number]>;
    return {
      parts: partsFrom(gltf.scene),
      wood: {
        knotty: { map: prepare(knotty!, B, true), normal: prepare(knottyN!, B, false), mean: m['wall-knotty']! },
        clear: { map: prepare(clear!, B, true), normal: prepare(clearN!, B, false), mean: m['wall-clear']! },
        slat: { map: prepare(slat!, S, true), mean: m.slat! },
      },
    };
  }, [gltf, knotty, knottyN, clear, clearN, slat]);
}

/** Start fetching early, e.g. when the configurator opens. */
export function preloadKitAssets() {
  useGLTF.preload(partsUrl);
  useTexture.preload(URLS);
}
