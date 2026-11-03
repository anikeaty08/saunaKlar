import * as THREE from 'three';
import { add, along, intersect, mul, type KitLayout, type Line, type Opening, type Segment, type Vec2 } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import { Parts, QuadBuilder, planCap, planSides, segMatrix } from './parts.ts';
import type { KitSpec } from './spec.ts';

/** Interior face line of a segment at the full wall thickness (used for mitres). */
const innerLine = (s: Segment, wall: number): Line => ({ p: add(s.a, mul(s.inward, wall)), d: s.dir });
/** Glass centre plane. */
const midLine = (s: Segment, wall: number): Line => ({ p: add(s.a, mul(s.inward, wall / 2)), d: s.dir });

export function neighbours(L: KitLayout, s: Segment) {
  const i = L.segments.indexOf(s), n = L.segments.length;
  return { prev: L.segments[(i + n - 1) % n]!, next: L.segments[(i + 1) % n]! };
}

/** Interior polygon (inner faces of all walls). */
export function interiorPolygon(L: KitLayout): Vec2[] {
  return L.segments.map((s, i) => intersect(innerLine(L.segments[(i + L.segments.length - 1) % L.segments.length]!, L.wall), innerLine(s, L.wall))!);
}

/** A run of solid wall between uA and uB (outer face), y0..y1, mitred where it meets the segment's corners. */
function wallPiece(P: Parts, M: KitMaterials, L: KitLayout, s: Segment, uA: number, uB: number, y0: number, y1: number) {
  if (uB - uA < 0.005 || y1 - y0 < 0.005) return;
  const { prev, next } = neighbours(L, s);
  const w = L.wall;
  const mStart = along(s, intersect(innerLine(prev, w), innerLine(s, w))!);
  const mEnd = along(s, intersect(innerLine(s, w), innerLine(next, w))!);
  const i0 = uA <= 1e-6 ? mStart : uA;
  const i1 = uB >= s.length - 1e-6 ? mEnd : uB;
  const inside = new QuadBuilder();
  const outside = new QuadBuilder();
  inside.quad([[i0, y0, w], [i1, y0, w], [i1, y1, w], [i0, y1, w]], [[i0, y0], [i1, y0], [i1, y1], [i0, y1]]);
  outside.quad([[uB, y0, 0], [uA, y0, 0], [uA, y1, 0], [uB, y1, 0]], [[uB, y0], [uA, y0], [uA, y1], [uB, y1]]);
  outside.quad([[uA, y1, 0], [i0, y1, w], [i1, y1, w], [uB, y1, 0]], [[uA, 0], [i0, w], [i1, w], [uB, 0]]);
  outside.quad([[uA, y0, 0], [uB, y0, 0], [i1, y0, w], [i0, y0, w]], [[uA, 0], [uB, 0], [i1, w], [i0, w]]);
  // End caps: wall wood shows where a wall ends at an opening; corners are hidden by the neighbour.
  const capStart = new QuadBuilder();
  capStart.quad([[uA, y0, 0], [i0, y0, w], [i0, y1, w], [uA, y1, 0]], [[0, y0], [w, y0], [w, y1], [0, y1]]);
  const capEnd = new QuadBuilder();
  capEnd.quad([[uB, y0, 0], [uB, y1, 0], [i1, y1, w], [i1, y0, w]], [[0, y0], [0, y1], [w, y1], [w, y0]]);
  const m = segMatrix(s, 0, 0, L.floorY);
  P.add(M.wallIn, inside.geometry(), m);
  P.add(M.wallOut, outside.geometry(), m);
  P.add(uA <= 1e-6 ? M.wallOut : M.benchPanel, capStart.geometry(), m);
  P.add(uB >= s.length - 1e-6 ? M.wallOut : M.benchPanel, capEnd.geometry(), m);
}

function solidWall(P: Parts, M: KitMaterials, L: KitLayout, s: Segment, timber: boolean) {
  const H = L.wallHeight;
  const openings: Opening[] = [...(s.door ? [s.door] : []), ...s.windows].sort((a, b) => a.u0 - b.u0);
  let u = 0;
  for (const o of openings) {
    wallPiece(P, M, L, s, u, o.u0, 0, H);
    wallPiece(P, M, L, s, o.u0, o.u1, 0, o.y0);
    wallPiece(P, M, L, s, o.u0, o.u1, o.y1, H);
    u = o.u1;
  }
  wallPiece(P, M, L, s, u, s.length, 0, H);
  const m = segMatrix(s, 0, 0, L.floorY);
  for (const o of s.windows) {
    lining(P, M, o, L.wall, m);
    P.box(M.glass, o.u0 + 0.03, o.u1 - 0.03, o.y0 + 0.03, o.y1 - 0.03, L.wall / 2 - 0.006, L.wall / 2 + 0.006, m);
    P.box(M.steel, o.u0 + 0.03, o.u1 - 0.03, o.y0 + 0.02, o.y0 + 0.035, -0.012, 0.004, m);
  }
  if (s.door) {
    lining(P, M, s.door, L.wall, m);
    doorLeaf(P, M, s.door, timber ? 0.042 : -0.002, m, true, timber);
  }
}

/** Wooden lining around an opening, the full wall thickness. */
function lining(P: Parts, M: KitMaterials, o: Opening, wall: number, m: THREE.Matrix4) {
  const t = 0.03;
  P.box(M.benchPanel, o.u0, o.u0 + t, o.y0, o.y1, -0.004, wall + 0.008, m, 'y');
  P.box(M.benchPanel, o.u1 - t, o.u1, o.y0, o.y1, -0.004, wall + 0.008, m, 'y');
  P.box(M.benchPanel, o.u0, o.u1, o.y1 - t, o.y1, -0.004, wall + 0.008, m);
  if (o.y0 > 0) P.box(M.benchPanel, o.u0, o.u1, o.y0, o.y0 + t, -0.012, wall + 0.008, m);
}

/** Door leaf in an opening: frameless glass with steel hinges and a bar handle, or timber with a slit window. */
function doorLeaf(P: Parts, M: KitMaterials, d: Opening & { hingeAtStart: boolean }, z: number, m: THREE.Matrix4, framed: boolean, timber = false) {
  const inset = framed ? 0.032 : 0.004;
  const u0 = d.u0 + inset, u1 = d.u1 - inset, y0 = 0.012, y1 = d.y1 - (framed ? 0.034 : 0.006);
  const hingeU = d.hingeAtStart ? u0 : u1;
  const handleU = d.hingeAtStart ? u1 - 0.09 : u0 + 0.09;
  if (timber) {
    const t = 0.042;
    const wu0 = (u0 + u1) / 2 - 0.06 + (d.hingeAtStart ? 0.06 : -0.06), wu1 = wu0 + 0.12;
    P.box(M.benchPanel, u0, wu0, y0, y1, z - t, z, m, 'y');
    P.box(M.benchPanel, wu1, u1, y0, y1, z - t, z, m, 'y');
    P.box(M.benchPanel, wu0, wu1, y0, 0.42, z - t, z, m, 'y');
    P.box(M.benchPanel, wu0, wu1, 1.62, y1, z - t, z, m, 'y');
    P.box(M.glass, wu0, wu1, 0.42, 1.62, z - t / 2 - 0.004, z - t / 2 + 0.004, m);
    P.box(M.steel, handleU - 0.012, handleU + 0.012, 0.95, 1.12, z - t - 0.05, z - t, m);
    return;
  }
  P.box(M.doorGlass, u0, u1, y0, y1, z - 0.008, z, m);
  for (const hy of [0.25, y1 - 0.3]) P.box(M.steel, hingeU - 0.05, hingeU + 0.05, hy, hy + 0.09, z - 0.02, z + 0.012, m);
  // Bar handle outside, wooden grip inside.
  const top = Math.min(1.45, y1 - 0.15), bot = 0.75;
  P.box(M.steel, handleU - 0.012, handleU + 0.012, bot, top, z - 0.075, z - 0.051, m, 'y');
  for (const hy of [bot + 0.06, top - 0.06]) P.box(M.steel, handleU - 0.008, handleU + 0.008, hy - 0.008, hy + 0.008, z - 0.052, z, m);
  P.box(M.benchPanel, handleU - 0.015, handleU + 0.015, bot + 0.05, top - 0.05, z + 0.03, z + 0.055, m, 'y');
  for (const hy of [bot + 0.08, top - 0.08]) P.box(M.steel, handleU - 0.006, handleU + 0.006, hy - 0.006, hy + 0.006, z, z + 0.031, m);
}

function glassRun(P: Parts, M: KitMaterials, L: KitLayout, s: Segment) {
  const { prev, next } = neighbours(L, s);
  const w = L.wall, H = L.wallHeight;
  const startLine = prev.kind === 'glass' ? midLine(prev, w) : innerLine(prev, w);
  const endLine = next.kind === 'glass' ? midLine(next, w) : innerLine(next, w);
  const uA = along(s, intersect(midLine(s, w), startLine)!) + (prev.kind === 'glass' ? 0.002 : 0.004);
  const uB = along(s, intersect(midLine(s, w), endLine)!) - (next.kind === 'glass' ? 0.002 : 0.004);
  const m = segMatrix(s, 0, 0, L.floorY);
  const z0 = w / 2 - 0.004, z1 = w / 2 + 0.004;
  const panes: [number, number][] = s.door ? [[uA, s.door.u0 - 0.004], [s.door.u1 + 0.004, uB]] : [[uA, uB]];
  for (const [a, b] of panes) if (b - a > 0.02) P.box(M.glass, a, b, 0.012, H - 0.012, z0, z1, m);
  // Slim steel channels at foot and head (not across the door opening at the foot).
  const ch = (a: number, b: number, y0: number, y1: number) => P.box(M.steel, a, b, y0, y1, w / 2 - 0.016, w / 2 + 0.016, m);
  ch(uA, uB, H - 0.03, H);
  for (const [a, b] of panes) if (b - a > 0.02) ch(a, b, 0, 0.03);
  if (s.door) doorLeaf(P, M, s.door, z1, m, false);
}

export function buildStructure(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec) {
  for (const s of L.segments) {
    // Timber doors only fit solid walls; a door in a glass run is always glass.
    if (s.kind === 'solid') solidWall(P, M, L, s, spec.door === 'timber');
    else glassRun(P, M, L, s);
  }
  const inner = interiorPolygon(L);
  const top = L.floorY + L.wallHeight;
  // Ceiling boards and floor.
  P.add(M.ceiling, planCap(inner, top - 0.001, 'down'));
  P.add(M.floor, planCap(inner, L.floorY + 0.002, 'up'));
  if (!spec.extras.stoneFloor) duckboards(P, M, inner, L.floorY + 0.004);
  // Plinth under raised cabins.
  if (L.floorY > 0.05) {
    P.add(M.plinth, planSides(L.outline, 0, L.floorY));
  }
}

/** Removable floor grating: slats along x clipped to the interior polygon. */
function duckboards(P: Parts, M: KitMaterials, poly: Vec2[], y: number) {
  const zs = poly.map(p => p[1]);
  const zMin = Math.min(...zs) + 0.04, zMax = Math.max(...zs) - 0.04;
  const w = 0.07, gap = 0.018;
  for (let z = zMin; z + w <= zMax; z += w + gap) {
    const c = z + w / 2;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
      if ((a[1] - c) * (b[1] - c) <= 0 && a[1] !== b[1]) xs.push(a[0] + ((c - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    if (xs.length < 2) continue;
    const x0 = Math.min(...xs) + 0.04, x1 = Math.max(...xs) - 0.04;
    if (x1 - x0 > 0.1) P.box(M.benchPanel, x0, x1, y, y + 0.022, z, z + w);
  }
}

/** Flat roof slab with fascia, for indoor cabins. */
export function flatRoof(P: Parts, M: KitMaterials, L: KitLayout) {
  const y0 = L.floorY + L.wallHeight, y1 = y0 + 0.07;
  const o = L.outline.map(p => [p[0] * 1.004, p[1] * 1.004] as Vec2);
  P.add(M.wallOut, planSides(o, y0, y1));
  P.add(M.roof, planCap(o, y1, 'up'));
}
