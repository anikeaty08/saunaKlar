/**
 * Measured six-sided construction in metres. The 3060 × 2300 × 2292 mm
 * SketchUp cabin fixes the reference positions; the PDF fixes the visible
 * seat/backrest treatment. Every downstream mesh reads this layout.
 *
 * Frame: x runs along the long back wall, z from the back wall (−D/2) to the
 * front glass (+D/2), y up. This layout is the SKP mirrored in x (its long
 * side wall at +x); the renderer mirrors the finished group so the cabin
 * shows the SKP's handedness (long side wall and big pane on the left, door
 * and short timber cheek on the right when seen from the front).
 *
 * Source positions below are the SKP's, measured from the centre of its
 * overall bounding box (which includes stray geometry 0.71 m in front of the
 * glass): `zs` = metres from that centre, back wall at −1.5065, front glass
 * posts at +0.794. `fz` maps them onto the real 2300 mm cabin depth.
 */
export type PlanPoint = [number, number];

export interface ReferenceLayout {
  width: number;
  depth: number;
  height: number;
  wall: number;
  outline: PlanPoint[];
  /** Measured fixed pane, door, fixed pane, fixed pane junctions in plan. */
  glassPath: [PlanPoint, PlanPoint, PlanPoint, PlanPoint, PlanPoint];
  benchStart: number;
  benchEnd: number;
  benchBack: number;
  upperDepth: number;
  upperTop: number;
  lowerTop: number;
  returnStart: number;
  returnBack: number;
  returnFront: number;
  /** Lower strip corners, seen from above: inner back/front, outer front/back. */
  lowerCorners: [PlanPoint, PlanPoint, PlanPoint, PlanPoint];
  heater: PlanPoint;
}

export interface ReferenceMeasurements {
  upperLengthMm: number;
  upperDepthMm: number;
  upperHeightMm: number;
  returnLengthMm: number;
  returnWidthMm: number;
  lowerLengthMm: number;
  lowerWidthMm: number;
  lowerHeightMm: number;
  upperSupportCount: number;
}

const SOURCE_WIDTH = 3.060;
/** Back wall outer face to front glass posts' outer face in the SKP (not its 3013 mm bounding box). */
const SOURCE_DEPTH = 2.300;
const SOURCE_BACK = -1.5065;
const SOURCE_HEIGHT = 2.292;
const SOURCE_UPPER_TOP = 1.022;
const STEP_HEIGHT = 0.403;
const WALL = 0.043;
// The source heater sits very close to the lower step. This preserves a small
// physical gap when shrinking the cabin; it is not a certified heater clearance.
const MIN_HEATER_STEP_GAP = 0.025;

function polygonGap(first: PlanPoint[], second: PlanPoint[]): number {
  let separated = false;
  for (const polygon of [first, second]) for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]!, b = polygon[(i + 1) % polygon.length]!;
    const axis: PlanPoint = [b[1] - a[1], a[0] - b[0]];
    const project = (points: PlanPoint[]) => points.map(p => p[0] * axis[0] + p[1] * axis[1]);
    const p = project(first), q = project(second);
    if (Math.max(...p) < Math.min(...q) || Math.max(...q) < Math.min(...p)) separated = true;
  }
  if (!separated) return 0;
  const pointSegment = (p: PlanPoint, a: PlanPoint, b: PlanPoint) => {
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz);
  };
  let gap = Infinity;
  for (const [points, edges] of [[first, second], [second, first]] as const) {
    for (const p of points) for (let i = 0; i < edges.length; i++) {
      gap = Math.min(gap, pointSegment(p, edges[i]!, edges[(i + 1) % edges.length]!));
    }
  }
  return gap;
}

export function heaterStepGap(layout: ReferenceLayout): number {
  const [x, z] = layout.heater;
  const heater: PlanPoint[] = [[x - 0.24, z - 0.21], [x + 0.24, z - 0.21],
    [x + 0.24, z + 0.21], [x - 0.24, z + 0.21]];
  return polygonGap(layout.lowerCorners, heater);
}

export function computeReferenceLayout(widthMm: number, depthMm: number, heightMm: number): ReferenceLayout {
  const width = widthMm / 1000, depth = depthMm / 1000, height = heightMm / 1000;
  if (width < 2.4 || width > 3.6 || depth < 1.9 || depth > 2.8 || height < 2.1 || height > 2.7) {
    throw new Error('Reference sauna dimensions are outside the supported range');
  }
  const fx = (xs: number) => xs * width / SOURCE_WIDTH;
  const fz = (zs: number) => -depth / 2 + (zs - SOURCE_BACK) * depth / SOURCE_DEPTH;
  const glassScale = (x: number, z: number): PlanPoint => [fx(x), fz(z)];
  const benchStart = -width / 2 + WALL;
  const benchEnd = width / 2 - WALL;
  const benchBack = -depth / 2 + WALL;
  // The SKP upper bench front stands 81 mm behind the door-side glass; depth trades seat depth for that gap.
  const doorSideGlass = fz(-0.408);
  const upperDepth = Math.min(0.975, doorSideGlass - 0.0805 - benchBack);
  if (upperDepth < 0.65) throw new Error('Cabin depth cannot fit the reference upper bench');
  const upperTop = Math.min(1.15, Math.max(0.95, height - (SOURCE_HEIGHT - SOURCE_UPPER_TOP)));
  const lowerTop = upperTop - STEP_HEIGHT;
  const glassStart = glassScale(-1.174, -0.408);
  const doorStart = glassScale(-0.354, -0.408);
  const middleEnd = glassScale(0.088, 0.772);
  const glassEnd = glassScale(1.480, 0.772);
  const diagonalLength = Math.hypot(middleEnd[0] - doorStart[0], middleEnd[1] - doorStart[1]);
  if (diagonalLength < 0.92) throw new Error('Cabin cannot fit the measured glass door and fixed pane');
  const doorEnd: PlanPoint = [
    doorStart[0] + (middleEnd[0] - doorStart[0]) * 0.72 / diagonalLength,
    doorStart[1] + (middleEnd[1] - doorStart[1]) * 0.72 / diagonalLength,
  ];
  // Keep the measured heater body behind the right glass when depth shrinks.
  const heater: PlanPoint = [0.35, Math.min(fz(0.53), middleEnd[1] - 0.235)];
  const lowerBack = glassScale(-0.304, -0.466);
  const lowerFront = glassScale(0.768, 0.431);
  const lowerOuterFront = glassScale(1.204, -0.090);
  const lowerOuterBack = glassScale(0.128, -0.985);
  const lowerAt = (run: number): [PlanPoint, PlanPoint, PlanPoint, PlanPoint] => {
    const between = (a: PlanPoint, b: PlanPoint): PlanPoint => [a[0] + (b[0] - a[0]) * run, a[1] + (b[1] - a[1]) * run];
    return [lowerBack, between(lowerBack, lowerFront), between(lowerOuterBack, lowerOuterFront), lowerOuterBack];
  };
  const layout: ReferenceLayout = {
    width, depth, height, wall: WALL,
    // Back wall, long side wall, big front pane, diagonal pane + door, door-side
    // pane + timber cheek, short side wall: the glass posts' outer faces.
    outline: [
      [-0.5 * width, -0.5 * depth], [0.5 * width, -0.5 * depth],
      [0.5 * width, 0.5 * depth], [middleEnd[0] - 0.012, 0.5 * depth],
      [doorStart[0] - 0.008, fz(-0.386)], [-0.5 * width, fz(-0.386)],
    ],
    glassPath: [glassStart, doorStart, doorEnd, middleEnd, glassEnd],
    benchStart, benchEnd, benchBack, upperDepth, upperTop, lowerTop,
    returnStart: benchEnd - 0.68,
    returnBack: benchBack + upperDepth,
    // The return ends 74 mm behind the big front pane, as in the SKP.
    returnFront: 0.5 * depth - 0.0741,
    lowerCorners: lowerAt(1), heater,
  };
  if (heaterStepGap(layout) < MIN_HEATER_STEP_GAP) {
    let short = 0.55, long = 1;
    layout.lowerCorners = lowerAt(short);
    if (heaterStepGap(layout) < MIN_HEATER_STEP_GAP) throw new Error('Cabin cannot fit the lower step and heater');
    for (let i = 0; i < 24; i++) {
      const middle = (short + long) / 2;
      layout.lowerCorners = lowerAt(middle);
      if (heaterStepGap(layout) >= MIN_HEATER_STEP_GAP) short = middle;
      else long = middle;
    }
    layout.lowerCorners = lowerAt(short);
  }
  return layout;
}

/** Offered catalogue sizes (mm). The measured reference is 3060 × 2300 × 2292. */
export const REFERENCE_SIZES = {
  width: [2400, 2700, 3060, 3300, 3600],
  depth: [2000, 2150, 2300, 2500, 2700],
  height: [2100, 2292, 2400, 2700],
} as const;

/**
 * Width/depth ratio band the six-sided outline is offered in. The outline's
 * facets scale with width and depth separately, so a strongly stretched cabin
 * would turn the measured 69° diagonal glass facet into a different angle.
 * Within 1.06–1.67 (source 1.330, i.e. 0.8–1.25 times it) it stays within
 * about ±5° of the SKP. The catalogue seed (packages/db/src/seed.ts) excludes
 * the same pairs as rules.
 */
export const REFERENCE_ASPECT_RANGE = [1.06, 1.67] as const;

/** Why a size cannot be built, or null when it can. */
export function referenceSizeError(widthMm: number, depthMm: number, heightMm: number): string | null {
  const aspect = widthMm / depthMm;
  if (aspect < REFERENCE_ASPECT_RANGE[0] || aspect > REFERENCE_ASPECT_RANGE[1]) {
    return 'Width and depth stretch the six-sided outline too far from the measured facet angles';
  }
  try {
    computeReferenceLayout(widthMm, depthMm, heightMm);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

export function measureReferenceLayout(layout: ReferenceLayout): ReferenceMeasurements {
  const distance = (a: PlanPoint, b: PlanPoint) => Math.hypot(b[0] - a[0], b[1] - a[1]);
  const length = layout.benchEnd - layout.benchStart;
  const [innerBack, innerFront, , outerBack] = layout.lowerCorners;
  return {
    upperLengthMm: Math.round(length * 1000),
    upperDepthMm: Math.round(layout.upperDepth * 1000),
    upperHeightMm: Math.round(layout.upperTop * 1000),
    returnLengthMm: Math.round((layout.returnFront - layout.returnBack) * 1000),
    returnWidthMm: Math.round((layout.benchEnd - layout.returnStart) * 1000),
    lowerLengthMm: Math.round(distance(innerBack, innerFront) * 1000),
    lowerWidthMm: Math.round(distance(innerBack, outerBack) * 1000),
    lowerHeightMm: Math.round(layout.lowerTop * 1000),
    upperSupportCount: Math.max(2, Math.ceil(length / 0.60) + 1),
  };
}
