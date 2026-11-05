import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import type { ViewerOptions, ViewerSpecs } from '../types.ts';
import { computeReferenceLayout, type PlanPoint } from './layout.ts';
import knottyWoodUrl from '../kit/assets/wall-knotty.jpg?url';
import knottyNormalUrl from '../kit/assets/wall-knotty-n.webp?url';
import clearWoodUrl from '../kit/assets/wall-clear.jpg?url';
import clearNormalUrl from '../kit/assets/wall-clear-n.webp?url';
import benchWoodUrl from '../kit/assets/slat.jpg?url';
import woodMeans from '../kit/assets/wood.json';
import { washTexture } from '../kit/textures.ts';

/**
 * Wood maps for the reference cabin. The wall maps hold eight 150 mm boards
 * across 1.2 m (2.4 m long); the slat map holds one 120 mm slat over 1.2 m.
 * Each board below picks one whole stripe, so grain never runs across a joint.
 */
export interface ReferenceTextures {
  knotty: THREE.Texture;
  knottyNormal: THREE.Texture;
  clear: THREE.Texture;
  clearNormal: THREE.Texture;
  bench: THREE.Texture;
}

/** Photographed construction (PDF pages 1–9), in metres. */
const SLAT = 0.090; // seat slat width (pages 1, 6, 8)
const SLAT_GAP = 0.010;
const SEAT = 0.028; // seat slat thickness
const BOARD_GAP = 0.006; // between horizontal front boards (pages 1, 5)
const FRONT_BOARD = 0.115;
const FRONT_SETBACK = 0.035; // seat nosing over the front boards (page 1)
const FOOT = 0.05; // pale plinth rail under the boards (pages 2, 7)
const END_GAP = 0.010; // between vertical end boards (pages 2, 7)
const WALL_BOARD = 0.134; // knotty wall boards (pages 1, 5)
const BACKREST_BOARD = 0.095; // three backrest boards (pages 1, 5, 6)
const BACKREST_GAP = 0.016;
const BACKREST_RAISE = 0.25; // seat top to lowest backrest board
const BACKREST_STANDOFF = 0.03;

type Axis = 'x' | 'y' | 'z';
interface Grain {
  /** Local box axis the grain runs along. */
  along: Axis;
  /** Wall-map stripe (0–7); bench boards use the single slat stripe. */
  stripe?: number;
}

const AXES: Axis[] = ['x', 'y', 'z'];

/** Map one whole board stripe across each face and metres along the grain. */
function boardUV(geometry: THREE.BoxGeometry, grain: Grain, uOffset: number, stripe: [number, number]) {
  const { width, height, depth } = geometry.parameters;
  const size = { x: width, y: height, z: depth };
  const pos = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const p = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) };
    const n = { x: Math.abs(normal.getX(i)), y: Math.abs(normal.getY(i)), z: Math.abs(normal.getZ(i)) };
    const facing = AXES.reduce((best, a) => (n[a] > n[best] ? a : best), 'x' as Axis);
    const along = facing === grain.along ? AXES.find(a => a !== facing)! : grain.along;
    const across = AXES.find(a => a !== facing && a !== along)!;
    const t = (p[across] + size[across] / 2) / size[across];
    uv.setXY(i, p[along] + uOffset, stripe[0] + t * (stripe[1] - stripe[0]));
  }
  uv.needsUpdate = true;
}

/** Tint that turns a coloured grain map into the selected finish (same rule as the kit). */
function tint(hex: string, mean: number[] | undefined, factor = 1): THREE.Color {
  const c = new THREE.Color(hex);
  if (!mean) return c.multiplyScalar(factor);
  return new THREE.Color(c.r / mean[0]!, c.g / mean[1]!, c.b / mean[2]!).multiplyScalar(factor * 0.97);
}

/** One measured construction definition; dimensions are metres inside Three.js. */
export function buildReferenceSauna(specs: ViewerSpecs, options: ViewerOptions, textures?: ReferenceTextures): THREE.Group {
  const layout = computeReferenceLayout(specs.widthMm, specs.depthMm, specs.heightMm);
  const { height: H, wall, outline } = layout;
  const group = new THREE.Group();
  group.name = 'Reference six-sided sauna';
  const means = woodMeans as Record<string, number[]>;
  const knotty = options.wallWood.grain === 'knotty';
  const wallMean = textures ? means[knotty ? 'wall-knotty' : 'wall-clear'] : undefined;
  const benchMean = textures ? means.slat : undefined;
  const wallMap = textures ? (knotty ? textures.knotty : textures.clear) : null;
  const wallNormal = textures ? (knotty ? textures.knottyNormal : textures.clearNormal) : null;
  const wood = new THREE.MeshStandardMaterial({ color: tint(options.wallWood.color, wallMean), map: wallMap, normalMap: wallNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.78, envMapIntensity: 0.5 });
  const ceiling = new THREE.MeshStandardMaterial({ color: tint(options.wallWood.color, wallMean, 1.04), map: wallMap, normalMap: wallNormal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.8, envMapIntensity: 0.5 });
  const seat = new THREE.MeshStandardMaterial({ color: tint(options.benchWood.color, benchMean), map: textures?.bench ?? null, roughness: 0.7, envMapIntensity: 0.55 });
  // Bench fronts and end boards are a shade darker than the seat tops in every photo.
  const panel = new THREE.MeshStandardMaterial({ color: tint(options.benchWood.color, benchMean, 0.94), map: textures?.bench ?? null, roughness: 0.72, envMapIntensity: 0.55 });
  // Dark brown wood-look floor planks (pages 2–5).
  const floor = new THREE.MeshStandardMaterial({ color: tint('#4f3d33', textures ? means['wall-clear'] : undefined), map: textures?.clear ?? null, roughness: 0.62, envMapIntensity: 0.6 });
  const glassLook = options.door === 'bronze' ? { color: '#7a5a3a', opacity: 0.5 } : options.door === 'satin' ? { color: '#eef1ef', opacity: 0.78, roughness: 0.5 } : { color: '#dbe8e4', opacity: 0.13 };
  const glass = new THREE.MeshPhysicalMaterial({ roughness: 0.02, metalness: 0.08, ...glassLook, transparent: true, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 2.2, clearcoat: 1, clearcoatRoughness: 0.03 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9cdd0', metalness: 0.5, roughness: 0.28, envMapIntensity: 1.4 });
  const channel = new THREE.MeshStandardMaterial({ color: '#9da3a6', metalness: 0.6, roughness: 0.4 });
  const heaterSteel = new THREE.MeshStandardMaterial({ color: '#2b2d30', metalness: 0.35, roughness: 0.55 });
  const stones = new THREE.MeshStandardMaterial({ color: '#4d4a47', roughness: 0.95, flatShading: true });
  const led = new THREE.MeshBasicMaterial({ color: '#ffd29a', toneMapped: false });
  // Soft LED wash on the wood; canvas-drawn, so only in the browser (with textures).
  const wash = textures ? new THREE.MeshBasicMaterial({ color: '#ffcf94', map: washTexture(), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }) : null;
  const all: THREE.Material[] = [wood, ceiling, seat, panel, floor, glass, steel, channel, heaterSteel, stones, led, ...(wash ? [wash] : [])];
  group.userData.materials = all;

  let boardCount = 0;
  const grainOf = (geometry: THREE.BoxGeometry, mat: THREE.Material, grain: Grain) => {
    if (!textures || (mat !== wood && mat !== seat && mat !== panel && mat !== ceiling)) return;
    const n = boardCount++;
    const offset = ((n * 0.6180339) % 1) * 2.4;
    const isWall = mat === wood || mat === ceiling;
    const stripe = isWall ? (grain.stripe ?? n) % 8 : 0;
    boardUV(geometry, grain, offset, isWall ? [stripe * 0.15 + 0.004, stripe * 0.15 + 0.146] : [0.004, 0.116]);
  };
  const add = (mesh: THREE.Mesh, name: string, mat: THREE.Material) => {
    mesh.name = name;
    mesh.castShadow = mat !== glass && mat !== led;
    mesh.receiveShadow = mat !== led;
    group.add(mesh);
  };
  const box = (name: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, mat: THREE.Material, grain: Grain = { along: 'x' }) => {
    if (x1 <= x0 || y1 <= y0 || z1 <= z0) return;
    const geometry = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    grainOf(geometry, mat, grain);
    add(mesh, name, mat);
  };
  /** A board from plan point a to b; its local x runs a → b. */
  const beam = (name: string, a: PlanPoint, b: PlanPoint, y0: number, y1: number, thickness: number, mat: THREE.Material, grain: Grain = { along: 'x' }) => {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const geometry = new THREE.BoxGeometry(length, y1 - y0, thickness);
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.set((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2);
    mesh.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    grainOf(geometry, mat, grain);
    add(mesh, name, mat);
  };
  /** Upward (or, flipped, downward) light wash on a vertical face; rotationY turns its +z normal. */
  const washAt = (name: string, cx: number, cz: number, rotationY: number, length: number, y: number, height: number, down = false) => {
    if (!wash || length <= 0) return;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(length, height), wash);
    mesh.position.set(cx, down ? y - height / 2 : y + height / 2, cz);
    mesh.rotation.set(0, rotationY, down ? Math.PI : 0, 'YXZ');
    mesh.renderOrder = 2;
    add(mesh, name, led);
  };
  const lerp = (p: PlanPoint, q: PlanPoint, t: number): PlanPoint => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  /** Near-constant board width and gap over a span: [start, end] offsets of each board. */
  const boards = (span: number, target: number, gap: number, min = 1): [number, number][] => {
    const count = Math.max(min, Math.round((span + gap) / (target + gap)));
    const width = (span - (count - 1) * gap) / count;
    return Array.from({ length: count }, (_, i) => [i * (width + gap), i * (width + gap) + width]);
  };
  const slab = (name: string, top: number, thickness: number, material: THREE.Material) => {
    const shape = new THREE.Shape();
    shape.moveTo(...outline[0]!);
    for (const p of outline.slice(1)) shape.lineTo(...p);
    shape.closePath();
    const mesh = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false }), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = top;
    add(mesh, name, material);
  };

  // ---- Shell: floor, ceiling, knotty horizontal wall boards (pages 1, 5, 6). ----
  slab('Continuous floor', 0, 0.045, floor);
  slab('Flat timber ceiling', H, 0.06, ceiling);
  const rows = Math.ceil((H - 0.06) / WALL_BOARD);
  const rowAt = (row: number): [number, number] => [row * (H - 0.06) / rows, (row + 1) * (H - 0.06) / rows - 0.003];
  // Timber: back wall, long side wall, short side wall (edges 2–4 are the glass front).
  for (const edge of [0, 1, 5]) {
    const a = outline[edge]!, b = outline[(edge + 1) % 6]!;
    for (let row = 0; row < rows; row++) beam(`Wall ${edge} board ${row}`, a, b, ...rowAt(row), wall, wood, { along: 'x', stripe: row * 3 + edge });
  }
  const glassPath = layout.glassPath;
  // The SKP has a short timber cheek before the left fixed glass pane.
  for (let row = 0; row < rows; row++) {
    beam(`Glass-side timber cheek board ${row}`, outline[5]!, glassPath[0], ...rowAt(row), wall, wood, { along: 'x', stripe: row * 5 + 1 });
  }

  // ---- Frameless glass front: three fixed panes and a 720 mm door (SKP edges 3 and 4). ----
  for (let edge = 0; edge < 4; edge++) {
    const a = glassPath[edge]!, b = glassPath[edge + 1]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const at = (u: number): PlanPoint => [a[0] + (b[0] - a[0]) * u / length, a[1] + (b[1] - a[1]) * u / length];
    const dir: PlanPoint = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const normal: PlanPoint = [-dir[1], dir[0]];
    if (edge === 1) {
      // SKP: a full-height door (same head as the panes) hung from the door-side pane,
      // its bar handle 190 mm from the free edge at 0.82–1.32 m, hinges at 0.23 m and H − 0.31 m.
      const top = H - 0.085;
      beam('Glass door', at(0.006), at(length - 0.006), 0.015, top, 0.008, options.door === 'timber' ? wood : glass, { along: 'y' });
      const handle = at(length - 0.19);
      for (const side of [-1, 1]) {
        const c: PlanPoint = [handle[0] + normal[0] * side * 0.055, handle[1] + normal[1] * side * 0.055];
        box('Door handle', c[0] - 0.0125, c[0] + 0.0125, 0.82, 1.32, c[1] - 0.0125, c[1] + 0.0125, steel);
        for (const y of [0.9, 1.24]) {
          const s: PlanPoint = [handle[0] + normal[0] * side * 0.03, handle[1] + normal[1] * side * 0.03];
          box('Door handle standoff', s[0] - 0.008, s[0] + 0.008, y - 0.008, y + 0.008, s[1] - 0.008, s[1] + 0.008, steel);
        }
      }
      // Glass-to-glass hinges between the door-side pane and the door.
      for (const y of [0.23, H - 0.31 - 0.085]) {
        const h = at(0);
        beam('Door hinge', [h[0] - dir[0] * 0.045, h[1] - dir[1] * 0.045], [h[0] + dir[0] * 0.045, h[1] + dir[1] * 0.045], y, y + 0.085, 0.03, steel);
      }
    } else beam('Full-height glass', at(0.004), at(length - 0.004), 0.025, H - 0.085, 0.008, glass, { along: 'y' });
    beam('Glass head rail', a, b, H - 0.10, H - 0.06, 0.045, wood);
    beam('Glass floor channel', a, b, 0, 0.025, 0.04, channel);
    if (edge === 0 || edge === 3) {
      // Vertical timber batten where the glass meets the walls (page 5).
      const jamb = edge === 0 ? a : b;
      box('Glass timber jamb', jamb[0] - 0.022, jamb[0] + 0.022, 0, H - 0.06, jamb[1] - 0.022, jamb[1] + 0.022, panel, { along: 'y' });
    }
  }

  // ---- Upper bench along the back wall (pages 1, 5, 6, 8). ----
  const { upperTop, lowerTop, upperDepth, benchStart: x0, benchEnd: x1, benchBack: back } = layout;
  const { returnBack, returnFront, returnStart } = layout;
  const seatUnder = upperTop - SEAT;
  for (const [i, [s, e]] of boards(upperDepth, SLAT, SLAT_GAP, 4).entries()) {
    box(`Upper bench seat slat ${i}`, x0, x1, seatUnder, upperTop, back + s, back + e, seat);
  }
  const supports = Math.max(2, Math.ceil((x1 - x0) / 0.60) + 1);
  for (let i = 0; i < supports; i++) {
    const x = x0 + 0.04 + (x1 - x0 - 0.08) * i / (supports - 1);
    box(`Upper bench support ${i}`, x - 0.022, x + 0.022, upperTop - 0.12, seatUnder, back + 0.02, back + upperDepth - FRONT_SETBACK - 0.02, panel);
  }
  const upperFront = back + upperDepth - FRONT_SETBACK;
  const returnSide = returnStart + FRONT_SETBACK;
  const frontRows = (top: number) => boards(top - FOOT, FRONT_BOARD, BOARD_GAP, 2).map(([s, e]): [number, number] => [FOOT + s, FOOT + e]);
  for (const [i, [y0, y1]] of frontRows(seatUnder).entries()) {
    box(`Upper bench front board ${i}`, x0, returnSide + 0.02, y0, y1, upperFront - 0.02, upperFront, panel);
  }
  box('Upper bench plinth', x0, returnSide + 0.02, 0, FOOT - 0.004, upperFront - 0.03, upperFront - 0.01, panel);
  if (options.lights.underBench) {
    box('Upper bench under-seat light', x0 + 0.08, returnSide - 0.02, seatUnder - 0.012, seatUnder - 0.004, upperFront + 0.004, upperFront + 0.016, led);
    washAt('Upper bench front wash', (x0 + returnSide) / 2, upperFront + 0.003, 0, returnSide - x0 - 0.1, seatUnder - 0.012, 0.5, true);
  }

  // ---- Upper return on the right wall; its slats run towards the glass (pages 1, 2, 5). ----
  const returnSlats = boards(x1 - returnStart, SLAT, SLAT_GAP, 4);
  for (const [i, [s, e]] of returnSlats.entries()) {
    box(`Upper return seat slat ${i}`, returnStart + s, returnStart + e, seatUnder, upperTop, returnBack, returnFront, seat, { along: 'z' });
  }
  for (const z of [returnBack + 0.10, returnFront - 0.10]) {
    box('Upper return support', returnSide + 0.02, x1 - 0.02, upperTop - 0.12, seatUnder, z - 0.022, z + 0.022, panel);
  }
  const endFace = returnFront - 0.004;
  for (const [i, [y0, y1]] of frontRows(seatUnder).entries()) {
    box(`Upper return front board ${i}`, returnSide, returnSide + 0.02, y0, y1, upperFront, endFace - 0.026, panel, { along: 'z' });
  }
  // Vertical end boards line up with the seat slats above them (page 2).
  for (const [i, [s, e]] of returnSlats.entries()) {
    box(`Upper return end board ${i}`, Math.max(returnSide, returnStart + s), returnStart + e, FOOT, seatUnder, endFace - 0.026, endFace, panel, { along: 'y' });
  }
  box('Upper return end foot rail', returnSide, x1, 0, FOOT - 0.004, endFace - 0.03, endFace - 0.006, panel);
  box('Upper return plinth', returnSide + 0.01, returnSide + 0.03, 0, FOOT - 0.004, upperFront, endFace - 0.03, panel, { along: 'z' });
  if (options.lights.underBench) {
    box('Upper return under-seat light', returnSide - 0.016, returnSide - 0.004, seatUnder - 0.012, seatUnder - 0.004, returnBack + 0.06, returnFront - 0.08, led, { along: 'z' });
    washAt('Upper return front wash', returnSide - 0.003, (returnBack + returnFront) / 2, -Math.PI / 2, returnFront - returnBack - 0.14, seatUnder - 0.012, 0.5, true);
  }

  // ---- Diagonal lower step below the L (pages 7, 3, 9). ----
  const [a, b, d, c] = layout.lowerCorners;
  const lowerWidth = Math.hypot(c[0] - a[0], c[1] - a[1]);
  const lowerSlats = boards(lowerWidth, SLAT, SLAT_GAP, 4);
  for (const [i, [s, e]] of lowerSlats.entries()) {
    const t = (s + e) / 2 / lowerWidth;
    beam(`Diagonal lower seat slat ${i}`, lerp(a, c, t), lerp(b, d, t), lowerTop - SEAT, lowerTop, e - s, seat);
  }
  for (const t of [0.10, 0.62]) {
    beam('Diagonal lower support', lerp(a, b, t), lerp(c, d, t), lowerTop - 0.12, lowerTop - SEAT, 0.045, panel);
  }
  // Light support panel of vertical slats on top and bottom rails (pages 3, 9).
  const panelAt = 0.35;
  const pa = lerp(a, b, panelAt), pc = lerp(c, d, panelAt);
  for (const [i, [s, e]] of boards(lowerWidth - 0.06, 0.085, 0.012, 3).entries()) {
    beam(`Diagonal lower support slat ${i}`, lerp(pa, pc, (0.03 + s) / lowerWidth), lerp(pa, pc, (0.03 + e) / lowerWidth), FOOT, lowerTop - 0.12, 0.022, panel, { along: 'y' });
  }
  beam('Diagonal lower support rail', lerp(pa, pc, 0.02), lerp(pa, pc, 0.98), 0, FOOT - 0.004, 0.035, panel);
  // The exposed end follows the seat slats with vertical boards (page 7).
  const lowerEndWidth = Math.hypot(d[0] - b[0], d[1] - b[1]);
  for (const [i, [s, e]] of boards(lowerEndWidth, SLAT, END_GAP, 3).entries()) {
    beam(`Diagonal lower end slat ${i}`, lerp(b, d, s / lowerEndWidth), lerp(b, d, e / lowerEndWidth), FOOT, lowerTop - SEAT, 0.026, panel, { along: 'y' });
  }
  beam('Diagonal lower end foot rail', b, d, 0, FOOT - 0.004, 0.03, panel);

  // ---- Backrest: three loose boards on battens along both upper walls (pages 1, 5, 6). ----
  const backrestTop = upperTop + BACKREST_RAISE + 3 * BACKREST_BOARD + 2 * BACKREST_GAP;
  if (options.backrest !== 'none') {
    for (let row = 0; row < 3; row++) {
      const y = upperTop + BACKREST_RAISE + row * (BACKREST_BOARD + BACKREST_GAP);
      box(`Backrest ${row}`, x0 + 0.05, x1 - BACKREST_STANDOFF - 0.026, y, y + BACKREST_BOARD, back + BACKREST_STANDOFF, back + BACKREST_STANDOFF + 0.026, seat);
      box(`Return backrest ${row}`, x1 - BACKREST_STANDOFF - 0.026, x1 - BACKREST_STANDOFF, y, y + BACKREST_BOARD,
        returnBack + 0.06, returnFront - 0.06, seat, { along: 'z' });
    }
    const battens = Math.max(2, Math.ceil((x1 - x0) / 0.8) + 1);
    for (let i = 0; i < battens; i++) {
      const x = x0 + 0.15 + (x1 - x0 - 0.3) * i / (battens - 1);
      box('Backrest batten', x - 0.02, x + 0.02, upperTop + BACKREST_RAISE + 0.02, backrestTop - 0.02, back, back + BACKREST_STANDOFF, panel, { along: 'y' });
    }
  }
  if (options.lights.backrest) {
    const y = options.backrest !== 'none' ? backrestTop - 0.012 : upperTop + 0.5;
    box('Backrest light', x0 + 0.08, x1 - 0.08, y, y + 0.008, back + 0.004, back + 0.012, led);
    washAt('Backrest wall wash', (x0 + x1) / 2, back + 0.003, 0, x1 - x0 - 0.12, y - 0.04, 0.65);
    washAt('Return backrest wall wash', x1 - 0.003, (returnBack + returnFront) / 2, -Math.PI / 2, returnFront - returnBack - 0.12, y - 0.04, 0.65);
  }

  // ---- Heater: dark steel body with a pale timber rim round the stones (page 7). ----
  const [hx, hz] = layout.heater;
  const storage = options.heater === 'storage';
  const hw = storage ? 0.21 : 0.24, hd = storage ? 0.19 : 0.21, hTop = storage ? 1.08 : 0.88;
  box('Heater body', hx - hw, hx + hw, 0.02, hTop, hz - hd, hz + hd, heaterSteel);
  for (const z of [hz - hd - 0.001, hz + hd - 0.019]) box('Heater timber rim', hx - hw - 0.001, hx + hw + 0.001, hTop, hTop + 0.065, z, z + 0.02, seat);
  for (const x of [hx - hw - 0.001, hx + hw - 0.019]) box('Heater timber rim', x, x + 0.02, hTop, hTop + 0.065, hz - hd + 0.019, hz + hd - 0.019, seat, { along: 'z' });
  const stone = new THREE.DodecahedronGeometry(0.03, 0);
  let k = 0;
  const nx = 7, nz = 6;
  for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
    const r = (k * 0.7548777) % 1, q = (k * 0.5698403) % 1;
    const mesh = new THREE.Mesh(k === 0 ? stone : stone.clone(), stones);
    mesh.position.set(hx - hw + 0.05 + ix * (2 * hw - 0.1) / (nx - 1) + (r - 0.5) * 0.015, hTop + 0.035 + q * 0.03, hz - hd + 0.05 + iz * (2 * hd - 0.1) / (nz - 1) + (q - 0.5) * 0.015);
    mesh.rotation.set(r * 3, q * 3, (r + q) * 2);
    mesh.scale.setScalar(0.85 + r * 0.35);
    add(mesh, `Heater stone ${k++}`, stones);
  }
  // layout.ts works in the SKP mirrored in x; mirror back to the source's handedness.
  group.scale.x = -1;
  group.updateMatrixWorld(true);
  return group;
}

export function ReferenceSauna({ specs, options, onReady }: { specs: ViewerSpecs; options: ViewerOptions; onReady?: () => void }) {
  const sources = useTexture([knottyWoodUrl, knottyNormalUrl, clearWoodUrl, clearNormalUrl, benchWoodUrl]);
  const textures = useMemo<ReferenceTextures>(() => {
    const [knotty, knottyNormal, clear, clearNormal, bench] = sources.map(t => t!.clone());
    for (const [t, colour] of [[knotty, true], [knottyNormal, false], [clear, true], [clearNormal, false], [bench, true]] as const) {
      t!.colorSpace = colour ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t!.wrapS = t!.wrapT = THREE.RepeatWrapping;
      t!.anisotropy = 8;
      t!.needsUpdate = true;
    }
    for (const t of [knotty, knottyNormal, clear, clearNormal]) t!.repeat.set(1 / 2.4, 1 / 1.2);
    bench!.repeat.set(1 / 1.2, 1 / 0.12);
    return { knotty: knotty!, knottyNormal: knottyNormal!, clear: clear!, clearNormal: clearNormal!, bench: bench! };
  }, [sources]);
  useEffect(() => () => { for (const t of Object.values(textures)) t.dispose(); }, [textures]);
  const key = JSON.stringify([specs.widthMm, specs.depthMm, specs.heightMm, options]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- geometry depends on the complete serialized specification
  const group = useMemo(() => buildReferenceSauna(specs, options, textures), [key, textures]);
  useEffect(() => onReady?.(), [onReady]);
  useEffect(() => {
    return () => {
      group.traverse(obj => { if (obj instanceof THREE.Mesh) obj.geometry.dispose(); });
      for (const material of group.userData.materials as THREE.Material[]) material.dispose();
    };
  }, [group]);
  return <primitive object={group} />;
}
