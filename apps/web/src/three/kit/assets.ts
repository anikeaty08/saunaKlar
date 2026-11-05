import { useEffect, useMemo } from 'react';
import { useGLTF, useTexture } from '@react-three/drei';
import * as THREE from 'three';
import partsUrl from './assets/kit-parts.glb?url';
import knottyUrl from './assets/wall-knotty.jpg?url';
import knottyNUrl from './assets/wall-knotty-n.webp?url';
import clearUrl from './assets/wall-clear.jpg?url';
import clearNUrl from './assets/wall-clear-n.webp?url';
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

/**
 * The compressed GLB stores positions, normals and UVs as quantized integers
 * (KHR_mesh_quantization). The kit merges these parts with float geometry and
 * transforms them, and both need Float32 attributes, so expand them here.
 * Normalized attributes come back as real 0..1 / -1..1 values via getComponent.
 */
function toFloat32(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    const attr = g.getAttribute(name);
    if (attr.array instanceof Float32Array && !(attr as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(attr.count * attr.itemSize);
    for (let i = 0; i < attr.count; i++) {
      for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
    }
    g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
  }
  return g;
}

export function partsFrom(scene: THREE.Object3D): Map<string, PartPiece[]> {
  const parts = new Map<string, PartPiece[]>();
  scene.updateMatrixWorld(true);
  for (const node of scene.children) {
    const pieces: PartPiece[] = [];
    node.traverse(o => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const g = toFloat32(mesh.geometry.clone());
      // The part frame is the scene frame (every node is authored at identity); the
      // node transform in the compressed GLB is the quantization scale/offset and
      // must be kept, not inverted away.
      g.applyMatrix4(mesh.matrixWorld);
      const mat = mesh.material as THREE.Material;
      pieces.push({ geometry: g, material: mat.name.startsWith('kit:') ? mat.name.slice(4) : mat });
    });
    parts.set(node.name, pieces);
  }
  return parts;
}

/** Frees the geometries partsFrom copied (the loaded scene and textures stay in drei's cache). */
export function disposeParts(parts: Map<string, PartPiece[]>) {
  for (const pieces of parts.values()) for (const p of pieces) p.geometry.dispose();
}

/**
 * Loads (suspends until ready) the Blender-made parts and wood textures. The
 * part geometries are this component's own copies and are freed on unmount.
 */
export function useKitAssets(): KitAssets {
  const gltf = useGLTF(partsUrl);
  const [knotty, knottyN, clear, clearN, slat] = useTexture(URLS);
  const assets = useMemo<KitAssets>(() => {
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
  useEffect(() => () => disposeParts(assets.parts), [assets]);
  return assets;
}

/** Start fetching early, e.g. when the configurator opens. */
export function preloadKitAssets() {
  useGLTF.preload(partsUrl);
  useTexture.preload(URLS);
}
