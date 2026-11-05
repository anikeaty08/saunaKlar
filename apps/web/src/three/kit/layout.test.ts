import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CABIN_BODY, HEATER_HALF, bandPolygon, computeLayout, convexOverlap, cross, doorZone, footprint, squareAt, sub, type Vec2 } from './layout.ts';
import { segMatrix } from './parts.ts';
import { interiorView } from './interior.ts';
import { interiorPolygon } from './structure.ts';
import { DEFAULT_KIT_OPTIONS, type BenchLayout, type KitSpec, type SaunaForm } from './spec.ts';

const SIZES: Record<Exclude<SaunaForm, 'barrel'>, [number, number, number]> = {
  box: [2.0, 1.8, 2.1],
  panorama: [2.4, 2.0, 2.1],
  corner: [2.0, 2.0, 2.1],
  'glass-corner': [2.4, 2.0, 2.1],
  hex: [2.4, 2.4, 2.2],
  cabin: [2.4, 2.6, 2.3],
};

const spec = (form: Exclude<SaunaForm, 'barrel'>, layout: BenchLayout = 'auto'): KitSpec => {
  const [width, depth, height] = SIZES[form];
  return { ...structuredClone(DEFAULT_KIT_OPTIONS), bench: { ...DEFAULT_KIT_OPTIONS.bench, layout }, form, width, depth, height };
};

/** True when p lies inside (or on) the convex polygon. */
function inside(p: Vec2, poly: Vec2[], tol = 1e-6): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const c = cross(sub(poly[(i + 1) % poly.length]!, poly[i]!), sub(p, poly[i]!));
    if (Math.abs(c) < tol) continue;
    const s = Math.sign(c);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

const forms = Object.keys(SIZES) as Exclude<SaunaForm, 'barrel'>[];

describe('kit footprint', () => {
  it.each(forms)('%s: every wall frame points its +z into the room', form => {
    const { segments } = footprint(spec(form));
    for (const s of segments) {
      const m = segMatrix(s, s.length / 2, 0);
      const z = new THREE.Vector3(0, 0, 1).transformDirection(m);
      expect(z.x).toBeCloseTo(s.inward[0], 6);
      expect(z.z).toBeCloseTo(s.inward[1], 6);
      // Inward really points at the centre of the footprint.
      const mid: Vec2 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
      expect(-mid[0] * s.inward[0] - mid[1] * s.inward[1]).toBeGreaterThan(0);
    }
  });

  it.each(forms)('%s: keeps the model size', form => {
    const { outline } = footprint(spec(form));
    const xs = outline.map(p => p[0]), zs = outline.map(p => p[1]);
    const [w, d] = SIZES[form];
    // A garden house's porch is outside the sauna room.
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(form === 'cabin' ? d * CABIN_BODY : d, 3);
    if (form !== 'hex') expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(w, 3);
  });
});

describe('kit layout', () => {
  const cases = forms.flatMap(form => (['auto', 'straight', 'l', 'u'] as BenchLayout[]).map(layout => [form, layout] as const));

  it.each(cases)('%s / %s: benches stay inside the room and clear of the heater', (form, layout) => {
    const L = computeLayout(spec(form, layout));
    const { outline } = footprint(spec(form, layout));
    expect(L.bands.length).toBeGreaterThan(0);
    for (const band of L.bands) {
      const poly = bandPolygon(band, L.segments, L.wall);
      for (const p of poly) expect(inside(p, outline)).toBe(true);
      // The heater and its guard keep clear of every bench.
      expect(convexOverlap(squareAt(L.heater.position, L.heater.facing, HEATER_HALF), poly)).toBe(false);
    }
    expect(inside(L.heater.position, outline)).toBe(true);
  });

  it.each(forms)('%s: the door sits inside its wall', form => {
    const L = computeLayout(spec(form));
    const doors = L.segments.filter(s => s.door);
    expect(doors).toHaveLength(1);
    const s = doors[0]!;
    expect(s.door!.u0).toBeGreaterThan(0);
    expect(s.door!.u1).toBeLessThan(s.length);
  });

  it('gives a U layout room for the heater by shortening one bench', () => {
    const L = computeLayout(spec('panorama', 'u'));
    expect(L.benchWalls).toEqual(['back', 'left', 'right']);
    expect(L.heater.segment).toBeDefined();
  });

  it('keeps the upper bench at a comfortable height', () => {
    for (const form of forms) {
      const L = computeLayout(spec(form));
      expect(L.upperTop).toBeGreaterThanOrEqual(0.8);
      expect(L.wallHeight - L.upperTop).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('catalogue sizes', () => {
  // Every model in the demo catalogue and the platform seed, in each layout it offers.
  const models: [Exclude<SaunaForm, 'barrel'>, number, number, number, BenchLayout[]][] = [
    ['box', 1.4, 1.2, 2.0, ['straight', 'l']],
    ['box', 1.6, 1.4, 2.05, ['straight', 'l']],
    ['box', 2.0, 2.0, 2.2, ['straight', 'l', 'u']],
    ['panorama', 2.2, 1.8, 2.1, ['straight', 'l', 'u']],
    ['panorama', 2.4, 2.0, 2.1, ['straight', 'l', 'u']],
    ['corner', 1.6, 1.6, 2.05, ['straight', 'l']],
    ['corner', 1.8, 1.8, 2.05, ['straight', 'l']],
    ['hex', 2.4, 2.1, 2.6, ['straight', 'l', 'u']],
    ['cabin', 3.0, 2.4, 2.6, ['straight', 'l', 'u']],
    ['cabin', 2.8, 2.2, 2.2, ['straight', 'l', 'u']],
  ];
  const cases = models.flatMap(([form, w, d, h, layouts]) => layouts.map(layout => [form, w, d, h, layout] as const));
  it.each(cases)('%s %s × %s × %s / %s: a heater and benches fit', (form, width, depth, height, layout) => {
    const s: KitSpec = { ...structuredClone(DEFAULT_KIT_OPTIONS), bench: { ...DEFAULT_KIT_OPTIONS.bench, layout }, form, width, depth, height };
    const L = computeLayout(s);
    expect(L.heater.segment).toBeDefined();
    const door = L.segments.find(x => x.door)!;
    expect(convexOverlap(squareAt(L.heater.position, L.heater.facing, HEATER_HALF), doorZone(door, L.wall))).toBe(false);
    // A low garden house (2.2 m overall) gives the roof only 25 cm.
    expect(L.wallHeight).toBeGreaterThanOrEqual(1.8);
    for (const band of L.bands) expect(convexOverlap(squareAt(L.heater.position, L.heater.facing, HEATER_HALF), bandPolygon(band, L.segments, L.wall))).toBe(false);
  });
});

describe('inside view', () => {
  it.each(forms)('%s: the viewer stands inside the room, clear of the walls', form => {
    const s = spec(form);
    const v = interiorView(s);
    const L = computeLayout(s);
    const room = interiorPolygon(L);
    const eye: Vec2 = [v.eye[0], v.eye[2]];
    expect(inside(eye, room)).toBe(true);
    for (let i = 0; i < room.length; i++) {
      const a = room[i]!, b = room[(i + 1) % room.length]!;
      const e = sub(b, a);
      expect(Math.abs(cross(e, sub(eye, a))) / Math.hypot(e[0], e[1])).toBeGreaterThan(0.2);
    }
    expect(v.eye[1]).toBeLessThan(L.floorY + L.wallHeight - 0.2);
  });

  it('stands inside a barrel, whichever way it is turned', () => {
    for (const [width, depth] of [[2.0, 2.4], [2.2, 1.9]] as const) {
      const v = interiorView({ ...structuredClone(DEFAULT_KIT_OPTIONS), form: 'barrel', width, depth, height: 2.0 });
      expect(Math.abs(v.eye[0])).toBeLessThan(Math.max(width, depth) / 2);
      expect(Math.abs(v.eye[2])).toBeLessThan(Math.max(width, depth) / 2);
      expect(v.eye[1]).toBeGreaterThan(1);
    }
  });
});
