import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Segment, Vec2 } from './layout.ts';

/** A real light the scene should add (kept few: most glow is emissive geometry). */
export interface LightSpec {
  position: [number, number, number];
  color: string;
  intensity: number;
  distance: number;
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Collects geometry per material and merges each bucket into one mesh, so a
 * whole sauna (hundreds of slats and boards) renders in about fifteen draw
 * calls. All geometry carries UVs in metres; textures repeat at real size.
 */
export class Parts {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  readonly lights: LightSpec[] = [];
  /** Materials whose meshes cast shadows. */
  constructor(private readonly casters: Set<THREE.Material>) {}

  add(mat: THREE.Material, geo: THREE.BufferGeometry, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    if (m) g.applyMatrix4(m);
    let list = this.buckets.get(mat);
    if (!list) this.buckets.set(mat, (list = []));
    list.push(g);
  }

  /** Axis-aligned box in local space (metres), grain along `grain`, then transformed by `m`. */
  box(mat: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, m?: THREE.Matrix4, grain: 'x' | 'y' | 'z' = 'x') {
    if (x1 - x0 < 1e-4 || y1 - y0 < 1e-4 || z1 - z0 < 1e-4) return;
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    metreUVs(g, grain);
    this.add(mat, g, m);
  }

  toGroup(name: string): THREE.Group {
    const group = new THREE.Group();
    group.name = name;
    for (const [mat, list] of this.buckets) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = this.casters.has(mat);
      mesh.receiveShadow = !(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial;
      if ((mat as THREE.Material).transparent) mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

/** Box-projected UVs in metres; the grain axis maps to u wherever it lies in the face. */
export function metreUVs(g: THREE.BufferGeometry, grain: 'x' | 'y' | 'z' = 'x') {
  const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
  const uv = new Float32Array(pos.count * 2);
  const gi = grain === 'x' ? 0 : grain === 'y' ? 1 : 2;
  for (let i = 0; i < pos.count; i++) {
    const n = [Math.abs(nor.getX(i)), Math.abs(nor.getY(i)), Math.abs(nor.getZ(i))];
    const axis = n.indexOf(Math.max(n[0]!, n[1]!, n[2]!));
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const inPlane = [0, 1, 2].filter(a => a !== axis);
    const u = inPlane.includes(gi) ? gi : inPlane[0]!;
    const v = inPlane.find(a => a !== u)!;
    uv[i * 2] = p[u]!;
    uv[i * 2 + 1] = p[v]!;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Frame of a wall segment: x along the wall from its start, y up, z into the cabin. */
export function segMatrix(seg: Segment, u: number, offset: number, y = 0): THREE.Matrix4 {
  const X = new THREE.Vector3(seg.dir[0], 0, seg.dir[1]);
  const Z = new THREE.Vector3(seg.inward[0], 0, seg.inward[1]);
  const px = seg.a[0] + seg.dir[0] * u + seg.inward[0] * offset;
  const pz = seg.a[1] + seg.dir[1] * u + seg.inward[1] * offset;
  return new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(px, y, pz);
}

/** Frame at a plan point facing `facing` (local +z), y up. */
export function facingMatrix(p: Vec2, facing: Vec2, y = 0): THREE.Matrix4 {
  const Z = new THREE.Vector3(facing[0], 0, facing[1]).normalize();
  const X = new THREE.Vector3().crossVectors(UP, Z).normalize();
  return new THREE.Matrix4().makeBasis(X, UP, Z).setPosition(p[0], y, p[1]);
}

/** Collects flat-shaded quads with explicit UVs into one geometry. */
export class QuadBuilder {
  private pos: number[] = [];
  private nor: number[] = [];
  private uv: number[] = [];
  quad(p: THREE.Vector3Tuple[], uv: [number, number][]) {
    const [a, b, c, d] = p.map(v => new THREE.Vector3(...v));
    const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).normalize();
    for (const i of [0, 1, 2, 0, 2, 3]) {
      const v = [a, b, c, d][i]!;
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uv[i]![0], uv[i]![1]);
    }
  }
  tri(p: THREE.Vector3Tuple[], uv: [number, number][]) {
    const [a, b, c] = p.map(v => new THREE.Vector3(...v));
    const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!)).normalize();
    for (const i of [0, 1, 2]) {
      const v = [a, b, c][i]!;
      this.pos.push(v.x, v.y, v.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uv[i]![0], uv[i]![1]);
    }
  }
  get empty() {
    return this.pos.length === 0;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    return g;
  }
}

/**
 * Bench slat with a rounded front nose (bullnose), `length` along local x from
 * 0, `width` across z (nose towards +z), `thick` in y centred on 0.
 */
export function roundedSlat(length: number, width: number, thick: number): THREE.BufferGeometry {
  const r = thick / 2;
  const s = new THREE.Shape();
  s.moveTo(width / 2, -r);
  s.lineTo(-width / 2 + r, -r);
  s.absarc(-width / 2 + r, 0, r, -Math.PI / 2, -Math.PI * 1.5, true);
  s.lineTo(width / 2, r);
  s.lineTo(width / 2, -r);
  const g = new THREE.ExtrudeGeometry(s, { depth: length, bevelEnabled: false, curveSegments: 6 });
  // Extrusion z -> local x; shape x -> -z (so the nose, at shape -x, faces +z).
  g.rotateY(Math.PI / 2);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i);
    uv[i * 2 + 1] = pos.getY(i) + pos.getZ(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

/** Plan polygon as a horizontal surface at height y (facing up or down), UVs in metres. */
export function planCap(points: Vec2[], y: number, facing: 'up' | 'down'): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, facing === 'up' ? -z : z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(facing === 'up' ? -Math.PI / 2 : Math.PI / 2);
  const pos = g.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = pos.getX(i);
    uv[i * 2 + 1] = pos.getZ(i);
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.translate(0, y, 0);
  return g;
}

/** Vertical side faces of a plan polygon between y0 and y1 (outward normals). */
export function planSides(points: Vec2[], y0: number, y1: number): THREE.BufferGeometry {
  const q = new QuadBuilder();
  const c = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length] as Vec2, [0, 0] as Vec2);
  let u = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    // Outward: wind so the normal points away from the centroid.
    const nx = b[1] - a[1], nz = -(b[0] - a[0]);
    const out = nx * (a[0] - c[0]) + nz * (a[1] - c[1]) > 0;
    const [p, r] = out ? [b, a] : [a, b];
    q.quad([[p[0], y0, p[1]], [r[0], y0, r[1]], [r[0], y1, r[1]], [p[0], y1, p[1]]], [[u, y0], [u + l, y0], [u + l, y1], [u, y1]]);
    u += l;
  }
  return q.geometry();
}

/** Deterministic random numbers (stable layouts between renders). */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
