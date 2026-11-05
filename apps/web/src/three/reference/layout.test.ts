import { describe, expect, it } from 'vitest';
import { computeReferenceLayout, heaterStepGap, measureReferenceLayout, REFERENCE_SIZES, referenceSizeError } from './layout.ts';

const measure = (w: number, d: number, h: number) => measureReferenceLayout(computeReferenceLayout(w, d, h));

describe('measured sauna size relationships', () => {
  it('shortens bench runs when width shrinks while seat levels stay at the same height', () => {
    const reference = measure(3060, 2300, 2292);
    const narrow = measure(2400, 2300, 2292);
    expect(reference).toMatchObject({ upperLengthMm: 2974, upperDepthMm: 975, upperHeightMm: 1022, lowerHeightMm: 619 });
    expect(narrow).toMatchObject({ upperLengthMm: 2314, upperDepthMm: 975, upperHeightMm: 1022, lowerHeightMm: 619 });
    expect(narrow.upperSupportCount).toBeLessThan(reference.upperSupportCount);
  });

  it('reduces seat depth and the right return when cabin depth shrinks', () => {
    const reference = measure(3060, 2300, 2292);
    const shallow = measure(3060, 2000, 2292);
    expect(shallow.upperLengthMm).toBe(reference.upperLengthMm);
    expect(shallow.upperDepthMm).toBe(832);
    expect(shallow.returnLengthMm).toBe(1051);
    expect(shallow.upperHeightMm).toBe(reference.upperHeightMm);
  });

  it('moves both seat levels when height shrinks, preserving their 403 mm step', () => {
    const reference = measure(3060, 2300, 2292);
    const low = measure(3060, 2300, 2100);
    expect(low).toMatchObject({ upperLengthMm: reference.upperLengthMm, upperDepthMm: reference.upperDepthMm, upperHeightMm: 950, lowerHeightMm: 547 });
    expect(low.upperHeightMm - low.lowerHeightMm).toBe(403);
  });

  it('shortens the lower step before it intersects the heater in compact cabins', () => {
    const reference = computeReferenceLayout(3060, 2300, 2292);
    const compact = computeReferenceLayout(2400, 2000, 2100);
    // SKP lower-step corner, 1150 mm + 787.5 mm from the back wall's outer face.
    expect(reference.lowerCorners[1][0]).toBeCloseTo(0.768, 6);
    expect(reference.lowerCorners[1][1]).toBeCloseTo(0.7875, 3);
    expect(measureReferenceLayout(reference)).toMatchObject({ lowerLengthMm: 1398, lowerWidthMm: 675 });
    expect(measureReferenceLayout(compact)).toMatchObject({ lowerLengthMm: 892, lowerWidthMm: 564 });
    for (const width of [2400, 2700, 3060, 3300, 3600]) {
      for (const depth of [2000, 2150, 2300, 2500, 2700]) {
        const layout = computeReferenceLayout(width, depth, 2292);
        expect(heaterStepGap(layout), `${width} × ${depth} mm heater to step gap`).toBeGreaterThanOrEqual(0.0249);
      }
    }
  });

  it('follows the SKP front: glass posts at the outline, back wall to big pane 2300 mm', () => {
    const layout = computeReferenceLayout(3060, 2300, 2292);
    expect(layout.outline[2]).toEqual([1.53, 1.15]);
    const [glassStart, doorStart, , middleEnd, glassEnd] = layout.glassPath;
    // Big pane 22 mm inside the front posts; door-side pane on the line 1098 mm from the back wall.
    expect(glassEnd[1]).toBeCloseTo(1.1285, 3);
    expect(middleEnd[1]).toBeCloseTo(glassEnd[1], 6);
    expect(doorStart[1]).toBeCloseTo(-1.15 + 1.0985, 3);
    expect(glassStart[1]).toBeCloseTo(doorStart[1], 6);
    expect(layout.outline[5]![1]).toBeGreaterThan(doorStart[1]);
  });

  it('holds the measured 720 mm door while its fixed panes follow width and depth', () => {
    for (const [width, depth] of [[2400, 2000], [3060, 2300], [3600, 2700]] as const) {
      const layout = computeReferenceLayout(width, depth, 2292);
      const [left, doorStart, doorEnd, middleEnd, right] = layout.glassPath;
      expect(Math.round(Math.hypot(doorEnd[0] - doorStart[0], doorEnd[1] - doorStart[1]) * 1000)).toBe(720);
      expect(Math.hypot(middleEnd[0] - doorEnd[0], middleEnd[1] - doorEnd[1])).toBeGreaterThan(0.2);
      expect(left[0]).toBeLessThan(doorStart[0]);
      expect(right[0]).toBeGreaterThan(middleEnd[0]);
      expect(layout.heater[1] + 0.21).toBeLessThan(middleEnd[1]);
    }
  });

  it('offers every size pair except the six that stretch the facets beyond the measured angles', () => {
    const rejected: string[] = [];
    for (const width of REFERENCE_SIZES.width) for (const depth of REFERENCE_SIZES.depth) for (const height of REFERENCE_SIZES.height) {
      const error = referenceSizeError(width, depth, height);
      if (error && !rejected.includes(`${width}x${depth}`)) rejected.push(`${width}x${depth}`);
    }
    // packages/db/src/seed.ts excludes exactly these width/depth pairs.
    expect(rejected).toEqual(['2400x2300', '2400x2500', '2400x2700', '2700x2700', '3600x2000', '3600x2150']);
    expect(referenceSizeError(3060, 2300, 2292)).toBeNull();
  });
});
