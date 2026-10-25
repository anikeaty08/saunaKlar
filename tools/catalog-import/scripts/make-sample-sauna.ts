/**
 * Generates the example catalog's single 3D asset procedurally: a small indoor sauna cabin
 * (about 1.6 × 1.6 × 2.1 m), Y-up, metres, origin at the centre of the floor, door facing +Z.
 *
 *   npx tsx tools/catalog-import/scripts/make-sample-sauna.ts [outDir]
 *
 * Writes `espoo-compact.glb` (full detail: slatted boards, slatted benches, heater with stones)
 * and `espoo-compact-low.glb` (low LOD: solid panels and seats, a few stones). No textures; PBR
 * factors only. Material names are stable (`wood_interior`, `wood_exterior`, ...) so the
 * configurator can recolour them per option. The output is deterministic (seeded PRNG).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document, NodeIO, type Material } from '@gltf-transform/core';

type Vec3 = [number, number, number];

/** Geometry being collected for one material inside one part. */
class Geo {
  positions: number[] = [];
  normals: number[] = [];
  indices: number[] = [];

  /** Axis-aligned box from min corner to max corner (flat-shaded, 24 vertices). */
  box(min: Vec3, max: Vec3): this {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const faces: [Vec3, Vec3[]][] = [
      [[1, 0, 0], [[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]]],
      [[-1, 0, 0], [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]]],
      [[0, 1, 0], [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]]],
      [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
      [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
      [[0, 0, -1], [[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]]],
    ];
    for (const [n, quad] of faces) {
      const base = this.positions.length / 3;
      for (const p of quad) { this.positions.push(...p); this.normals.push(...n); }
      this.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return this;
  }

  /** Box given by centre and size. */
  cbox(c: Vec3, s: Vec3): this {
    return this.box([c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2], [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2]);
  }

  /** A flat-shaded, irregular icosahedron: a sauna stone. */
  stone(c: Vec3, r: number, rand: () => number): this {
    const t = (1 + Math.sqrt(5)) / 2;
    const ico: Vec3[] = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
      [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    const v: Vec3[] = ico.map(([x, y, z]) => {
      const len = Math.hypot(x, y, z);
      const k = r * (0.8 + rand() * 0.35) / len;
      return [c[0] + x * k * 1.15, c[1] + y * k * 0.7, c[2] + z * k] as Vec3; // flattened like river stones
    });
    const f = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
    for (const [a, b, d] of f) {
      const A = v[a!]!, B = v[b!]!, D = v[d!]!;
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
      const w = [D[0] - A[0], D[1] - A[1], D[2] - A[2]];
      const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!];
      const l = Math.hypot(n[0]!, n[1]!, n[2]!) || 1;
      const base = this.positions.length / 3;
      for (const p of [A, B, D]) { this.positions.push(...p); this.normals.push(n[0]! / l, n[1]! / l, n[2]! / l); }
      this.indices.push(base, base + 1, base + 2);
    }
    return this;
  }
}

/** Mulberry32: small deterministic PRNG. */
function prng(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- Dimensions (metres) -------------------------------------------------------------------
const W = 1.6;            // outer width (x)
const D = 1.6;            // outer depth (z)
const H_WALL = 2.0;       // top of the walls
const T = 0.045;          // wall board thickness
const FLOOR = 0.04;       // plinth height
const DOOR_W = 0.7;       // door opening width
const DOOR_TOP = 1.92;
const HX = W / 2, HZ = D / 2;
const IN_X = HX - T, IN_Z = HZ - T; // inner faces

interface Lod { full: boolean }

type Parts = Map<string, Map<Material, Geo>>;

function geo(parts: Parts, part: string, m: Material): Geo {
  if (!parts.has(part)) parts.set(part, new Map());
  const p = parts.get(part)!;
  if (!p.has(m)) p.set(m, new Geo());
  return p.get(m)!;
}

function build(lod: Lod): Document {
  const doc = new Document();
  doc.getRoot().getAsset().generator = 'saunaklar make-sample-sauna';
  const buffer = doc.createBuffer();

  const mat = (name: string, rgba: [number, number, number, number], rough: number, metal = 0) =>
    doc.createMaterial(name).setBaseColorFactor(rgba).setRoughnessFactor(rough).setMetallicFactor(metal);
  // Linear-space colours.
  const woodOut = mat('wood_exterior', [0.52, 0.33, 0.17, 1], 0.75);
  const woodIn = mat('wood_interior', [0.78, 0.6, 0.38, 1], 0.7);
  const woodTrim = mat('wood_trim', [0.3, 0.17, 0.08, 1], 0.7);
  const backer = mat('wood_backer', [0.12, 0.07, 0.035, 1], 0.9);
  const glass = mat('glass', [0.62, 0.7, 0.68, 0.28], 0.05).setAlphaMode('BLEND').setDoubleSided(true);
  const steel = mat('metal_steel', [0.62, 0.62, 0.6, 1], 0.35, 1);
  const heaterMat = mat('metal_heater', [0.05, 0.05, 0.055, 1], 0.45, 0.8);
  const stoneMat = mat('stone', [0.2, 0.2, 0.19, 1], 0.95);
  const roofMat = mat('roof', [0.06, 0.06, 0.065, 1], 0.8);

  const parts: Parts = new Map();
  const rand = prng(20261023);

  // ---- Floor and frame ----
  geo(parts, 'floor', woodTrim).box([-HX, 0, -HZ], [HX, FLOOR, HZ]);
  geo(parts, 'floor', woodIn).box([-IN_X, FLOOR, -IN_Z], [IN_X, FLOOR + 0.02, IN_Z]); // duckboard base
  for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    geo(parts, 'frame', woodTrim).cbox([x * (HX - 0.03), (FLOOR + H_WALL) / 2, z * (HZ - 0.03)], [0.07, H_WALL - FLOOR, 0.07]);
  }

  // ---- Walls: horizontal boards with 5 mm shadow gaps on an inner dark backer ----
  const pitch = 0.1, board = 0.094;
  /** A wall whose outer face lies at `outer` (signed x or z); boards run along the other axis. */
  const wall = (part: string, along: 'x' | 'z', outer: number, from: number, to: number, y0 = FLOOR, y1 = H_WALL) => {
    const sign = Math.sign(outer);
    const mid = (from + to) / 2, len = to - from;
    const layer = (m: Material, depth0: number, depth1: number, yc: number, h: number) => {
      const c = outer - sign * (depth0 + depth1) / 2, thick = depth1 - depth0;
      return along === 'x'
        ? geo(parts, part, m).cbox([mid, yc, c], [len, h, thick])
        : geo(parts, part, m).cbox([c, yc, mid], [thick, h, len]);
    };
    // Exterior boards: outer 40 % of the wall; dark backer: middle 20 %; interior boards: inner 40 %.
    if (!lod.full) {
      layer(woodOut, 0, T * 0.5, (y0 + y1) / 2, y1 - y0);
      layer(woodIn, T * 0.5, T, (y0 + y1) / 2, y1 - y0);
      return;
    }
    layer(backer, T * 0.4, T * 0.6, (y0 + y1) / 2, y1 - y0);
    for (let y = y0; y < y1 - 0.01; y += pitch) {
      const h = Math.min(board, y1 - y);
      layer(woodOut, 0, T * 0.4, y + h / 2, h);
      layer(woodIn, T * 0.6, T, y + h / 2, h);
    }
  };
  wall('wall_back', 'x', -HZ, -HX + 0.065, HX - 0.065);
  wall('wall_left', 'z', -HX, -HZ + 0.065, HZ - 0.065);
  wall('wall_right', 'z', HX, -HZ + 0.065, HZ - 0.065);
  // Front wall: boards either side of the door, and a lintel above it.
  wall('wall_front', 'x', HZ, -HX + 0.065, -DOOR_W / 2);
  wall('wall_front', 'x', HZ, DOOR_W / 2, HX - 0.065);
  wall('wall_front', 'x', HZ, -DOOR_W / 2, DOOR_W / 2, DOOR_TOP, H_WALL);

  // ---- Door: wooden frame, glass leaf, steel handle ----
  const frame = geo(parts, 'door', woodTrim);
  const fzc = HZ - T / 2;
  frame.cbox([-DOOR_W / 2 + 0.025, (FLOOR + DOOR_TOP) / 2, fzc], [0.05, DOOR_TOP - FLOOR, T + 0.01]);
  frame.cbox([DOOR_W / 2 - 0.025, (FLOOR + DOOR_TOP) / 2, fzc], [0.05, DOOR_TOP - FLOOR, T + 0.01]);
  frame.cbox([0, DOOR_TOP - 0.025, fzc], [DOOR_W, 0.05, T + 0.01]);
  frame.cbox([0, FLOOR + 0.015, fzc], [DOOR_W, 0.03, T + 0.01]);
  geo(parts, 'door', glass).cbox([0, (FLOOR + 0.03 + DOOR_TOP - 0.05) / 2, HZ - 0.012], [DOOR_W - 0.1, DOOR_TOP - FLOOR - 0.08, 0.008]);
  const handle = geo(parts, 'door', steel);
  handle.cbox([DOOR_W / 2 - 0.12, 1.0, HZ + 0.03], [0.025, 0.32, 0.025]);
  handle.cbox([DOOR_W / 2 - 0.12, 1.12, HZ + 0.008], [0.02, 0.02, 0.03]);
  handle.cbox([DOOR_W / 2 - 0.12, 0.88, HZ + 0.008], [0.02, 0.02, 0.03]);
  // Hinges
  for (const y of [0.3, 1.6]) geo(parts, 'door', steel).cbox([-DOOR_W / 2 + 0.06, y, HZ - 0.004], [0.03, 0.09, 0.012]);

  // ---- Ceiling, roof with overhang and fascia ----
  geo(parts, 'ceiling', woodIn).box([-IN_X, H_WALL - 0.03, -IN_Z], [IN_X, H_WALL, IN_Z]);
  const OH = 0.08;
  geo(parts, 'roof', roofMat).box([-HX - OH, H_WALL, -HZ - OH], [HX + OH, H_WALL + 0.05, HZ + OH]);
  geo(parts, 'roof', roofMat).box([-HX - OH * 0.5, H_WALL + 0.05, -HZ - OH * 0.5], [HX + OH * 0.5, H_WALL + 0.1, HZ + OH * 0.5]);
  const fascia = geo(parts, 'roof', woodTrim);
  fascia.box([-HX - OH, H_WALL - 0.06, HZ + OH - 0.02], [HX + OH, H_WALL, HZ + OH]);
  fascia.box([-HX - OH, H_WALL - 0.06, -HZ - OH], [HX + OH, H_WALL, -HZ - OH + 0.02]);
  fascia.box([-HX - OH, H_WALL - 0.06, -HZ - OH], [-HX - OH + 0.02, H_WALL, HZ + OH]);
  fascia.box([HX + OH - 0.02, H_WALL - 0.06, -HZ - OH], [HX + OH, H_WALL, HZ + OH]);
  // Ceiling light
  geo(parts, 'ceiling', steel).cbox([0.25, H_WALL - 0.04, 0.1], [0.12, 0.02, 0.12]);

  // ---- Benches: upper along the back wall, lower step in front of it (right of the heater) ----
  const bench = (part: string, x0: number, x1: number, z0: number, z1: number, top: number) => {
    const seat = geo(parts, part, woodIn);
    const thick = 0.028;
    if (lod.full) {
      const slats = 5, gap = 0.012;
      const sw = (z1 - z0 - gap * (slats - 1)) / slats;
      for (let i = 0; i < slats; i++) {
        const z = z0 + i * (sw + gap);
        seat.box([x0, top - thick, z], [x1, top, z + sw]);
      }
      // Front skirt board
      geo(parts, part, woodIn).box([x0, top - 0.16, z1 - 0.022], [x1, top - thick, z1]);
    } else {
      seat.box([x0, top - thick, z0], [x1, top, z1]);
    }
    // Supports: rails and legs
    const legs = geo(parts, part, woodTrim);
    const n = Math.max(2, Math.round((x1 - x0) / 0.6) + 1);
    for (let i = 0; i < n; i++) {
      const x = x0 + 0.03 + i * ((x1 - x0 - 0.06) / (n - 1));
      legs.box([x - 0.022, top - thick - 0.045, z0], [x + 0.022, top - thick, z1]);
      legs.box([x - 0.022, FLOOR + 0.02, z1 - 0.08], [x + 0.022, top - thick - 0.045, z1 - 0.036]);
    }
  };
  const upperZ0 = -IN_Z, upperZ1 = -IN_Z + 0.55;
  bench('bench_upper', -IN_X, IN_X, upperZ0, upperZ1, 0.95);
  const lowerX0 = -0.2;
  bench('bench_lower', lowerX0, IN_X, upperZ1, upperZ1 + 0.42, 0.5);
  // Backrest slats on the back wall above the upper bench
  for (const y of lod.full ? [1.12, 1.27, 1.42] : [1.27]) {
    geo(parts, 'bench_upper', woodIn).box([-IN_X + 0.05, y, -IN_Z], [IN_X - 0.05, y + 0.07, -IN_Z + 0.025]);
  }
  // Head rest on the bench
  if (lod.full) geo(parts, 'bench_upper', woodTrim).box([IN_X - 0.3, 0.95, -IN_Z + 0.06], [IN_X - 0.06, 1.03, -IN_Z + 0.3]);

  // ---- Heater: steel box on the left wall, stone basket, stones, guard, control panel ----
  const hx = -IN_X + 0.22, hz = 0.2, hw = 0.3, hd = 0.36, hh = 0.62;
  const heater = geo(parts, 'heater', heaterMat);
  heater.box([hx - hw / 2, FLOOR + 0.1, hz - hd / 2], [hx + hw / 2, FLOOR + hh, hz + hd / 2]);
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
    heater.cbox([hx + dx * (hw / 2 - 0.03), FLOOR + 0.05, hz + dz * (hd / 2 - 0.03)], [0.03, 0.1, 0.03]);
  }
  const basketTop = FLOOR + hh + 0.12;
  const rim = geo(parts, 'heater', steel);
  rim.box([hx - hw / 2, FLOOR + hh, hz - hd / 2], [hx + hw / 2, basketTop, hz - hd / 2 + 0.008]);
  rim.box([hx - hw / 2, FLOOR + hh, hz + hd / 2 - 0.008], [hx + hw / 2, basketTop, hz + hd / 2]);
  rim.box([hx - hw / 2, FLOOR + hh, hz - hd / 2], [hx - hw / 2 + 0.008, basketTop, hz + hd / 2]);
  rim.box([hx + hw / 2 - 0.008, FLOOR + hh, hz - hd / 2], [hx + hw / 2, basketTop, hz + hd / 2]);
  rim.cbox([hx + hw / 2 + 0.01, FLOOR + 0.45, hz], [0.012, 0.06, 0.12]); // control knob plate
  const stones = geo(parts, 'heater', stoneMat);
  const layers = lod.full ? [[4, 3], [3, 3], [2, 2]] : [[2, 2]];
  layers.forEach(([nx, nz], li) => {
    for (let i = 0; i < nx!; i++) {
      for (let k = 0; k < nz!; k++) {
        const x = hx - hw / 2 + 0.04 + (i + 0.5) * ((hw - 0.08) / nx!) + (rand() - 0.5) * 0.02;
        const z = hz - hd / 2 + 0.04 + (k + 0.5) * ((hd - 0.08) / nz!) + (rand() - 0.5) * 0.02;
        const r = lod.full ? 0.045 + rand() * 0.015 : 0.08;
        stones.stone([x, FLOOR + hh + 0.03 + li * 0.045, z], r, rand);
      }
    }
  });
  // Wooden guard rail in front of the heater (towards the bench and the door)
  if (lod.full) {
    const guard = geo(parts, 'heater', woodTrim);
    for (const y of [0.35, 0.6]) {
      guard.box([hx - hw / 2 - 0.02, y, hz + hd / 2 + 0.08], [hx + hw / 2 + 0.1, y + 0.05, hz + hd / 2 + 0.1]);
      guard.box([hx + hw / 2 + 0.08, y, hz - hd / 2], [hx + hw / 2 + 0.1, y + 0.05, hz + hd / 2 + 0.1]);
    }
    guard.box([hx + hw / 2 + 0.08, FLOOR, hz + hd / 2 + 0.08], [hx + hw / 2 + 0.1, 0.65, hz + hd / 2 + 0.1]);
  }

  // ---- Emit one node per part, one primitive per material ----
  const scene = doc.createScene('sauna');
  const root = doc.createNode('espoo-compact');
  scene.addChild(root);
  for (const [part, byMat] of parts) {
    const mesh = doc.createMesh(part);
    for (const [m, g] of byMat) {
      const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.positions)).setBuffer(buffer);
      const nor = doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.normals)).setBuffer(buffer);
      const vertexCount = g.positions.length / 3;
      const idx = doc.createAccessor().setType('SCALAR')
        .setArray(vertexCount > 65535 ? new Uint32Array(g.indices) : new Uint16Array(g.indices)).setBuffer(buffer);
      mesh.addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos).setAttribute('NORMAL', nor).setIndices(idx).setMaterial(m));
    }
    root.addChild(doc.createNode(part).setMesh(mesh));
  }
  // Drop materials no primitive uses (the low LOD has no backer).
  for (const m of doc.getRoot().listMaterials()) if (m.listParents().length <= 1) m.dispose();
  return doc;
}

export async function makeSampleSauna(outDir: string): Promise<{ high: string; low: string; highBytes: number; lowBytes: number }> {
  const io = new NodeIO();
  await mkdir(outDir, { recursive: true });
  const high = join(outDir, 'espoo-compact.glb');
  const low = join(outDir, 'espoo-compact-low.glb');
  const hb = await io.writeBinary(build({ full: true }));
  const lb = await io.writeBinary(build({ full: false }));
  await writeFile(high, hb);
  await writeFile(low, lb);
  return { high, low, highBytes: hb.byteLength, lowBytes: lb.byteLength };
}

const here = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = resolve(process.argv[2] ?? join(here, '..', 'examples', 'models'));
  const r = await makeSampleSauna(out);
  console.log(`${r.high} ${(r.highBytes / 1024).toFixed(1)} KB`);
  console.log(`${r.low} ${(r.lowBytes / 1024).toFixed(1)} KB`);
}
