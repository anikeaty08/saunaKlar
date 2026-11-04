import * as THREE from 'three';
import { add, mul, type KitLayout, type Segment, type Vec2 } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import { Parts, facingMatrix, rng, segMatrix } from './parts.ts';
import type { KitSpec } from './spec.ts';
import { interiorPolygon, neighbours } from './structure.ts';

/** A heap of sauna stones inside a rectangle, centred on (0, y, 0). */
function stones(P: Parts, M: KitMaterials, m: THREE.Matrix4, w: number, d: number, y: number, seed: number) {
  const r = rng(seed);
  const n = Math.round((w * d) / 0.0045);
  for (let i = 0; i < n; i++) {
    const g = new THREE.DodecahedronGeometry(0.03 + r() * 0.025, 0);
    g.scale(1, 0.7 + r() * 0.3, 1 + r() * 0.3);
    g.rotateY(r() * Math.PI);
    const x = (r() - 0.5) * (w - 0.05), z = (r() - 0.5) * (d - 0.05);
    const hump = 1 - (Math.abs(x) / w + Math.abs(z) / d);
    g.translate(x, y + r() * 0.05 + hump * 0.06, z);
    P.add(M.stones, g, m);
  }
}

export function heater(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec) {
  const m = facingMatrix(L.heater.position, L.heater.facing, L.floorY);
  const kind = spec.heater;
  if (kind === 'stove') {
    // Wood stove: black body, glowing glass door, flue through the roof.
    P.box(M.black, -0.24, 0.24, 0.06, 0.72, -0.22, 0.22, m);
    P.box(M.black, -0.2, 0.2, 0, 0.06, -0.18, 0.18, m);
    P.box(M.fire, -0.13, 0.13, 0.2, 0.42, 0.221, 0.224, m);
    P.box(M.steel, -0.15, 0.15, 0.18, 0.2, 0.22, 0.235, m);
    P.box(M.steel, -0.25, 0.25, 0.72, 0.75, -0.23, 0.23, m);
    stones(P, M, m, 0.44, 0.4, 0.75, 9);
    const flue = new THREE.CylinderGeometry(0.065, 0.065, L.wallHeight + 0.6, 20);
    flue.translate(0.14, 0.75 + (L.wallHeight + 0.6) / 2, -0.12);
    P.add(M.black, flue, m);
    P.lights.push({ position: [L.heater.position[0] + L.heater.facing[0] * 0.4, L.floorY + 0.35, L.heater.position[1] + L.heater.facing[1] * 0.4], color: '#ff7a2e', intensity: 0.6, distance: 1.8 });
  } else if (kind === 'storage') {
    // Tall heat-storage tower: perforated steel column full of stones.
    const body = new THREE.CylinderGeometry(0.22, 0.22, 0.86, 28, 1, true);
    body.translate(0, 0.43 + 0.05, 0);
    P.add(M.black, body, m);
    const rim = new THREE.TorusGeometry(0.22, 0.012, 6, 28);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, 0.91, 0);
    P.add(M.steel, rim, m);
    P.box(M.black, -0.16, 0.16, 0, 0.05, -0.16, 0.16, m);
    stones(P, M, m, 0.36, 0.36, 0.86, 5);
  } else {
    // Floor-standing electric heater with a steel stone basket.
    const big = kind === 'electric-large';
    const w = big ? 0.46 : 0.4, h = big ? 0.78 : 0.7, d = big ? 0.34 : 0.3;
    P.box(M.black, -w / 2, w / 2, 0.08, h, -d / 2, d / 2, m);
    for (const sx of [-1, 1]) P.box(M.black, sx * (w / 2 - 0.05) - 0.02, sx * (w / 2 - 0.05) + 0.02, 0, 0.08, -d / 2 + 0.03, d / 2 - 0.03, m);
    P.box(M.steel, -w / 2 - 0.004, w / 2 + 0.004, h, h + 0.02, -d / 2 - 0.004, d / 2 + 0.004, m);
    P.box(M.steel, -w / 2 + 0.04, -w / 2 + 0.05, 0.2, h - 0.12, d / 2, d / 2 + 0.004, m);
    for (const x of [w / 2 - 0.1, w / 2 - 0.05]) {
      const knob = new THREE.CylinderGeometry(0.016, 0.016, 0.02, 16);
      knob.rotateX(Math.PI / 2);
      knob.translate(x, h - 0.08, d / 2 + 0.01);
      P.add(M.steel, knob, m);
    }
    stones(P, M, m, w - 0.02, d - 0.02, h + 0.02, big ? 7 : 3);
  }
  // Wooden guard of vertical slats on the open sides, on two hidden rails.
  const gw = kind === 'storage' ? 0.3 : 0.32, gd = 0.3, gh = 0.82, sw = 0.045, gap = 0.03, t = 0.02;
  const run = (from: number, to: number, place: (c: number) => [number, number, number, number]) => {
    const n = Math.max(2, Math.floor((to - from + gap) / (sw + gap)));
    const step = (to - from - sw) / (n - 1);
    for (let i = 0; i < n; i++) {
      const [x0, x1, z0, z1] = place(from + i * step);
      P.box(M.bench, x0, x1, 0.06, gh, z0, z1, m, 'y');
    }
  };
  run(-gw, gw, c => [c, c + sw, gd, gd + t]);
  for (const sx of [-1, 1]) run(-gd + 0.08, gd - sw, c => [sx * gw - t / 2, sx * gw + t / 2, c, c + sw]);
  for (const y of [0.16, gh - 0.12]) {
    P.box(M.benchPanel, -gw, gw, y, y + 0.04, gd - 0.02, gd, m);
    for (const sx of [-1, 1]) P.box(M.benchPanel, sx * gw - (sx > 0 ? t / 2 + 0.02 : -t / 2), sx * gw + (sx > 0 ? -t / 2 : t / 2 + 0.02), y, y + 0.04, -gd + 0.08, gd, m);
  }
}

/** Framed infrared emitter on a bench wall, between the backrest panels. */
function irPanel(P: Parts, M: KitMaterials, L: KitLayout, s: Segment, u: number) {
  const m = segMatrix(s, u, L.wall, L.floorY);
  const y0 = L.upperTop + 0.16, y1 = Math.min(L.wallHeight - 0.12, y0 + 0.95);
  P.box(M.benchPanel, -0.16, 0.16, y0, y1, 0, 0.03, m, 'y');
  P.box(M.grille, -0.115, 0.115, y0 + 0.05, y1 - 0.05, 0.03, 0.034, m, 'y');
  P.box(M.white, 0.2, 0.28, y0 - 0.02, y0 + 0.06, 0, 0.012, m);
  const dial = new THREE.CylinderGeometry(0.018, 0.018, 0.016, 18);
  dial.rotateX(Math.PI / 2);
  dial.translate(0.24, y0 + 0.02, 0.018);
  P.add(M.steel, dial, m);
}

/** Slatted wedge headrest lying on the bench, rising towards `facing`. */
function headrest(P: Parts, M: KitMaterials, at: Vec2, facing: Vec2, y: number) {
  const m = facingMatrix(at, facing, y);
  const slope = 0.32;
  for (let i = 0; i < 8; i++) {
    const x = -0.17 + i * 0.048;
    const slat = new THREE.BoxGeometry(0.034, 0.016, 0.36);
    slat.rotateX(-slope);
    slat.translate(x, 0.07, 0);
    P.add(M.bench, slat, m);
  }
  for (const x of [-0.19, 0.19]) {
    const side = new THREE.BoxGeometry(0.018, 0.12, 0.34);
    side.rotateX(-slope);
    side.translate(x, 0.055, 0);
    P.add(M.benchPanel, side, m);
  }
}

/** Wooden bucket with steel bands and a ladle. */
function bucket(P: Parts, M: KitMaterials, at: Vec2, y: number) {
  const m = facingMatrix(at, [0, 1], y);
  const body = new THREE.CylinderGeometry(0.13, 0.11, 0.2, 18, 1, true);
  body.translate(0, 0.1, 0);
  P.add(M.benchPanel, body, m);
  const bottom = new THREE.CircleGeometry(0.11, 18);
  bottom.rotateX(-Math.PI / 2);
  bottom.translate(0, 0.012, 0);
  P.add(M.white, bottom, m);
  for (const yy of [0.05, 0.16]) {
    const band = new THREE.TorusGeometry(0.11 + yy * 0.1, 0.005, 4, 24);
    band.rotateX(Math.PI / 2);
    band.translate(0, yy, 0);
    P.add(M.steel, band, m);
  }
  const ladle = new THREE.CylinderGeometry(0.008, 0.008, 0.42, 8);
  ladle.rotateZ(0.55);
  ladle.translate(0.08, 0.26, 0);
  P.add(M.bench, ladle, m);
}

export function buildFixtures(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec, irAt: number | null, irWall: Segment | null) {
  heater(P, M, L, spec);
  const byId = new Map(L.segments.map(s => [s.id, s]));
  if (irWall && irAt !== null) irPanel(P, M, L, irWall, irAt);

  const upper = L.bands.filter(b => b.level === 'upper');
  const primary = upper[0];
  if (spec.extras.headrests && primary) {
    const s = byId.get(primary.segment)!;
    const mid = (primary.o0 + primary.o1) / 2;
    const lineP = add(s.a, mul(s.inward, L.wall + mid));
    // Near each end of the main run, rising towards the end.
    const ends = [s.length * 0.22, s.length * 0.78];
    ends.forEach((u, i) => headrest(P, M, add(lineP, mul(s.dir, u)), i === 0 ? mul(s.dir, -1) : s.dir, L.floorY + primary.top));
  }
  if (spec.extras.bucket) {
    const lower = L.bands.find(b => b.level === 'lower');
    const band = lower ?? primary;
    if (band) {
      const s = byId.get(band.segment)!;
      const p = add(add(s.a, mul(s.inward, L.wall + (band.o0 + band.o1) / 2)), mul(s.dir, s.length * 0.62));
      bucket(P, M, p, L.floorY + band.top);
    }
  }
  const free = L.freeWall ? byId.get(L.freeWall)! : null;
  if (spec.extras.thermometer && free) {
    const m = segMatrix(free, free.length * 0.5, L.wall, L.floorY);
    const y = L.wallHeight - 0.5;
    P.box(M.benchPanel, -0.15, 0.15, y, y + 0.18, 0, 0.022, m);
    for (const x of [-0.07, 0.07]) {
      const face = new THREE.CircleGeometry(0.052, 24);
      face.translate(x, y + 0.09, 0.024);
      P.add(M.white, face, m);
    }
  }
  if (spec.extras.saltWall && free) {
    const m = segMatrix(free, 0, L.wall, L.floorY);
    const u0 = free.length * 0.5 - 0.42, y0 = 1.0;
    const r = rng(41);
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 4; col++) {
        const u = u0 + col * 0.21 + (row % 2 ? 0.1 : 0);
        if (u + 0.2 > u0 + 0.86) continue;
        P.box(M.salt, u, u + 0.2, y0 + row * 0.105, y0 + row * 0.105 + 0.1, 0.004, 0.03 + r() * 0.004, m);
      }
    }
    P.lights.push({ position: [...(() => { const e = segMatrix(free, free.length * 0.5, L.wall + 0.3, L.floorY + 1.35).elements; return [e[12]!, e[13]!, e[14]!] as [number, number, number]; })()], color: '#ff9a55', intensity: 0.35, distance: 1.4 });
  }
  if (spec.extras.aroma && L.heater.segment) {
    const s = byId.get(L.heater.segment)!;
    const m = segMatrix(s, (L.heater.u ?? 0) + 0.45, L.wall, L.floorY);
    P.box(M.black, -0.05, 0.05, 1.3, 1.46, 0, 0.06, m);
    P.box(M.steel, -0.03, 0.03, 1.46, 1.5, 0.01, 0.05, m);
  }
  const inner = interiorPolygon(L);
  const ceilY = L.floorY + L.wallHeight - 0.004;
  const cx = inner.reduce((a, p) => a + p[0], 0) / inner.length, cz = inner.reduce((a, p) => a + p[1], 0) / inner.length;
  if (spec.extras.audio) {
    for (const dx of [-0.35, 0.35]) {
      const g = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 24);
      g.translate(cx + dx, ceilY - 0.004, cz - 0.1);
      P.add(M.black, g);
    }
  }
  if (spec.lights.stars) {
    const r = rng(19);
    const xs = inner.map(p => p[0]), zs = inner.map(p => p[1]);
    for (let i = 0; i < 70; i++) {
      const x = Math.min(...xs) + 0.15 + r() * (Math.max(...xs) - Math.min(...xs) - 0.3);
      const z = Math.min(...zs) + 0.15 + r() * (Math.max(...zs) - Math.min(...zs) - 0.3);
      const g = new THREE.SphereGeometry(0.004 + r() * 0.004, 6, 4);
      g.translate(x, ceilY, z);
      P.add(M.led, g);
    }
  }
  if (spec.lights.ceilingPanel) {
    P.box(M.led, cx - 0.32, cx + 0.32, ceilY - 0.006, ceilY, cz + 0.05, cz + 0.2);
    P.box(M.steel, cx - 0.34, cx + 0.34, ceilY - 0.004, ceilY + 0.001, cz + 0.035, cz + 0.215);
    P.lights.push({ position: [cx, ceilY - 0.3, cz + 0.12], color: '#ffe2bd', intensity: 0.8, distance: 3 });
  }
  if (spec.control) controlPanel(P, M, L);
  // Soft fill so the interior reads through the glass even without LED options.
  P.lights.push({ position: [cx, L.floorY + L.wallHeight * 0.8, cz], color: '#fff1de', intensity: 0.9, distance: 4.5 });
}

/** Digital control on the outside, beside the door. */
function controlPanel(P: Parts, M: KitMaterials, L: KitLayout) {
  const door = L.segments.find(s => s.door)!;
  let target = door, u = door.door!.hingeAtStart ? door.door!.u1 + 0.18 : door.door!.u0 - 0.18;
  if (door.kind !== 'solid' || u < 0.1 || u > door.length - 0.1) {
    const { prev, next } = neighbours(L, door);
    const solid = [next, prev].find(s => s.kind === 'solid');
    if (!solid) return;
    target = solid;
    u = solid === next ? 0.25 : solid.length - 0.25;
  }
  const m = segMatrix(target, u, 0, L.floorY);
  P.box(M.black, -0.05, 0.05, 1.3, 1.46, -0.016, 0, m);
  P.box(M.led, -0.03, 0.03, 1.4, 1.43, -0.0175, -0.016, m);
}
