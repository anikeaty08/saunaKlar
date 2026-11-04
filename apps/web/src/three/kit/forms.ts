import * as THREE from 'three';
import { CABIN_BODY, type KitLayout, type Vec2 } from './layout.ts';
import type { KitMaterials } from './materials.ts';
import { Parts, QuadBuilder, planCap, planSides, roundedSlat } from './parts.ts';
import type { KitSpec } from './spec.ts';
import { heater } from './fixtures.ts';

type V3 = THREE.Vector3Tuple;

/** Adds a quad, flipped if needed so its normal points towards `towards` (a direction). */
function quadFacing(q: QuadBuilder, p: V3[], uv: [number, number][], towards: THREE.Vector3) {
  const [a, b, c] = p.map(v => new THREE.Vector3(...v));
  const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
  if (n.dot(towards) < 0) q.quad([p[3]!, p[2]!, p[1]!, p[0]!], [uv[3]!, uv[2]!, uv[1]!, uv[0]!]);
  else q.quad(p, uv);
}

const scale = (pts: Vec2[], k: number): Vec2[] => pts.map(([x, z]) => [x * k, z * k]);

/** Hip roof of the six-sided pavilion, with a glazed lantern on top. */
export function hexRoof(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec) {
  const ye = L.floorY + L.wallHeight;
  const eave = scale(L.outline, 1.14);
  const lanternH = 0.3, capH = 0.16;
  const yr = spec.height - lanternH - capH;
  const ring = scale(L.outline, 0.24);
  const roof = new QuadBuilder();
  const n = eave.length;
  for (let i = 0; i < n; i++) {
    const a = eave[i]!, b = eave[(i + 1) % n]!, c = ring[(i + 1) % n]!, d = ring[i]!;
    const mid = new THREE.Vector3((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2).normalize().add(new THREE.Vector3(0, 1, 0));
    const slope = Math.hypot(Math.hypot((a[0] + b[0]) / 2 - (c[0] + d[0]) / 2, (a[1] + b[1]) / 2 - (c[1] + d[1]) / 2), yr - ye);
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    quadFacing(roof, [[a[0], ye - 0.06, a[1]], [b[0], ye - 0.06, b[1]], [c[0], yr, c[1]], [d[0], yr, d[1]]], [[0, 0], [l, 0], [l, slope], [0, slope]], mid);
  }
  P.add(M.roof, roof.geometry());
  // Fascia and soffit.
  P.add(M.wallOut, planSides(eave, ye - 0.16, ye - 0.06));
  P.add(M.wallOut, planCap(eave, ye - 0.16, 'down'));
  // Lantern: glass band, corner posts, small cap.
  P.add(M.wallOut, planSides(ring, yr, yr + 0.04));
  P.add(M.glass, planSides(scale(ring, 0.98), yr + 0.04, yr + lanternH - 0.03));
  for (const [x, z] of ring) P.box(M.wallOut, x - 0.025, x + 0.025, yr, yr + lanternH, z - 0.025, z + 0.025, undefined, 'y');
  const capEave = scale(ring, 1.25);
  const cap = new QuadBuilder();
  for (let i = 0; i < n; i++) {
    const a = capEave[i]!, b = capEave[(i + 1) % n]!;
    const mid = new THREE.Vector3((a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2).normalize().add(new THREE.Vector3(0, 1, 0));
    const pts: V3[] = [[a[0], yr + lanternH, a[1]], [b[0], yr + lanternH, b[1]], [0, spec.height, 0]];
    const [p0, p1, p2] = pts.map(v => new THREE.Vector3(...v));
    const nrm = new THREE.Vector3().subVectors(p1!, p0!).cross(new THREE.Vector3().subVectors(p2!, p0!));
    if (nrm.dot(mid) < 0) cap.tri([pts[1]!, pts[0]!, pts[2]!], [[1, 0], [0, 0], [0.5, 0.4]]);
    else cap.tri(pts, [[0, 0], [1, 0], [0.5, 0.4]]);
  }
  P.add(M.roof, cap.geometry());
  P.add(M.roof, planCap(capEave, yr + lanternH - 0.001, 'down'));
  P.add(M.ceiling, planCap(ring, yr + 0.001, 'down'));
}

/** Pitched roof (ridge front to back), gables and the covered porch of a garden house. */
export function cabinRoof(P: Parts, M: KitMaterials, L: KitLayout, spec: KitSpec) {
  const W = spec.width, D = spec.depth;
  const ye = L.floorY + L.wallHeight;
  const zBack = -D / 2, zBody = -D / 2 + D * CABIN_BODY, zFront = D / 2;
  const over = 0.28;
  const xe = W / 2 + over;
  const drop = (over / (W / 2)) * (spec.height - ye);
  const yEave = ye - drop;
  const z0 = zBack - 0.22, z1 = zFront + 0.12;
  const slope = Math.hypot(xe, spec.height - yEave);
  for (const sx of [-1, 1]) {
    const top = new QuadBuilder();
    const pts: V3[] = [[sx * xe, yEave, z0], [sx * xe, yEave, z1], [0, spec.height, z1], [0, spec.height, z0]];
    quadFacing(top, pts, [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]], new THREE.Vector3(sx, 1, 0));
    P.add(M.roof, top.geometry());
    const under = new QuadBuilder();
    quadFacing(under, pts.map(([x, y, z]) => [x, y - 0.05, z] as V3), [[0, 0], [z1 - z0, 0], [z1 - z0, slope], [0, slope]], new THREE.Vector3(0, -1, 0));
    P.add(M.wallOut, under.geometry());
    // Fascia along the eave.
    P.box(M.wallOut, -0.02, 0.02, yEave - 0.16, yEave, z0, z1, new THREE.Matrix4().makeTranslation(sx * xe, 0, 0), 'z');
  }
  // Gable triangles on the back wall and on the front wall of the sauna room.
  for (const [z, dir] of [[zBack, -1], [zBody, 1]] as const) {
    const g = new QuadBuilder();
    const pts: V3[] = [[-W / 2, ye, z], [W / 2, ye, z], [0, spec.height - 0.04, z]];
    const [a, b, c] = pts.map(v => new THREE.Vector3(...v));
    const n = new THREE.Vector3().subVectors(b!, a!).cross(new THREE.Vector3().subVectors(c!, a!));
    const uv: [number, number][] = [[-W / 2, ye], [W / 2, ye], [0, spec.height]];
    if (n.z * dir < 0) g.tri([pts[1]!, pts[0]!, pts[2]!], [uv[1]!, uv[0]!, uv[2]!]);
    else g.tri(pts, uv);
    P.add(M.wallOut, g.geometry());
  }
  // Ridge cap.
  P.box(M.black, -0.06, 0.06, spec.height - 0.02, spec.height + 0.03, z0, z1, undefined, 'z');
  // Porch: deck, posts, beam.
  for (let x = -W / 2 + 0.01; x < W / 2 - 0.1; x += 0.145) P.box(M.wallOut, zBody + 0.01, zFront, L.floorY - 0.03, L.floorY, x, x + 0.13, new THREE.Matrix4().makeRotationY(-Math.PI / 2), 'x');
  P.box(M.plinth, -W / 2, W / 2, 0, L.floorY - 0.03, zBody, zFront);
  for (const sx of [-1, 1]) P.box(M.wallOut, sx * (W / 2 - 0.06) - 0.06, sx * (W / 2 - 0.06) + 0.06, L.floorY, yEave, zFront - 0.14, zFront - 0.02, undefined, 'y');
  P.box(M.wallOut, -W / 2, W / 2, yEave - 0.2, yEave, zFront - 0.14, zFront - 0.02);
}

/** Barrel sauna: staves, steel bands, cradles, timber front with a glass door, benches along both sides. */
export function barrel(P: Parts, M: KitMaterials, spec: KitSpec) {
  const R = Math.min(spec.width, spec.height) / 2 - 0.03;
  const Lz = spec.depth;
  const yc = R + 0.14;
  const N = Math.max(28, Math.round((2 * Math.PI * R) / 0.09));
  const t = 0.042;
  const chord = 2 * R * Math.sin(Math.PI / N) - 0.003;
  const o = new THREE.Object3D();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const g = new THREE.BoxGeometry(chord, t, Lz);
    // Grain along the length.
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const uv = new Float32Array(pos.count * 2);
    for (let k = 0; k < pos.count; k++) {
      const ny = Math.abs(nor.getY(k)) > 0.5;
      uv[k * 2] = pos.getZ(k) + i * 0.37;
      uv[k * 2 + 1] = ny ? pos.getX(k) + i * 0.12 : pos.getY(k);
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    o.position.set(Math.cos(a) * (R - t / 2), yc + Math.sin(a) * (R - t / 2), 0);
    o.rotation.set(0, 0, a - Math.PI / 2);
    o.updateMatrix();
    P.add(M.wallOut, g, o.matrix.clone());
  }
  // Inner skin so the interior shows interior wood.
  const skin = new THREE.CylinderGeometry(R - t - 0.001, R - t - 0.001, Lz - 0.004, N, 1, true);
  skin.rotateX(Math.PI / 2);
  skin.scale(-1, 1, 1); // normals inward
  const sp = skin.getAttribute('position');
  const suv = new Float32Array(sp.count * 2);
  for (let k = 0; k < sp.count; k++) {
    suv[k * 2] = sp.getZ(k);
    suv[k * 2 + 1] = Math.atan2(sp.getY(k), sp.getX(k)) * R;
  }
  skin.setAttribute('uv', new THREE.BufferAttribute(suv, 2));
  skin.translate(0, yc, 0);
  P.add(M.wallIn, skin);
  // Shingle strip over the top.
  const cap = new THREE.CylinderGeometry(R + 0.012, R + 0.012, Lz + 0.12, 32, 1, true, -Math.PI * 0.32, Math.PI * 0.64);
  cap.rotateX(Math.PI / 2);
  cap.translate(0, yc, 0);
  P.add(M.roof, cap);
  // Steel bands and cradles.
  for (const z of [-Lz * 0.34, Lz * 0.34]) {
    const band = new THREE.TorusGeometry(R + 0.006, 0.01, 6, 72);
    band.translate(0, yc, z);
    P.add(M.steel, band);
    P.box(M.wallOut, -R * 0.8, R * 0.8, 0, 0.2, z - 0.07, z + 0.07);
  }
  // Floor of the interior, end walls.
  const floorY = yc - R * 0.7;
  const half = Math.sqrt(R * R - (R * 0.7) ** 2) - t;
  const zIn0 = -Lz / 2 + t, zIn1 = Lz / 2 - t;
  P.box(M.plinth, -half, half, floorY - 0.06, floorY, zIn0, zIn1);
  for (let x = -half + 0.03; x + 0.07 < half - 0.02; x += 0.088) P.box(M.benchPanel, zIn0 + 0.02, zIn1 - 0.02, floorY, floorY + 0.022, x, x + 0.07, new THREE.Matrix4().makeRotationY(-Math.PI / 2), 'x');
  const circle = (r: number, hole?: [number, number, number, number]) => {
    const s = new THREE.Shape();
    s.absarc(0, 0, r, 0, Math.PI * 2, false);
    if (hole) {
      const [x0, x1, y0, y1] = hole;
      const h = new THREE.Path();
      h.moveTo(x0, y0);
      h.lineTo(x0, y1);
      h.lineTo(x1, y1);
      h.lineTo(x1, y0);
      h.lineTo(x0, y0);
      s.holes.push(h);
    }
    return s;
  };
  const doorW = 0.68, doorH = Math.min(1.75, yc + R * 0.8 - floorY);
  const hole: [number, number, number, number] = [-doorW / 2, doorW / 2, floorY - yc, floorY - yc + doorH];
  for (const [z, front] of [[-Lz / 2 + t, false], [Lz / 2 - t, true]] as const) {
    const shape = circle(R - t * 0.5, front ? hole : undefined);
    const ext = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false, curveSegments: 40 });
    const pos = ext.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    for (let k = 0; k < pos.count; k++) {
      uv[k * 2] = pos.getX(k);
      uv[k * 2 + 1] = pos.getY(k);
    }
    ext.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    ext.translate(0, yc, front ? z : z - t);
    P.add(front ? M.wallOut : M.wallIn, ext);
  }
  // Door leaf, lining and handle on the front.
  const zf = Lz / 2;
  if (spec.door === 'timber') {
    P.box(M.benchPanel, -doorW / 2 + 0.01, -0.07, floorY + 0.01, floorY + doorH - 0.01, zf - 0.01, zf + 0.02, undefined, 'y');
    P.box(M.benchPanel, 0.07, doorW / 2 - 0.01, floorY + 0.01, floorY + doorH - 0.01, zf - 0.01, zf + 0.02, undefined, 'y');
    P.box(M.glass, -0.07, 0.07, floorY + 0.4, floorY + doorH - 0.2, zf - 0.002, zf + 0.006);
  } else {
    P.box(M.doorGlass, -doorW / 2 + 0.01, doorW / 2 - 0.01, floorY + 0.01, floorY + doorH - 0.01, zf, zf + 0.008);
  }
  P.box(M.steel, doorW / 2 - 0.1, doorW / 2 - 0.08, floorY + 0.8, floorY + 1.2, zf + 0.05, zf + 0.07, undefined, 'y');
  // Benches along both sides, running the length.
  const top = floorY + 0.46;
  const zA = zIn0 + 0.42, zB = zIn1 - 0.04;
  const xOuter = Math.sqrt(R * R - (top - yc) ** 2) - t - 0.02;
  for (const sx of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const x0 = xOuter - 0.43 + k * 0.088;
      const nose = k === 0;
      if (nose && spec.bench.edge === 'rounded') {
        const g = roundedSlat(zB - zA, 0.078, 0.028);
        g.translate(0, top - 0.014, 0);
        const m = new THREE.Matrix4().makeRotationY(-Math.PI / 2 * sx).setPosition(sx * (x0 + 0.039), 0, sx > 0 ? zA : zB);
        P.add(M.bench, g, m);
      } else {
        const [xa, xb] = sx > 0 ? [x0, x0 + 0.078] : [-x0 - 0.078, -x0];
        P.box(M.bench, xa, xb, top - 0.028, top, zA, zB, undefined, 'z');
      }
    }
    const xf = sx * (xOuter - 0.45);
    // Vertical slat skirt under the seat front.
    for (let z = zA + 0.02; z < zB - 0.02; z += 0.085) {
      P.box(M.benchPanel, Math.min(xf, xf + sx * 0.022), Math.max(xf, xf + sx * 0.022), floorY, top - 0.028, z, Math.min(zB, z + 0.072), undefined, 'y');
    }
    if (spec.lights.underBench) {
      P.box(M.led, Math.min(xf, xf + sx * 0.4), Math.max(xf, xf + sx * 0.4), top - 0.075, top - 0.07, zA, zB);
      P.lights.push({ position: [sx * (xOuter - 0.6), floorY + 0.2, 0], color: '#ffb46b', intensity: 0.45, distance: 1.6 });
    }
  }
  if (spec.lights.backrest) {
    for (const sx of [-1, 1]) P.box(M.led, sx * (xOuter + 0.0) - 0.004, sx * (xOuter + 0.0) + 0.004, top + 0.42, top + 0.43, zA, zB);
    P.lights.push({ position: [0, top + 0.6, 0], color: '#ffb46b', intensity: 0.6, distance: 2.4 });
  }
  // Heater against the back wall, between the benches.
  heater(P, M, { heater: { position: [0, zIn0 + 0.32], facing: [0, 1] }, floorY, wallHeight: yc + R - floorY - 0.1 } as unknown as KitLayout, spec);
  P.lights.push({ position: [0, yc + R * 0.4, 0], color: '#ffe0b8', intensity: 0.35, distance: 3 });
}
