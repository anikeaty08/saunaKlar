import { add, computeLayout, len, mul, sub, wallLine, type Vec2 } from './layout.ts';
import type { KitSpec } from './spec.ts';
import { interiorPolygon } from './structure.ts';

export interface InteriorView {
  /** Where the viewer stands (eye height), world coordinates. */
  eye: [number, number, number];
  /** What the viewer looks at first. */
  look: [number, number, number];
}

/**
 * The first-person viewpoint inside a kit sauna: standing just inside the door,
 * looking across to the benches, like the owner's interior photos.
 */
export function interiorView(spec: KitSpec): InteriorView {
  if (spec.form === 'barrel') {
    const turn = spec.width > spec.depth;
    const width = turn ? spec.depth : spec.width;
    const length = turn ? spec.width : spec.depth;
    const R = Math.min(width, spec.height) / 2 - 0.03;
    const yc = R + 0.14;
    const floorY = yc - R * 0.7;
    const eye: [number, number, number] = [0, Math.min(floorY + 1.45, yc + R * 0.5), length / 2 - 0.42];
    const look: [number, number, number] = [0, floorY + 0.75, -length / 2];
    // Built along z and turned a quarter when wider than deep: (x, z) → (z, −x).
    const q = (p: [number, number, number]): [number, number, number] => (turn ? [p[2], p[1], -p[0]] : p);
    return { eye: q(eye), look: q(look) };
  }
  const L = computeLayout(spec);
  const door = L.segments.find(s => s.door)!;
  const room = interiorPolygon(L);
  const centre = mul(room.reduce<Vec2>((a, p) => add(a, p), [0, 0]), 1 / room.length);
  const doorMid = add(wallLine(door, L.wall, 0).p, mul(door.dir, (door.door!.u0 + door.door!.u1) / 2));
  // A step inside the door, but never past the middle of a small room.
  const step = Math.min(0.55, len(sub(centre, doorMid)) * 0.6);
  const eye2 = add(doorMid, mul(door.inward, step));
  const away = sub(centre, eye2);
  const far = add(centre, mul(away, len(away) > 1e-3 ? 0.9 / len(away) : 0));
  const eyeY = L.floorY + Math.min(1.55, L.wallHeight - 0.3);
  return {
    eye: [eye2[0], eyeY, eye2[1]],
    look: [far[0], L.floorY + L.upperTop + 0.5, far[1]],
  };
}
