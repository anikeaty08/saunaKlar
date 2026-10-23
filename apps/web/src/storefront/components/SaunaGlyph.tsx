import { memo, useMemo } from 'react';

/**
 * Axonometric line drawing of a sauna, generated from its form and real
 * dimensions. Faces are culled and painted back to front (so hidden lines
 * vanish) and shaded with three paper tones — the drawing stays inside the
 * single-colour palette and needs no image asset.
 */
export type SaunaForm = 'box' | 'panorama' | 'corner' | 'barrel' | 'hex' | 'cabin';

type V3 = [number, number, number];
interface Face {
  pts: V3[];
  /** Line details drawn on the face when it is visible. */
  decals?: V3[][];
  /** Glass faces get a lighter fill. */
  glass?: boolean;
  /** A point inside the solid this face belongs to; used to orient the normal outwards. */
  inside?: V3;
}

const TH = (-38 * Math.PI) / 180;
const PH = (24 * Math.PI) / 180;

function project([x, y, z]: V3): { sx: number; sy: number; depth: number } {
  const xr = x * Math.cos(TH) + z * Math.sin(TH);
  const zr = -x * Math.sin(TH) + z * Math.cos(TH);
  return { sx: xr, sy: -(y * Math.cos(PH) - zr * Math.sin(PH)), depth: y * Math.sin(PH) + zr * Math.cos(PH) };
}

function normal(p: V3[]): V3 {
  // Newell's method, robust for any planar polygon.
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1, z1] = p[i]!;
    const [x2, y2, z2] = p[(i + 1) % p.length]!;
    nx += (y1 - y2) * (z1 + z2);
    ny += (z1 - z2) * (x1 + x2);
    nz += (x1 - x2) * (y1 + y2);
  }
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}

/** View direction in model space (towards the camera). */
const VIEW: V3 = (() => {
  const v: V3 = [-Math.sin(TH) * Math.cos(PH), Math.sin(PH), Math.cos(TH) * Math.cos(PH)];
  return v;
})();
const LIGHT: V3 = [-0.45, 0.8, 0.4];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const quad = (a: V3, b: V3, c: V3, d: V3): V3[] => [a, b, c, d];

/** Extrudes a footprint (x,z, counter-clockwise seen from above) to height h. */
function prism(foot: [number, number][], h: number, y0 = 0): Face[] {
  const faces: Face[] = [];
  const n = foot.length;
  const cx = foot.reduce((s, p) => s + p[0], 0) / n;
  const cz = foot.reduce((s, p) => s + p[1], 0) / n;
  const inside: V3 = [cx, y0 + h / 2, cz];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = foot[i]!;
    const [x2, z2] = foot[(i + 1) % n]!;
    faces.push({ pts: quad([x1, y0, z1], [x2, y0, z2], [x2, y0 + h, z2], [x1, y0 + h, z1]), inside });
  }
  faces.push({ pts: foot.map(([x, z]) => [x, y0 + h, z] as V3), inside });
  return faces;
}

/** Flips faces whose normal points into their solid. */
function orient(f: Face, fallback: V3): Face {
  const inside = f.inside ?? fallback;
  const n = normal(f.pts);
  const c = f.pts.reduce<V3>((s, p) => [s[0] + p[0] / f.pts.length, s[1] + p[1] / f.pts.length, s[2] + p[2] / f.pts.length], [0, 0, 0]);
  const out: V3 = [c[0] - inside[0], c[1] - inside[1], c[2] - inside[2]];
  return dot(n, out) < 0 ? { ...f, pts: [...f.pts].reverse() } : f;
}

function grooves(a: V3, b: V3, h: number, y0: number, count: number): V3[][] {
  const out: V3[][] = [];
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    out.push([[x, y0, z], [x, y0 + h, z]]);
  }
  return out;
}

function rect(x1: number, y1: number, x2: number, y2: number, z: number): V3[] {
  return [[x1, y1, z], [x2, y1, z], [x2, y2, z], [x1, y2, z], [x1, y1, z]];
}

function build(form: SaunaForm, W: number, D: number, H: number): Face[] {
  const w = W / 2;
  const d = D / 2;
  switch (form) {
    case 'barrel': {
      const r = Math.min(W, H) / 2;
      const n = 22;
      const faces: Face[] = [];
      const ring = (z: number) => Array.from({ length: n }, (_, i) => {
        const a = (i / n) * Math.PI * 2;
        return [Math.cos(a) * r, r + Math.sin(a) * r, z] as V3;
      });
      const front = ring(d);
      const back = ring(-d);
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const bands: V3[][] = [0.18, 0.82].map(t => [
          [front[i]![0], front[i]![1], -d + D * t],
          [front[j]![0], front[j]![1], -d + D * t],
        ]);
        faces.push({ pts: quad(back[i]!, back[j]!, front[j]!, front[i]!), decals: bands, inside: [0, r, 0] });
      }
      const door = rect(-r * 0.32, r * 0.12, r * 0.32, r * 1.55, d);
      faces.push({ pts: [...front], decals: [door, [[-r * 0.22, r * 1.1, d], [r * 0.22, r * 1.1, d]]], inside: [0, r, 0] });
      faces.push({ pts: [...back], inside: [0, r, 0] });
      // Cradles
      for (const z of [-d * 0.7, d * 0.7]) {
        faces.push(...prism([[-r * 0.9, z - 60], [r * 0.9, z - 60], [r * 0.9, z + 60], [-r * 0.9, z + 60]], r * 0.28, -40));
      }
      return faces;
    }
    case 'hex': {
      const R = Math.min(W, D) / 2;
      const wallH = H * 0.72;
      const foot: [number, number][] = Array.from({ length: 6 }, (_, i) => {
        const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
        return [Math.cos(a) * R, -Math.sin(a) * R];
      });
      const faces = prism(foot, wallH).slice(0, 6);
      // Door on the face nearest the viewer, grooves on the rest.
      faces.forEach((f, i) => {
        const [a, b] = [f.pts[0]!, f.pts[1]!];
        f.decals = grooves(a, b, wallH, 0, 6);
        if (i === 4) {
          const mx = (a[0] + b[0]) / 2;
          const mz = (a[2] + b[2]) / 2;
          const ux = (b[0] - a[0]) * 0.18;
          const uz = (b[2] - a[2]) * 0.18;
          f.decals = [[[mx - ux, 0, mz - uz], [mx + ux, 0, mz + uz], [mx + ux, wallH * 0.86, mz + uz], [mx - ux, wallH * 0.86, mz - uz], [mx - ux, 0, mz - uz]]];
          f.glass = true;
        }
      });
      const apex: V3 = [0, H * 0.94, 0];
      const eave = foot.map(([x, z]) => [x * 1.12, wallH, z * 1.12] as V3);
      for (let i = 0; i < 6; i++) faces.push({ pts: [eave[i]!, eave[(i + 1) % 6]!, apex], inside: [0, wallH, 0] });
      faces.push(...prism(Array.from({ length: 6 }, (_, i) => {
        const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
        return [Math.cos(a) * R * 0.22, -Math.sin(a) * R * 0.22] as [number, number];
      }), H * 0.14, H * 0.86));
      return faces;
    }
    case 'cabin': {
      const wallH = H * 0.66;
      const over = 160;
      const porch = D * 0.28;
      const body: [number, number][] = [[-w, -d], [w, -d], [w, d - porch], [-w, d - porch]];
      const faces = prism(body, wallH).slice(0, 4);
      // Facade under the porch roof: door + window.
      const fz = d - porch;
      faces[2]!.decals = grooves([w, 0, -d], [w, 0, fz], wallH, 0, 9);
      faces[3]!.decals = [];
      // Front gable (pentagon) at the porch line.
      const ridge = H;
      faces.push({
        pts: [[-w, 0, fz], [w, 0, fz], [w, wallH, fz], [0, ridge, fz], [-w, wallH, fz]],
        inside: [0, wallH / 2, (fz - d) / 2],
        decals: [rect(-w * 0.62, 0, -w * 0.18, wallH * 0.86, fz), rect(w * 0.12, wallH * 0.4, w * 0.62, wallH * 0.78, fz)],
      });
      faces.push({ pts: [[-w, 0, -d], [-w, wallH, -d], [0, ridge, -d], [w, wallH, -d], [w, 0, -d]], inside: [0, wallH / 2, (fz - d) / 2] });
      // Roof planes with overhang, extended over the porch.
      faces.push({ pts: quad([w + over, wallH - 80, -d - over], [w + over, wallH - 80, d + over], [0, ridge + 40, d + over], [0, ridge + 40, -d - over]), inside: [0, wallH / 2, 0] });
      faces.push({ pts: quad([-w - over, wallH - 80, d + over], [-w - over, wallH - 80, -d - over], [0, ridge + 40, -d - over], [0, ridge + 40, d + over]), inside: [0, wallH / 2, 0] });
      // Deck and posts.
      faces.push(...prism([[-w, fz], [w, fz], [w, d], [-w, d]], 90, -90));
      for (const x of [-w + 60, w - 60]) faces.push(...prism([[x - 45, d - 90], [x + 45, d - 90], [x + 45, d], [x - 45, d]], wallH - 80));
      return faces;
    }
    case 'corner': {
      const c = Math.min(W, D) * 0.48;
      const foot: [number, number][] = [[-w, -d], [w, -d], [w, d - c], [w - c, d], [-w, d]];
      const faces = prism(foot, H);
      // Chamfer face carries the glass door.
      const f = faces[2]!;
      const [a, b] = [f.pts[0]!, f.pts[1]!];
      f.glass = true;
      f.decals = [
        [lerp3(a, b, 0.15, 30), lerp3(a, b, 0.85, 30), lerp3(a, b, 0.85, H * 0.9), lerp3(a, b, 0.15, H * 0.9), lerp3(a, b, 0.15, 30)],
      ];
      faces[1]!.decals = grooves(faces[1]!.pts[0]!, faces[1]!.pts[1]!, H, 0, 5);
      faces[3]!.decals = [...grooves(faces[3]!.pts[0]!, faces[3]!.pts[1]!, H, 0, 9), [[-w, H * 0.45, d], [w - c, H * 0.45, d]]];
      return faces;
    }
    case 'panorama':
    case 'box':
    default: {
      const faces = prism([[-w, -d], [w, -d], [w, d], [-w, d]], H);
      const front = faces[2]!;
      const side = faces[1]!;
      side.decals = grooves(side.pts[0]!, side.pts[1]!, H, 0, Math.max(4, Math.round(D / 220)));
      const z = d;
      if (form === 'panorama') {
        front.glass = true;
        front.decals = [
          [[-w / 3, 0, z], [-w / 3, H, z]],
          [[w / 3, 0, z], [w / 3, H, z]],
          [[-w, H * 0.42, z], [w, H * 0.42, z]],
          [[-w, H * 0.68, z], [-w / 3, H * 0.68, z]],
        ];
      } else {
        front.decals = [
          rect(w * 0.05, 40, w * 0.85, H * 0.9, z),
          [[w * 0.12, H * 0.48, z], [w * 0.12, H * 0.56, z]],
          ...grooves([-w, 0, z], [0, 0, z], H, 0, 5),
          [[-w, H * 0.48, z], [0, H * 0.48, z]],
        ];
      }
      return faces;
    }
  }
}

function lerp3(a: V3, b: V3, t: number, y: number): V3 {
  return [a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t];
}

interface Props {
  form: SaunaForm;
  widthMm: number;
  depthMm: number;
  heightMm: number;
  title?: string;
  className?: string;
  /** Draw a dimension line under the drawing. */
  showDims?: string;
  strokeWidth?: number;
}

export const SaunaGlyph = memo(function SaunaGlyph({ form, widthMm, depthMm, heightMm, title, className, showDims, strokeWidth = 1.25 }: Props) {
  const drawing = useMemo(() => {
    const faces = build(form, widthMm, depthMm, heightMm).map(f => orient(f, [0, heightMm / 2, 0]));
    const visible = faces
      .map(f => {
        const n = normal(f.pts);
        return { f, n, facing: dot(n, VIEW), depth: f.pts.reduce((s, p) => s + project(p).depth, 0) / f.pts.length };
      })
      .filter(x => x.facing > 0.01)
      .sort((a, b) => a.depth - b.depth);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const path = (pts: V3[], close: boolean) =>
      pts
        .map((p, i) => {
          const { sx, sy } = project(p);
          minX = Math.min(minX, sx);
          maxX = Math.max(maxX, sx);
          minY = Math.min(minY, sy);
          maxY = Math.max(maxY, sy);
          return `${i ? 'L' : 'M'}${sx.toFixed(1)} ${sy.toFixed(1)}`;
        })
        .join('') + (close ? 'Z' : '');
    const items = visible.map(({ f, n }) => {
      const lit = dot(n, LIGHT);
      const tone = f.glass ? 'glass' : lit > 0.55 ? 'top' : lit > 0.05 ? 'lit' : 'shade';
      return { d: path(f.pts, true), tone, decals: (f.decals ?? []).map(dc => path(dc, false)) };
    });
    const pad = Math.max(maxX - minX, maxY - minY) * 0.06;
    return { items, box: [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2] as const };
  }, [form, widthMm, depthMm, heightMm]);

  const [x, y, w, h] = drawing.box;
  const sw = (Math.max(w, h) / 320) * strokeWidth;
  return (
    <svg className={['glyph', className].filter(Boolean).join(' ')} viewBox={`${x} ${y} ${w} ${h + (showDims ? h * 0.12 : 0)}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} preserveAspectRatio="xMidYMid meet">
      <g strokeLinejoin="round" strokeLinecap="round" stroke="currentColor">
        {drawing.items.map((it, i) => (
          <g key={i}>
            <path d={it.d} className={`glyph__face glyph__face--${it.tone}`} strokeWidth={sw} />
            {it.decals.map((dd, j) => (
              <path key={j} d={dd} fill="none" strokeWidth={sw * 0.6} opacity={0.75} />
            ))}
          </g>
        ))}
      </g>
      {showDims && (
        <g className="glyph__dims">
          <line x1={x + w * 0.1} x2={x + w * 0.9} y1={y + h + h * 0.05} y2={y + h + h * 0.05} stroke="currentColor" strokeWidth={sw * 0.6} />
          <text x={x + w / 2} y={y + h + h * 0.105} textAnchor="middle" fontSize={h * 0.045} fill="currentColor" fontFamily="var(--font-mono)">
            {showDims}
          </text>
        </g>
      )}
    </svg>
  );
});
