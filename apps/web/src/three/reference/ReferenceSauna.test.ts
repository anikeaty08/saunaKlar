import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_VIEWER_OPTIONS, type ViewerSpecs } from '../types.ts';
import { buildReferenceSauna } from './ReferenceSauna.tsx';
import { computeReferenceLayout } from './layout.ts';

function measure(widthMm: number, depthMm: number, heightMm: number) {
  const specs: ViewerSpecs = { form: 'hex', source: 'reference', widthMm, depthMm, heightMm };
  const group = buildReferenceSauna(specs, DEFAULT_VIEWER_OPTIONS);
  const seat = group.getObjectByName('Upper bench seat slat 0')!;
  const lower = group.getObjectByName('Diagonal lower seat slat 0')!;
  const upperReturn = group.getObjectByName('Upper return seat slat 0')!;
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(seat).getSize(size);
  const upperSlats = group.children.filter(o => o.name.startsWith('Upper bench seat slat '));
  const depth = new THREE.Box3();
  for (const slat of upperSlats) depth.expandByObject(slat);
  const result = {
    upperLengthMm: Math.round(size.x * 1000),
    upperDepthMm: Math.round((depth.max.z - depth.min.z) * 1000),
    upperHeightMm: Math.round(new THREE.Box3().setFromObject(seat).max.y * 1000),
    lowerHeightMm: Math.round(new THREE.Box3().setFromObject(lower).max.y * 1000),
    upperReturnLengthMm: Math.round((new THREE.Box3().setFromObject(upperReturn).max.z - new THREE.Box3().setFromObject(upperReturn).min.z) * 1000),
    lowerIsDiagonal: Math.abs(lower.rotation.y) > 0.1,
    supportCount: group.children.filter(o => o.name.startsWith('Upper bench support ')).length,
    hasGlassDoor: Boolean(group.getObjectByName('Glass door')),
  };
  group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  for (const m of group.userData.materials as THREE.Material[]) m.dispose();
  return result;
}

describe('reference sauna dimensions', () => {
  it('rebuilds the bench and supports when width and height change', () => {
    expect(measure(3060, 2300, 2292)).toMatchObject({ upperLengthMm: 2974, upperDepthMm: 975, upperReturnLengthMm: 1208, upperHeightMm: 1022, lowerHeightMm: 619, lowerIsDiagonal: true, supportCount: 6, hasGlassDoor: true });
    expect(measure(2400, 2000, 2100)).toMatchObject({ upperLengthMm: 2314, upperDepthMm: 832, upperReturnLengthMm: 1051, upperHeightMm: 950, lowerHeightMm: 547, lowerIsDiagonal: true, supportCount: 5, hasGlassDoor: true });
    expect(measure(3600, 2700, 2700)).toMatchObject({ upperLengthMm: 3514, upperHeightMm: 1150, lowerHeightMm: 747, supportCount: 7, hasGlassDoor: true });
  });

  it('keeps the SKP timber walls, its four-segment glass front and its handedness', () => {
    const group = buildReferenceSauna(
      { form: 'hex', source: 'reference', widthMm: 3060, depthMm: 2300, heightMm: 2292 },
      DEFAULT_VIEWER_OPTIONS,
    );
    // Back, long side and short side are timber; the three front edges are glass.
    expect(group.children.some(o => o.name.startsWith('Wall 2 board '))).toBe(false);
    for (const edge of [0, 1, 5]) expect(group.children.some(o => o.name.startsWith(`Wall ${edge} board `))).toBe(true);
    // Seen from the front the long side wall and the big pane are on the left, the door on the right.
    const centre = (name: string) => new THREE.Box3().setFromObject(group.getObjectByName(name)!).getCenter(new THREE.Vector3());
    expect(centre('Wall 1 board 0').x).toBeLessThan(-1.4);
    expect(centre('Glass door').x).toBeGreaterThan(0);
    expect(centre('Upper return seat slat 0').x).toBeLessThan(0);
    expect(group.children.filter(o => o.name === 'Full-height glass')).toHaveLength(3);
    expect(group.children.filter(o => o.name === 'Glass door')).toHaveLength(1);
    group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    for (const m of group.userData.materials as THREE.Material[]) m.dispose();
  });

  it('continues the photographed backrest along the depth-dependent right return', () => {
    for (const depthMm of [2000, 2300, 2700]) {
      const group = buildReferenceSauna(
        { form: 'hex', source: 'reference', widthMm: 3060, depthMm, heightMm: 2292 },
        DEFAULT_VIEWER_OPTIONS,
      );
      const returnSeat = group.getObjectByName('Upper return seat slat 0')!;
      const backrest = group.getObjectByName('Return backrest 0')!;
      const seatBounds = new THREE.Box3().setFromObject(returnSeat);
      const backrestBounds = new THREE.Box3().setFromObject(backrest);
      expect(Math.round((seatBounds.max.z - seatBounds.min.z - 0.12) * 1000))
        .toBe(Math.round((backrestBounds.max.z - backrestBounds.min.z) * 1000));
      expect(backrestBounds.min.y).toBeGreaterThan(seatBounds.max.y);
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const m of group.userData.materials as THREE.Material[]) m.dispose();
    }
  });

  it('rebuilds the lower step end boards from its changing cross-section', () => {
    const counts = [2000, 2300, 2700].map(depthMm => {
      const group = buildReferenceSauna(
        { form: 'hex', source: 'reference', widthMm: 3060, depthMm, heightMm: 2292 },
        DEFAULT_VIEWER_OPTIONS,
      );
      const boards = group.children.filter(o => o.name.startsWith('Diagonal lower end slat '));
      expect(boards.length).toBeGreaterThanOrEqual(3);
      expect(group.getObjectByName('Diagonal lower end foot rail')).toBeDefined();
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const m of group.userData.materials as THREE.Material[]) m.dispose();
      return boards.length;
    });
    expect(counts[0]).toBeLessThan(counts[2]!);
  });

  it('keeps the default reference unlit while permitting selected bench lighting', () => {
    const specs: ViewerSpecs = { form: 'hex', source: 'reference', widthMm: 3060, depthMm: 2300, heightMm: 2292 };
    const base = buildReferenceSauna(specs, DEFAULT_VIEWER_OPTIONS);
    expect(base.getObjectByName('Backrest light')).toBeUndefined();
    expect(base.getObjectByName('Upper bench under-seat light')).toBeUndefined();
    const litOptions = structuredClone(DEFAULT_VIEWER_OPTIONS);
    litOptions.lights.backrest = true;
    litOptions.lights.underBench = true;
    const lit = buildReferenceSauna(specs, litOptions);
    expect(lit.getObjectByName('Backrest light')).toBeDefined();
    expect(lit.getObjectByName('Upper bench under-seat light')).toBeDefined();
    for (const group of [base, lit]) {
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const m of group.userData.materials as THREE.Material[]) m.dispose();
    }
  });

  it('keeps the heater and diagonal step inside every proposed footprint', () => {
    const widths = [2400, 2700, 3060, 3300, 3600];
    const depths = [2000, 2150, 2300, 2500, 2700];
    const heights = [2100, 2292, 2400, 2700];
    const inside = (x: number, z: number, poly: [number, number][]) => {
      let hit = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
      }
      return hit;
    };
    for (const widthMm of widths) for (const depthMm of depths) for (const heightMm of heights) {
      // The rendered cabin is the layout mirrored in x.
      const polygon = computeReferenceLayout(widthMm, depthMm, heightMm).outline.map(([x, z]): [number, number] => [-x, z]);
      const group = buildReferenceSauna({ form: 'hex', source: 'reference', widthMm, depthMm, heightMm }, DEFAULT_VIEWER_OPTIONS);
      const heater = new THREE.Box3().setFromObject(group.getObjectByName('Heater body')!);
      for (const x of [heater.min.x, heater.max.x]) for (const z of [heater.min.z, heater.max.z]) {
        expect(inside(x, z, polygon), `heater at ${widthMm}x${depthMm}x${heightMm}, corner ${x},${z}`).toBe(true);
      }
      for (const slat of group.children.filter(o => o.name.startsWith('Diagonal lower seat slat '))) {
        const mesh = slat as THREE.Mesh;
        mesh.updateWorldMatrix(true, false);
        const box = mesh.geometry.boundingBox ?? (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox!);
        for (const x of [box.min.x, box.max.x]) for (const z of [box.min.z, box.max.z]) {
          const p = new THREE.Vector3(x, 0, z).applyMatrix4(mesh.matrixWorld);
          expect(inside(p.x, p.z, polygon), `diagonal step at ${widthMm}x${depthMm}x${heightMm}, corner ${p.x},${p.z}`).toBe(true);
        }
      }
      group.traverse(o => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
      for (const m of group.userData.materials as THREE.Material[]) m.dispose();
    }
  });
});
