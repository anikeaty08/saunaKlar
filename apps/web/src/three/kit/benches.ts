import * as THREE from 'three';
import { SLAT_THICKNESS, along, bandPolygon, intersect, wallLine, type Band, type KitLayout, type Segment } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import { Parts, planCap, roundedSlat, segMatrix } from './parts.ts';
import type { KitSpec } from './spec.ts';

const SLAT_W = 0.09;
const SLAT_GAP = 0.012;
const T = SLAT_THICKNESS;
const LED_COLOR = '#ffcf94';

/** Where a line parallel to the wall, `offset` into the room, meets a clip line (distance along the wall). */
function uAt(s: Segment, wall: number, offset: number, clip: Band['startClip']): number {
  const p = intersect(wallLine(s, wall, offset), clip);
  return p ? along(s, p) : 0;
}

function seg(L: KitLayout, id: Band['segment']) {
  return L.segments.find(s => s.id === id)!;
}

/** Evenly spaced members across a depth: [start, end] offsets. */
function divide(o0: number, o1: number, width: number, gap: number): [number, number][] {
  const depth = o1 - o0;
  const n = Math.max(1, Math.round((depth + gap) / (width + gap)));
  const w = (depth - (n - 1) * gap) / n;
  return Array.from({ length: n }, (_, k) => [o0 + k * (w + gap), o0 + k * (w + gap) + w] as [number, number]);
}

function bandEnds(L: KitLayout, b: Band, offset: number): [number, number] {
  const s = seg(L, b.segment);
  let a = uAt(s, L.wall, offset, b.startClip);
  let e = uAt(s, L.wall, offset, b.endClip);
  // Exposed ends are capped by an end panel: the seat stops on its inside.
  if (b.startExposed) a += T + 0.004;
  if (b.endExposed) e -= T + 0.004;
  return [a + 0.002, e - 0.002];
}

function seat(P: Parts, M: KitMaterials, L: KitLayout, b: Band, spec: KitSpec) {
  const s = seg(L, b.segment);
  const m = segMatrix(s, 0, L.wall, L.floorY);
  const slats = divide(b.o0 + 0.01, b.o1, SLAT_W, SLAT_GAP);
  slats.forEach(([z0, z1], k) => {
    const [u0, u1] = bandEnds(L, b, (z0 + z1) / 2);
    if (u1 - u0 < 0.05) return;
    const front = k === slats.length - 1;
    if (front && spec.bench.edge === 'rounded') {
      const g = roundedSlat(u1 - u0, z1 - z0, T);
      g.translate(u0, b.top - T / 2, (z0 + z1) / 2);
      P.add(M.bench, g, m);
    } else {
      P.box(M.bench, u0, u1, b.top - T, b.top, z0, z1, m);
    }
  });
  // Bearers under the slats, every 60 cm, seen through the gaps.
  const [ua, ub] = bandEnds(L, b, (b.o0 + b.o1) / 2);
  const count = Math.max(2, Math.ceil((ub - ua) / 0.6) + 1);
  for (let i = 0; i < count; i++) {
    const u = ua + 0.04 + ((ub - ua - 0.08) * i) / (count - 1);
    P.box(M.benchPanel, u - 0.02, u + 0.02, b.top - T - 0.045, b.top - T, b.o0 + 0.02, b.o1 - 0.03, m, 'z');
  }
  // Under the slats: LED glow (light lines in the gaps) or shadow.
  const poly = bandPolygon(b, L.segments, L.wall);
  P.add(spec.lights.underBench ? M.led : M.gap, planCap(poly, L.floorY + b.top - T - 0.05, 'up'));
  if (spec.lights.underBench) {
    // Strip under the front lip and a pool of light on the floor below.
    const [fa, fb] = bandEnds(L, b, b.o1 - 0.05);
    P.box(M.led, fa + 0.05, fb - 0.05, b.top - T - 0.062, b.top - T - 0.052, b.o1 - 0.06, b.o1 - 0.05, m);
    const mid = (fa + fb) / 2;
    const p = segMatrix(s, mid, L.wall + b.o1 + 0.05, L.floorY + 0.25);
    const e = p.elements;
    P.lights.push({ position: [e[12]!, e[13]!, e[14]!], color: LED_COLOR, intensity: 0.5, distance: 1.6 });
  }
}

/** The face under a band's front edge: boards, a mitred frame, or open legs. */
function front(P: Parts, M: KitMaterials, L: KitLayout, b: Band, spec: KitSpec, bottom: number) {
  const s = seg(L, b.segment);
  const m = segMatrix(s, 0, L.wall, L.floorY);
  const z1 = b.o1 - 0.012, z0 = z1 - 0.022;
  const [u0, u1] = bandEnds(L, b, (z0 + z1) / 2);
  const ua = b.startExposed ? u0 - T : u0, ub = b.endExposed ? u1 + T : u1;
  const yTop = b.top - T;
  const style = spec.bench.front;
  if (style === 'boards') {
    const boards = divide(bottom + 0.05, yTop, 0.11, 0.008);
    for (const [y0, y1] of boards) P.box(M.benchPanel, ua, ub, y0, y1, z0, z1, m);
    P.box(M.gap, ua + 0.02, ub - 0.02, bottom, bottom + 0.05, z0 - 0.03, z0 - 0.01, m);
    return;
  }
  // Frame: a rail under the lip and legs at the exposed ends, mitred at the top corner.
  const rail = 0.075, leg = 0.055;
  P.box(M.benchPanel, ua, ub, yTop - rail, yTop, z0 - 0.01, z1, m);
  const legs: number[] = [];
  if (b.startExposed || style === 'open') legs.push(ua);
  if (b.endExposed || style === 'open') legs.push(ub - leg);
  if (style === 'open') {
    const span = ub - ua;
    const extra = Math.floor(span / 1.2);
    for (let i = 1; i <= extra; i++) legs.push(ua + (span * i) / (extra + 1) - leg / 2);
  }
  for (const u of legs) {
    P.box(M.benchPanel, u, u + leg, bottom + 0.02, yTop - rail, z0 - 0.01, z1, m, 'y');
    P.box(M.benchPanel, u + 0.008, u + leg - 0.008, bottom, bottom + 0.02, z0, z1 - 0.008, m); // foot
  }
  if (style === 'framed') {
    // Inset horizontal boards inside the frame, kept off the floor.
    const fa = legs.includes(ua) ? ua + leg : ua, fb = legs.includes(ub - leg) ? ub - leg : ub;
    const boards = divide(bottom + 0.16, yTop - rail - 0.01, 0.11, 0.008);
    for (const [y0, y1] of boards) P.box(M.benchPanel, fa + 0.004, fb - 0.004, y0, y1, z0 - 0.022, z0 - 0.002, m);
  }
}

/** End panel where a bench run ends in the open or against glass. */
function endPanel(P: Parts, M: KitMaterials, L: KitLayout, b: Band, spec: KitSpec, atStart: boolean, depthFrom: number) {
  const s = seg(L, b.segment);
  const m = segMatrix(s, 0, L.wall, L.floorY);
  const u = (() => {
    const [a, e] = bandEnds(L, b, (depthFrom + b.o1) / 2);
    return atStart ? a - T - 0.002 : e + 0.002;
  })();
  const z0 = depthFrom, z1 = b.o1;
  const style = spec.bench.end;
  if (style === 'waterfall') {
    // Vertical slats from a plinth board up to the seat, as on the owner's photographed cabins.
    P.box(M.benchPanel, u, u + T, 0, 0.06, z0, z1, m);
    for (const [a, e] of divide(z0, z1, 0.072, 0.012)) P.box(M.bench, u, u + T, 0.06, b.top, a, e, m, 'y');
    return;
  }
  if (style === 'framed') {
    const leg = 0.055;
    P.box(M.benchPanel, u, u + T, 0, b.top, z1 - leg, z1, m, 'y');
    P.box(M.benchPanel, u, u + T, 0, b.top, z0, z0 + leg, m, 'y');
    P.box(M.benchPanel, u, u + T, b.top - 0.075, b.top, z0 + leg, z1 - leg, m, 'z');
    for (const [a, e] of divide(z0 + leg + 0.004, z1 - leg - 0.004, 0.1, 0.006)) P.box(M.benchPanel, u + 0.006, u + T - 0.006, 0.02, b.top - 0.08, a, e, m, 'y');
    return;
  }
  P.box(M.benchPanel, u, u + T, 0, b.top, z0, z1, m, 'y');
}

/** Backrest boards standing off the wall, continuous or as separate panels, with the optional LED wash. */
function backrest(P: Parts, M: KitMaterials, L: KitLayout, b: Band, spec: KitSpec, gapAt: number | null) {
  if (spec.backrest === 'none') return;
  const s = seg(L, b.segment);
  const m = segMatrix(s, 0, L.wall, L.floorY);
  const z0 = 0.026, z1 = 0.048;
  let [ua, ub] = bandEnds(L, b, (z0 + z1) / 2);
  if (b.startExposed) ua -= T;
  if (b.endExposed) ub += T;
  const y0 = b.top + 0.17;
  const rows: [number, number][] = [[y0, y0 + 0.09], [y0 + 0.12, y0 + 0.21], [y0 + 0.24, y0 + 0.33]];
  const top = rows[2]![1];
  if (top > L.wallHeight - 0.15) return;
  // Runs: one continuous run, or panels of about 0.9 m; leave room for an IR panel.
  let runs: [number, number][] = [[ua, ub]];
  if (gapAt !== null) runs = [[ua, gapAt - 0.21], [gapAt + 0.21, ub]];
  if (spec.backrest === 'panels') {
    runs = runs.flatMap(([a, e]) => {
      const n = Math.max(1, Math.round((e - a) / 0.95));
      const w = (e - a - (n - 1) * 0.16) / n;
      return Array.from({ length: n }, (_, k) => [a + k * (w + 0.16), a + k * (w + 0.16) + w] as [number, number]);
    });
  }
  for (const [a, e] of runs) {
    if (e - a < 0.2) continue;
    for (const [r0, r1] of rows) {
      if (r1 === top && spec.bench.edge === 'rounded') {
        const g = roundedSlat(e - a, r1 - r0, z1 - z0);
        // Lay the profile upright: nose on top.
        g.rotateX(-Math.PI / 2);
        g.translate(a, (r0 + r1) / 2, (z0 + z1) / 2);
        P.add(M.bench, g, m);
      } else {
        P.box(M.bench, a, e, r0, r1, z0, z1, m);
      }
    }
    // Brackets.
    for (const u of [a + 0.08, e - 0.1]) P.box(M.benchPanel, u, u + 0.02, y0 + 0.02, top - 0.02, 0.004, z0, m, 'y');
    // Hidden LED strip behind the top board.
    if (spec.lights.backrest) P.box(M.led, a + 0.03, e - 0.03, top - 0.012, top - 0.004, 0.012, 0.022, m);
  }
  if (spec.lights.backrest) {
    for (const [a, e] of runs) washOnWall(P, M, L, s, a, e, top - 0.03, 0.7);
    const mid = (ua + ub) / 2;
    const p = segMatrix(s, mid, L.wall + 0.35, L.floorY + top + 0.2).elements;
    P.lights.push({ position: [p[12]!, p[13]!, p[14]!], color: LED_COLOR, intensity: 0.55, distance: 2.2 });
  }
}

/** Additive warm glow painted on a wall face between u0 and u1, rising from y (0..1 UVs for the gradient). */
export function washOnWall(P: Parts, M: KitMaterials, L: KitLayout, s: Segment, u0: number, u1: number, y: number, h: number) {
  const g = new THREE.PlaneGeometry(u1 - u0, h);
  g.translate((u0 + u1) / 2, y + h / 2, 0);
  P.add(M.wash, g, segMatrix(s, 0, L.wall + 0.003, L.floorY));
}

export function buildBenches(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec, irWall: Band['segment'] | null): { irAt: number | null } {
  let irAt: number | null = null;
  for (const b of L.bands) {
    seat(P, M, L, b, spec);
    front(P, M, L, b, spec, 0);
    if (b.level === 'upper') {
      let gap: number | null = null;
      if (spec.extras.irPanel && irWall === b.segment) {
        const [a, e] = bandEnds(L, b, 0.04);
        gap = (a + e) / 2;
        irAt = gap;
      }
      backrest(P, M, L, b, spec, gap);
    }
    if (b.startExposed) endPanel(P, M, L, b, spec, true, b.o0);
    if (b.endExposed) endPanel(P, M, L, b, spec, false, b.o0);
  }
  return { irAt };
}
