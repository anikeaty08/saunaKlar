/**
 * Plan layout of a sauna built from the construction kit. Pure maths (no
 * three.js), so it is unit-tested and shared by every builder.
 *
 * Plan frame, metres: origin at the centre of the footprint, x to the right,
 * z towards the front (the side the camera starts on). A footprint is a convex
 * polygon of wall segments; each segment is solid, glass, or carries a door.
 * Benches are bands parallel to a wall. Where two bench bands meet in a corner
 * they are mitred on the corner's bisector; where a band runs into a wall
 * without a bench it stops at that wall (or in front of that wall's bench).
 */
import type { BenchLayout, KitSpec } from './spec.ts';

export type Vec2 = [number, number];
export type SegmentKind = 'solid' | 'glass';
export type SegmentId = 'back' | 'right' | 'front' | 'left' | 'diagonal' | 'back-left' | 'back-right' | 'front-left' | 'front-right';

export interface Opening {
  /** Distance from the segment start (m). */
  u0: number;
  u1: number;
  /** Sill and head height (m). Doors start at the floor. */
  y0: number;
  y1: number;
}

export interface Segment {
  id: SegmentId;
  kind: SegmentKind;
  a: Vec2;
  b: Vec2;
  length: number;
  /** Unit vector a → b. */
  dir: Vec2;
  /** Unit vector into the cabin. */
  inward: Vec2;
  door?: Opening & { hingeAtStart: boolean };
  windows: Opening[];
}

export interface Band {
  /** Wall segment the band runs along. */
  segment: SegmentId;
  level: 'upper' | 'lower';
  /** Distance of the band's back and front edge from the interior wall face (m). */
  o0: number;
  o1: number;
  /** Top of the slats (m above the cabin floor). */
  top: number;
  /** End lines (point + direction) the slats are clipped against. */
  startClip: Line;
  endClip: Line;
  /** True when that end is visible (runs into glass or stops in the open). */
  startExposed: boolean;
  endExposed: boolean;
}

export interface Line {
  p: Vec2;
  d: Vec2;
}

export interface Placement {
  position: Vec2;
  /** Unit vector the fixture faces (into the room for wall fixtures). */
  facing: Vec2;
  segment?: SegmentId;
  /** Distance along the segment (m), for wall fixtures. */
  u?: number;
}

export interface KitLayout {
  width: number;
  depth: number;
  /** Interior floor level above the ground (m). */
  floorY: number;
  /** Height of the walls above the cabin floor (m). */
  wallHeight: number;
  wall: number;
  segments: Segment[];
  outline: Vec2[];
  benchWalls: SegmentId[];
  bands: Band[];
  upperTop: number;
  heater: Placement;
  /** Free wall for the thermometer, salt wall, aroma. */
  freeWall: SegmentId | null;
}

// ---------------------------------------------------------------- vector maths

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2) => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2) => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2) => Math.hypot(a[0], a[1]);
export const norm = (a: Vec2): Vec2 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l];
};

/** Intersection of two lines, or null when they are parallel. */
export function intersect(l1: Line, l2: Line): Vec2 | null {
  const den = cross(l1.d, l2.d);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(l2.p, l1.p), l2.d) / den;
  return add(l1.p, mul(l1.d, t));
}

/** The line parallel to a segment's interior face, `offset` metres into the room. */
export function wallLine(seg: Segment, wall: number, offset: number): Line {
  const inset = (seg.kind === 'glass' ? wall / 2 + 0.006 : wall) + offset;
  return { p: add(seg.a, mul(seg.inward, inset)), d: seg.dir };
}

/** Position along a segment's interior line, as distance from its start. */
export function along(seg: Segment, p: Vec2): number {
  return dot(sub(p, seg.a), seg.dir);
}

// ---------------------------------------------------------------- footprints

function buildSegments(points: Vec2[], ids: SegmentId[], kinds: SegmentKind[]): Segment[] {
  const c: Vec2 = mul(points.reduce((s, p) => add(s, p), [0, 0] as Vec2), 1 / points.length);
  return points.map((a, i) => {
    const b = points[(i + 1) % points.length]!;
    const dir = norm(sub(b, a));
    let inward: Vec2 = [-dir[1], dir[0]];
    // Convex footprints: the inward normal points towards the centroid.
    if (dot(inward, sub(c, a)) < 0) inward = [dir[1], -dir[0]];
    return { id: ids[i]!, kind: kinds[i]!, a, b, length: len(sub(b, a)), dir, inward, windows: [] };
  });
}

export function footprint(spec: Pick<KitSpec, 'form' | 'width' | 'depth'>): { segments: Segment[]; outline: Vec2[] } {
  const W = spec.width, D = spec.depth;
  const x = W / 2, z = D / 2;
  if (spec.form === 'hex') {
    // Six sides with a flat face to the front, stretched to the catalogue width and depth.
    const pts: Vec2[] = [0, 1, 2, 3, 4, 5].map(k => {
      const t = Math.PI - (k * Math.PI) / 3; // start at the left point, go round the back
      return [Math.cos(t) * x, (-Math.sin(t) * z) / Math.sin(Math.PI / 3)] as Vec2;
    });
    // pts: left, back-left corner, back-right corner, right, front-right corner, front-left corner
    const ids: SegmentId[] = ['back-left', 'back', 'back-right', 'front-right', 'front', 'front-left'];
    return { segments: buildSegments(pts, ids, ['solid', 'solid', 'solid', 'solid', 'solid', 'solid']), outline: pts };
  }
  if (spec.form === 'corner') {
    const c = Math.min(W, D) * 0.36;
    const pts: Vec2[] = [[-x, -z], [x, -z], [x, z - c], [x - c, z], [-x, z]];
    const ids: SegmentId[] = ['back', 'right', 'diagonal', 'front', 'left'];
    return { segments: buildSegments(pts, ids, ['solid', 'glass', 'glass', 'glass', 'solid']), outline: pts };
  }
  if (spec.form === 'glass-corner') {
    // Rectangular room: glass front, solid timber back/left/right (the right wall has a glass panel at the front corner).
    const pts: Vec2[] = [[-x, -z], [x, -z], [x, z], [-x, z]];
    return { segments: buildSegments(pts, ['back', 'right', 'front', 'left'], ['solid', 'solid', 'glass', 'solid']), outline: pts };
  }
  // A garden house is a sauna room behind a covered porch.
  const zf = spec.form === 'cabin' ? -z + D * CABIN_BODY : z;
  const pts: Vec2[] = [[-x, -z], [x, -z], [x, zf], [-x, zf]];
  const ids: SegmentId[] = ['back', 'right', 'front', 'left'];
  const front: SegmentKind = spec.form === 'panorama' ? 'glass' : 'solid';
  return { segments: buildSegments(pts, ids, ['solid', 'solid', front, 'solid']), outline: pts };
}

// ---------------------------------------------------------------- dimensions

export const DOOR_WIDTH = 0.7;
/** Share of a garden house's depth taken by the sauna room (the rest is the porch). */
export const CABIN_BODY = 0.72;
export const UPPER_DEPTH = 0.6;
export const LOWER_DEPTH = 0.45;
export const SLAT_THICKNESS = 0.028;
/** Lowest inside wall height for a garden house: a person stands on the upper bench's step. */
export const MIN_ROOM_HEIGHT = 1.95;

function benchWallsFor(form: KitSpec['form'], layout: BenchLayout, interiorWidth: number): SegmentId[] {
  const pick: Exclude<BenchLayout, 'auto'> = layout !== 'auto' ? layout : form === 'hex' ? 'u' : form === 'box' && interiorWidth < 1.5 ? 'straight' : 'l';
  if (form === 'hex') return pick === 'straight' ? ['back'] : pick === 'l' ? ['back', 'back-left'] : ['back-left', 'back', 'back-right'];
  if (form === 'corner') return pick === 'straight' ? ['back'] : ['back', 'left'];
  return pick === 'straight' ? ['back'] : pick === 'l' ? ['back', 'left'] : ['back', 'left', 'right'];
}

/** Clip line at the corner a segment shares with its neighbour. */
function cornerClip(seg: Segment, nb: Segment, wall: number, segBand: [number, number] | null, nbBand: [number, number] | null, nbStop: number): Line {
  if (segBand && nbBand) {
    // Mitre: through the interior corner and the point where both bands' front edges meet.
    const inner = intersect(wallLine(seg, wall, 0), wallLine(nb, wall, 0))!;
    const outer = intersect(wallLine(seg, wall, segBand[1]), wallLine(nb, wall, nbBand[1]))!;
    return { p: inner, d: norm(sub(outer, inner)) };
  }
  return wallLine(nb, wall, nbStop);
}

export function computeLayout(spec: KitSpec): KitLayout {
  const { segments, outline } = footprint(spec);
  const wall = spec.form === 'hex' || spec.form === 'cabin' ? 0.07 : 0.045;
  const floorY = spec.form === 'hex' || spec.form === 'cabin' ? 0.12 : 0.02;
  // Garden houses keep at least MIN_ROOM_HEIGHT inside; the roof takes what is left of the model height.
  const pitched = spec.form === 'hex' || spec.form === 'cabin';
  const roof = pitched ? Math.min(spec.height * (spec.form === 'hex' ? 0.3 : 0.32), Math.max(0.25, spec.height - floorY - MIN_ROOM_HEIGHT)) : 0.08;
  const wallHeight = spec.height - roof - floorY;
  const byId = new Map(segments.map(s => [s.id, s]));
  const interiorWidth = spec.width - 2 * wall;

  // Door: on the front (or the diagonal of a corner cabin), near the right-hand end.
  const doorSeg = byId.get(spec.form === 'corner' ? 'diagonal' : 'front')!;
  const doorH = Math.min(1.9, wallHeight - 0.12);
  // Compact cabins get a narrower door so the heater still fits beside it.
  const doorW = Math.min(DOOR_WIDTH, doorSeg.length - 0.2, Math.max(0.6, doorSeg.length * 0.45));
  if (spec.form === 'glass-corner') {
    // Front runs right → left: the door sits left of centre, hinged on its left, clear of the bench end at the left wall.
    const u1 = doorSeg.length - 0.75;
    doorSeg.door = { u0: u1 - doorW, u1, y0: 0, y1: doorH, hingeAtStart: false };
    const r = byId.get('right')!;
    r.windows.push({ u0: r.length * 0.55, u1: r.length - 0.06, y0: 0.02, y1: wallHeight - 0.12 });
  } else if (spec.form === 'corner' || spec.form === 'hex') {
    const u0 = (doorSeg.length - doorW) / 2;
    doorSeg.door = { u0, u1: u0 + doorW, y0: 0, y1: doorH, hingeAtStart: false };
  } else {
    // Front segments run right → left, so the right-hand end is the start.
    const u0 = Math.min(0.12 + wall, doorSeg.length * 0.1);
    doorSeg.door = { u0, u1: u0 + doorW, y0: 0, y1: doorH, hingeAtStart: true };
  }
  if (spec.form === 'cabin') {
    const s = byId.get('right')!;
    s.windows.push({ u0: s.length * 0.3, u1: s.length * 0.7, y0: wallHeight * 0.5, y1: wallHeight * 0.82 });
  }
  if (spec.form === 'hex') {
    for (const id of ['front-left', 'front-right'] as const) {
      const s = byId.get(id)!;
      s.windows.push({ u0: s.length * 0.25, u1: s.length * 0.75, y0: wallHeight * 0.45, y1: wallHeight * 0.85 });
    }
  }

  // Benches.
  const benchWalls = benchWallsFor(spec.form, spec.bench.layout, interiorWidth).filter(id => byId.has(id));
  const upperTop = Math.min(1.02, Math.max(0.8, wallHeight - 1.05));
  const lowerTop = Math.min(0.48, upperTop - 0.38);
  const upper = new Map<SegmentId, [number, number]>();
  for (const id of benchWalls) {
    const s = byId.get(id)!;
    const room = Math.min(s.length, spec.form === 'hex' ? 99 : (s.id === 'left' || s.id === 'right' ? spec.depth : spec.width)) - 2 * wall;
    upper.set(id, [0, Math.min(UPPER_DEPTH, Math.max(0.42, room * 0.32))]);
  }
  // The lower bench runs along the longest bench wall when the room in front of it allows.
  const primary = [...benchWalls].sort((p, q) => byId.get(q)!.length - byId.get(p)!.length)[0];
  const n = segments.length;
  const idx = (id: SegmentId) => segments.findIndex(s => s.id === id);

  const bands: Band[] = [];
  const makeBand = (id: SegmentId, level: 'upper' | 'lower', o0: number, o1: number, top: number) => {
    const s = byId.get(id)!;
    const i = idx(id);
    const prev = segments[(i + n - 1) % n]!;
    const next = segments[(i + 1) % n]!;
    const sb: [number, number] = [o0, o1];
    const pb = level === 'upper' ? upper.get(prev.id) ?? null : null;
    const nb = level === 'upper' ? upper.get(next.id) ?? null : null;
    // A lower band stops in front of a neighbouring upper bench; otherwise at the wall.
    const stopPrev = level === 'lower' && upper.has(prev.id) ? upper.get(prev.id)![1] : 0.004;
    const stopNext = level === 'lower' && upper.has(next.id) ? upper.get(next.id)![1] : 0.004;
    bands.push({
      segment: id,
      level,
      o0,
      o1,
      top,
      startClip: cornerClip(s, prev, wall, pb ? sb : null, pb, stopPrev),
      endClip: cornerClip(s, next, wall, nb ? sb : null, nb, stopNext),
      startExposed: !pb && (prev.kind === 'glass' || Boolean(prev.door)),
      endExposed: !nb && (next.kind === 'glass' || Boolean(next.door)),
    });
  };
  for (const id of benchWalls) makeBand(id, 'upper', upper.get(id)![0], upper.get(id)![1], upperTop);
  if (primary && spec.bench.levels > 1) {
    const s = byId.get(primary)!;
    const facing = segments.find(o => o !== s && Math.abs(dot(o.inward, s.inward) + 1) < 0.2);
    const across = facing ? Math.abs(dot(sub(facing.a, s.a), s.inward)) - 2 * wall : 2;
    const up = upper.get(primary)![1];
    const lowerDepth = Math.min(LOWER_DEPTH, across - up - 0.6);
    if (lowerDepth >= 0.28) makeBand(primary, 'lower', up, up + lowerDepth, lowerTop);
  }

  // Heater: against a wall without a bench, as far from the door as fits.
  let heater = placeHeater(segments, bands, wall, benchWalls, doorSeg);
  if (!heater.segment) {
    // No free wall is long enough (a U layout, say): shorten the bench end in the
    // corner farthest from the door and stand the heater there.
    const doorMid = add(doorSeg.a, mul(doorSeg.dir, (doorSeg.door!.u0 + doorSeg.door!.u1) / 2));
    const stop = 2 * HEATER_HALF + 0.18;
    const ends: { segment: SegmentId; end: boolean; nb: Segment; d: number }[] = [];
    for (const id of benchWalls) {
      const sg = byId.get(id)!;
      const i = idx(id);
      for (const end of [false, true]) {
        const nb = segments[(i + (end ? 1 : n - 1)) % n]!;
        if (!benchWalls.includes(nb.id)) ends.push({ segment: id, end, nb, d: len(sub(end ? sg.b : sg.a, doorMid)) });
      }
    }
    // One bench end at a time, the one farthest from the door first.
    for (const e of ends.sort((p, q) => q.d - p.d)) {
      for (const band of bands.filter(b => b.segment === e.segment)) {
        const clip = wallLine(e.nb, wall, stop);
        if (e.end) Object.assign(band, { endClip: clip, endExposed: true });
        else Object.assign(band, { startClip: clip, startExposed: true });
      }
      heater = placeHeater(segments, bands, wall, benchWalls, doorSeg);
      if (heater.segment) break;
    }
    if (!heater.segment && bands.some(b => b.level === 'lower')) {
      // Still too tight: a small room gives up the lower bench.
      bands.splice(0, bands.length, ...bands.filter(b => b.level === 'upper'));
      heater = placeHeater(segments, bands, wall, benchWalls, doorSeg);
    }
  }
  const freeWall = segments.find(s => s.kind === 'solid' && !benchWalls.includes(s.id) && s.id !== heater.segment && !s.door)?.id
    ?? segments.find(s => s.kind === 'solid' && !benchWalls.includes(s.id) && !s.door)?.id
    ?? null;

  return { width: spec.width, depth: spec.depth, floorY, wallHeight, wall, segments, outline, benchWalls, bands, upperTop, heater, freeWall };
}

/** Plan polygon of a band (for overlap tests). */
export function bandPolygon(band: Band, segments: Segment[], wall: number): Vec2[] {
  const s = segments.find(x => x.id === band.segment)!;
  const back = wallLine(s, wall, band.o0);
  const front = wallLine(s, wall, band.o1);
  return [intersect(back, band.startClip)!, intersect(back, band.endClip)!, intersect(front, band.endClip)!, intersect(front, band.startClip)!];
}

/** Depth of the walkway kept clear inside the door. */
export const DOOR_CLEARANCE = 0.5;

/** Plan rectangle just inside the door that nothing may stand in. */
export function doorZone(s: Segment, wall: number): Vec2[] {
  const d = s.door!;
  const inner = wallLine(s, wall, 0);
  const at = (u: number, o: number) => add(add(inner.p, mul(s.dir, u)), mul(s.inward, o));
  return [at(d.u0, 0), at(d.u1, 0), at(d.u1, DOOR_CLEARANCE), at(d.u0, DOOR_CLEARANCE)];
}

/** Half the side of the square a heater and its guard stand on. */
export const HEATER_HALF = 0.26;

/** Square of half-size h centred on p, turned to face `facing`. */
export function squareAt(p: Vec2, facing: Vec2, h: number): Vec2[] {
  const side: Vec2 = [-facing[1], facing[0]];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => add(p, add(mul(side, a! * h), mul(facing, b! * h))));
}

/** Separating-axis test for two convex polygons; touching edges do not count. */
export function convexOverlap(a: Vec2[], b: Vec2[], eps = 1e-6): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length]!, poly[i]!);
      const axis: Vec2 = [-e[1], e[0]];
      const pa = a.map(p => dot(p, axis)), pb = b.map(p => dot(p, axis));
      if (Math.max(...pa) <= Math.min(...pb) + eps || Math.max(...pb) <= Math.min(...pa) + eps) return false;
    }
  }
  return true;
}

function placeHeater(segments: Segment[], bands: Band[], wall: number, benchWalls: SegmentId[], doorSeg: Segment): Placement {
  const polys = bands.map(b => bandPolygon(b, segments, wall));
  const zone = doorSeg.door ? doorZone(doorSeg, wall) : null;
  const doorMid = doorSeg.door ? add(doorSeg.a, mul(doorSeg.dir, (doorSeg.door.u0 + doorSeg.door.u1) / 2)) : doorSeg.a;
  let best: { p: Placement; score: number } | null = null;
  for (const s of segments) {
    if (benchWalls.includes(s.id)) continue;
    for (let f = 0.12; f <= 0.88; f += 0.04) {
      const u = s.length * f;
      const line = wallLine(s, wall, HEATER_HALF + 0.06);
      const p = add(line.p, mul(s.dir, u));
      // Clear of every bench (with a 10 cm safety gap) and of the other walls.
      if (polys.some(poly => convexOverlap(squareAt(p, s.inward, HEATER_HALF + 0.1), poly))) continue;
      // The door may open right beside the heater, but its walkway stays clear.
      if (zone && convexOverlap(squareAt(p, s.inward, HEATER_HALF + 0.02), zone)) continue;
      const inRoom = segments.every(o => dot(sub(p, wallLine(o, wall, 0).p), o.inward) >= HEATER_HALF - 0.01);
      if (!inRoom) continue;
      // Prefer away from the door, then close to a bench end (as in real cabins).
      const score = len(sub(p, doorMid)) + (s.kind === 'solid' ? 0.4 : 0);
      if (!best || score > best.score) best = { p: { position: p, facing: s.inward, segment: s.id, u }, score };
    }
  }
  if (best) return best.p;
  // Nothing fits (very small cabins): centre of the free floor.
  return { position: [0, 0.25], facing: [0, -1] };
}
