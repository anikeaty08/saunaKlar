#!/usr/bin/env node
/**
 * Writes a real file into the local object store for every catalogue asset the seed inserted,
 * so a fresh dev database shows images and 3D models instead of 404s.
 *
 *   - MODEL_THUMBNAIL / MODEL_GALLERY / OPTION_THUMBNAIL / ROOM_THUMBNAIL: line drawings in the
 *     single brand ink, rendered from SVG with sharp (sauna silhouette, interior, plan view,
 *     option glyph, room perspective) with the item's name.
 *   - MODEL_GLB_LOW / MODEL_GLB_HIGH / MODEL_AR_GLB: the Espoo Compact sample GLBs from
 *     tools/catalog-import/examples/models, for every model (it is our one real asset).
 *   - Anything else (USDZ, option/room meshes, reseller branding) is left alone.
 *
 * Layout = what the local server reads (services/api/src/adapters/storage/local.ts):
 *   <LOCAL_OBJECTS_DIR or <repo>/var/objects>/<S3_ASSETS_BUCKET or assets>/data/<key>
 *   ... /meta/<key>.json  { contentType, byteSize }
 * Existing files are kept, so running it again only fills gaps. `--force` rewrites everything.
 *
 * Run by `npm run db:seed` (after the database seed) and by scripts/dev.mjs.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sauna:sauna@127.0.0.1:5432/sauna';
const OBJECTS = resolve(process.env.LOCAL_OBJECTS_DIR || join(ROOT, 'var', 'objects'));
const BUCKET = process.env.S3_ASSETS_BUCKET || 'assets';
const FORCE = process.argv.includes('--force');
const SAMPLE_GLB = {
  low: join(ROOT, 'tools/catalog-import/examples/models/espoo-compact-low.glb'),
  high: join(ROOT, 'tools/catalog-import/examples/models/espoo-compact.glb'),
};

const INK = '#1c1c1a';
const PAPER = '#f7f7f4';
const FONT = `'Inter Display', Inter, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
const MONO = `'JetBrains Mono', 'DejaVu Sans Mono', Menlo, Consolas, monospace`;

const say = (msg) => console.log(`[seed-media] ${msg}`);

// ---- object store ---------------------------------------------------------------

const KEY_RE = /^[A-Za-z0-9][A-Za-z0-9/._-]*$/;
function objectPath(kind, key) {
  if (!KEY_RE.test(key) || key.includes('..') || key.includes('//')) throw new Error(`invalid object key ${key}`);
  const base = join(OBJECTS, BUCKET, kind);
  const full = resolve(base, key + (kind === 'meta' ? '.json' : ''));
  if (!full.startsWith(base + sep)) throw new Error(`invalid object key ${key}`);
  return full;
}

async function exists(path) {
  return stat(path).then((s) => s.isFile(), () => false);
}

async function atomicWrite(path, body) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, body);
  await rename(tmp, path);
}

async function putObject(key, body, contentType) {
  await atomicWrite(objectPath('data', key), body);
  await atomicWrite(objectPath('meta', key), JSON.stringify({ contentType, byteSize: body.byteLength }));
}

// ---- drawing helpers ------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pts = (list) => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
const nf = (n) => new Intl.NumberFormat('en-GB').format(n);

function frame(width, height, body, { dark = false } = {}) {
  const bg = dark ? INK : PAPER;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="${bg}"/>
  ${body}
</svg>`;
}

/** Name block: small mono eyebrow, large display name, optional spec line. */
function caption(x, y, { eyebrow, title, spec, size = 92, color = INK }) {
  return `<g fill="${color}">
    ${eyebrow ? `<text x="${x}" y="${y - size - 28}" font-family="${MONO}" font-size="${Math.round(size * 0.24)}" letter-spacing="${(size * 0.04).toFixed(1)}">${esc(eyebrow.toUpperCase())}</text>` : ''}
    <text x="${x - 4}" y="${y}" font-family="${FONT}" font-weight="600" font-size="${size}" letter-spacing="${(-size * 0.035).toFixed(1)}">${esc(title)}</text>
    ${spec ? `<text x="${x}" y="${y + size * 0.55}" font-family="${MONO}" font-size="${Math.round(size * 0.24)}" letter-spacing="${(size * 0.02).toFixed(1)}" opacity="0.72">${esc(spec)}</text>` : ''}
  </g>`;
}

/**
 * Oblique extrusion of a convex front profile (mm, y up). Faces facing away from the depth
 * vector are painted first, then the visible side faces, then the front, so the result reads
 * as a solid line drawing without hidden-line maths.
 */
function prism(profile, v, toPx, { stroke = INK, front = PAPER, shade = [0.05, 0.13], width = 3 } = {}) {
  // Ensure counter-clockwise (in y-up space) so the outward normal of edge (a→b) is (dy, -dx).
  const area = profile.reduce((s, [x1, y1], i) => {
    const [x2, y2] = profile[(i + 1) % profile.length];
    return s + (x1 * y2 - x2 * y1);
  }, 0);
  const p = area < 0 ? [...profile].reverse() : profile;
  const back = [];
  const visible = [];
  p.forEach((a, i) => {
    const b = p[(i + 1) % p.length];
    const n = [b[1] - a[1], -(b[0] - a[0])];
    const len = Math.hypot(n[0], n[1]) || 1;
    const facing = (n[0] * v[0] + n[1] * v[1]) / len;
    const quad = [a, b, [b[0] + v[0], b[1] + v[1]], [a[0] + v[0], a[1] + v[1]]];
    // Upward faces light, sideways faces darker.
    const tone = n[1] / len > 0.5 ? shade[0] : shade[1];
    (facing > 1e-6 ? visible : back).push({ quad, tone });
  });
  const face = ({ quad, tone }) =>
    `<polygon points="${pts(quad.map(toPx))}" fill="${PAPER}"/><polygon points="${pts(quad.map(toPx))}" fill="${stroke}" fill-opacity="${tone}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`;
  return [
    ...back.map(face),
    ...visible.map(face),
    `<polygon points="${pts(p.map(toPx))}" fill="${front}" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`,
  ].join('\n');
}

function formOf(slug) {
  if (slug.includes('barrel')) return 'barrel';
  if (slug.includes('cube')) return 'cube';
  if (slug.includes('studio')) return 'house';
  if (slug.includes('panorama')) return 'glass';
  if (slug.includes('corner')) return 'corner';
  return 'cabin';
}

/** Sauna exterior in oblique view, fitted into a box; returns SVG markup. */
function saunaDrawing(model, box) {
  const w = model.widthMm || 2000;
  const d = model.depthMm || 2000;
  const h = model.heightMm || 2100;
  const form = formOf(model.slug);
  const k = 0.42;
  const v = [d * k * Math.cos(Math.PI / 6), d * k * Math.sin(Math.PI / 6)];
  const roofH = form === 'cabin' || form === 'house' ? h * 0.2 : 0;
  const bodyH = h - roofH;
  const overhang = form === 'house' ? w * 0.06 : 0;
  const totalW = w + v[0] + 2 * overhang;
  const totalH = h + v[1] + (form === 'cube' ? 90 : 0);
  const s = Math.min(box.w / totalW, box.h / totalH);
  const ox = box.x + (box.w - totalW * s) / 2 + overhang * s;
  const floorY = box.y + box.h;
  const toPx = ([x, y]) => [ox + x * s, floorY - y * s];
  const line = (a, b, extra = '') => {
    const [x1, y1] = toPx(a);
    const [x2, y2] = toPx(b);
    return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${INK}" ${extra.includes('stroke-width') ? '' : 'stroke-width="2"'} ${extra}/>`;
  };
  const rect = (x, y, rw, rh, extra = '') => `<polygon points="${pts([[x, y], [x + rw, y], [x + rw, y + rh], [x, y + rh]].map(toPx))}" ${extra.includes('fill=') ? '' : 'fill="none"'} stroke="${INK}" stroke-width="2.5" ${extra}/>`;
  const out = [];

  // Ground shadow and floor line.
  const shadow = [[-overhang * 0.5, 0], [w, 0], [w + v[0], v[1]], [v[0] * 0.15 - overhang * 0.5, v[1] * 0.15]];
  out.push(`<polygon points="${pts(shadow.map(([x, y]) => toPx([x + 160, y])))}" fill="${INK}" fill-opacity="0.07"/>`);

  if (form === 'barrel') {
    const r = Math.min(w, h) / 2;
    const cx = w / 2;
    const seg = 28;
    const circle = Array.from({ length: seg }, (_, i) => {
      const a = (i / seg) * Math.PI * 2;
      return [cx + r * Math.cos(a), r + r * Math.sin(a)];
    });
    out.push(prism(circle, v, toPx, { shade: [0.06, 0.12] }));
    // Hoops: the half of the ring that faces the viewer, at two depths.
    const vl = Math.hypot(v[0], v[1]);
    const facing = Array.from({ length: 49 }, (_, i) => Math.atan2(v[1], v[0]) - Math.PI / 2 + (i / 48) * Math.PI)
      .map((a) => [cx + r * Math.cos(a), r + r * Math.sin(a)]);
    for (const f of [0.2, 0.8]) {
      const arc = facing.map(([x, y]) => [x + (v[0] * f * vl) / vl, y + (v[1] * f * vl) / vl]);
      out.push(`<polyline points="${pts(arc.map(toPx))}" fill="none" stroke="${INK}" stroke-width="2.5" opacity="0.6"/>`);
    }
    // Staves on the front and a round-topped door.
    for (let i = 1; i < 8; i++) {
      const x = cx - r + (2 * r * i) / 8;
      const dy = Math.sqrt(Math.max(0, r * r - (x - cx) ** 2));
      out.push(line([x, r - dy], [x, r + dy], 'opacity="0.25"'));
    }
    const dw = r * 0.62;
    const dh = r * 1.35;
    out.push(`<path d="M${toPx([cx - dw / 2, 0]).join(',')} L${toPx([cx - dw / 2, dh - dw / 2]).join(',')} A${(dw / 2) * s},${(dw / 2) * s} 0 0 1 ${toPx([cx + dw / 2, dh - dw / 2]).join(',')} L${toPx([cx + dw / 2, 0]).join(',')}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`);
    out.push(`<path d="M${toPx([cx - dw / 2 + 60, 60]).join(',')} L${toPx([cx - dw / 2 + 60, dh - dw / 2]).join(',')} A${(dw / 2 - 60) * s},${(dw / 2 - 60) * s} 0 0 1 ${toPx([cx + dw / 2 - 60, dh - dw / 2]).join(',')} L${toPx([cx + dw / 2 - 60, 60]).join(',')}" fill="${INK}" fill-opacity="0.08" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(line([cx + dw / 2 - 120, dh * 0.45], [cx + dw / 2 - 120, dh * 0.6], 'stroke-width="4" stroke-linecap="round"'));
    return out.join('\n');
  }

  // Body profile.
  const body = form === 'glass' || form === 'corner'
    ? [[0, 0], [w, 0], [w, bodyH * 0.9], [0, bodyH]] // mono-pitch roof
    : [[0, 0], [w, 0], [w, bodyH], [0, bodyH]];
  out.push(prism(body, v, toPx));

  // Roofs.
  if (form === 'cabin' || form === 'house') {
    const ov = form === 'house' ? overhang : w * 0.03;
    const gable = [[-ov, bodyH - 20], [w + ov, bodyH - 20], [w / 2, h]];
    out.push(prism(gable, v, toPx, { shade: [0.1, 0.2] }));
  } else if (form === 'cube') {
    const slab = [[-60, bodyH], [w + 60, bodyH], [w + 60, bodyH + 90], [-60, bodyH + 90]];
    out.push(prism(slab, v, toPx, { shade: [0.16, 0.2] }));
    // Green roof: a band of short grass strokes along the slab top.
    for (let i = 0; i < 40; i++) {
      const f = 0.15 + ((i * 37) % 40) / 48;
      const along = -40 + (w + 80) * (((i * 13) % 40) / 40);
      const base = [along + v[0] * f, bodyH + 90 + v[1] * f];
      out.push(line(base, [base[0] + 6 + (i % 3) * 4, base[1] + 28 + (i % 4) * 10], 'stroke-width="1.5" opacity="0.5"'));
    }
  } else {
    // Thin fascia along the mono-pitch roof.
    out.push(line([-40, bodyH + 30], [w + 40, bodyH * 0.9 + 30], 'stroke-width="3"'));
  }

  // Wall boards on the front.
  const boardsTop = (x) => (form === 'glass' || form === 'corner' ? bodyH - (bodyH * 0.1 * x) / w : bodyH);
  for (let x = 140; x < w; x += 140) out.push(line([x, 0], [x, boardsTop(x)], 'opacity="0.16" stroke-width="1.5"'));

  if (form === 'glass') {
    // Full-height glass front with bench tiers behind it.
    const gx = w * 0.08;
    const gw = w * 0.84;
    const gh = bodyH * 0.8;
    out.push(`<polygon points="${pts([[gx, 60], [gx + gw, 60], [gx + gw, gh], [gx, gh]].map(toPx))}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="2.5"/>`);
    out.push(line([gx + gw * 0.62, 60], [gx + gw * 0.62, gh]));
    for (const [y, inset] of [[gh * 0.3, 0.06], [gh * 0.55, 0.16]]) out.push(line([gx + gw * inset, y], [gx + gw * 0.6, y], 'stroke-width="3" opacity="0.5"'));
    out.push(line([gx + gw * 0.58, gh * 0.4], [gx + gw * 0.58, gh * 0.55], 'stroke-width="4" stroke-linecap="round"'));
    out.push(line([gx + gw * 0.05, gh * 0.95], [gx + gw * 0.25, gh * 0.75], 'opacity="0.35" stroke-width="1.5"'));
  } else {
    // Door with a glass panel and handle, plus a window.
    const dw = Math.min(700, w * 0.32);
    const dh = Math.min(1900, bodyH * 0.84);
    const dx = form === 'house' ? w * 0.14 : w * 0.16;
    out.push(`<polygon points="${pts([[dx, 0], [dx + dw, 0], [dx + dw, dh], [dx, dh]].map(toPx))}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`);
    out.push(rect(dx + 80, 260, dw - 160, dh - 420, `fill="${INK}" fill-opacity="${form === 'corner' ? 0.14 : 0.08}"`));
    out.push(line([dx + dw - 70, dh * 0.42], [dx + dw - 70, dh * 0.56], 'stroke-width="4" stroke-linecap="round"'));
    const wx = dx + dw + (w - dx - dw) * 0.25;
    const ww = (w - dx - dw) * 0.5;
    if (ww > 250 && form !== 'house') {
      out.push(rect(wx, bodyH * 0.45, ww, bodyH * 0.28, `fill="${INK}" fill-opacity="0.07"`));
      out.push(line([wx + ww / 2, bodyH * 0.45], [wx + ww / 2, bodyH * 0.73], 'stroke-width="1.5"'));
    }
    if (form === 'house') {
      // Second door: the changing room.
      const d2 = w * 0.62;
      out.push(`<polygon points="${pts([[d2, 0], [d2 + dw, 0], [d2 + dw, dh], [d2, dh]].map(toPx))}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`);
      out.push(line([d2 + 70, dh * 0.42], [d2 + 70, dh * 0.56], 'stroke-width="4" stroke-linecap="round"'));
      // Terrace boards in front.
      for (let i = 0; i < 6; i++) out.push(line([-overhang + i * 30, -10 - i * 30], [w + overhang, -10 - i * 30], 'opacity="0.18" stroke-width="1.5"'));
    }
  }
  // Chimney for every non-barrel model: the heater flue.
  const fx = w * 0.72;
  const fy = form === 'cabin' || form === 'house' ? bodyH + roofH * 0.55 : form === 'cube' ? bodyH + 90 : bodyH * 0.93;
  const flue = [[fx, fy - 30], [fx + 110, fy - 30], [fx + 110, fy + 420], [fx, fy + 420]].map(([x, y]) => [x + v[0] * 0.5, y + v[1] * 0.5]);
  out.push(`<polygon points="${pts(flue.map(toPx))}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`);
  out.push(line([flue[3][0] - 20, flue[3][1]], [flue[2][0] + 20, flue[2][1]], 'stroke-width="4"'));
  return out.join('\n');
}

/** Interior: two bench tiers, heater with stones, board walls, warm light from the heater. */
function interiorDrawing(box) {
  const { x, y, w, h } = box;
  const P = PAPER;
  const out = [];
  out.push(`<defs><radialGradient id="glow" cx="0.74" cy="0.55" r="0.6"><stop offset="0" stop-color="${P}" stop-opacity="0.22"/><stop offset="1" stop-color="${P}" stop-opacity="0"/></radialGradient></defs>`);
  out.push(`<rect x="0" y="0" width="100%" height="100%" fill="url(#glow)"/>`);
  // Back wall boards and floor.
  const floorY = y + h * 0.86;
  for (let i = 0; i <= 22; i++) {
    const yy = y + (i * (floorY - y)) / 22;
    out.push(`<line x1="${x}" y1="${yy}" x2="${x + w}" y2="${yy}" stroke="${P}" stroke-opacity="0.12" stroke-width="1.5"/>`);
  }
  out.push(`<line x1="${x}" y1="${floorY}" x2="${x + w}" y2="${floorY}" stroke="${P}" stroke-width="2.5"/>`);
  // Benches (upper and lower) as slatted planes.
  const bench = (bx, by, bw, bh, legs) => {
    const g = [`<rect x="${bx}" y="${by}" width="${bw}" height="${bh}" fill="${P}" fill-opacity="0.08" stroke="${P}" stroke-width="2.5"/>`];
    for (let i = 1; i < 5; i++) g.push(`<line x1="${bx}" y1="${by + (bh * i) / 5}" x2="${bx + bw}" y2="${by + (bh * i) / 5}" stroke="${P}" stroke-opacity="0.45" stroke-width="1.5"/>`);
    for (const lx of legs) g.push(`<line x1="${lx}" y1="${by + bh}" x2="${lx}" y2="${floorY}" stroke="${P}" stroke-width="2.5"/>`);
    return g.join('');
  };
  out.push(bench(x, y + h * 0.38, w * 0.62, h * 0.08, [x + w * 0.05, x + w * 0.57]));
  out.push(bench(x, y + h * 0.6, w * 0.5, h * 0.08, [x + w * 0.08, x + w * 0.45]));
  // Backrest slats above the upper bench.
  for (let i = 0; i < 3; i++) out.push(`<line x1="${x}" y1="${y + h * (0.2 + i * 0.05)}" x2="${x + w * 0.62}" y2="${y + h * (0.2 + i * 0.05)}" stroke="${P}" stroke-width="3"/>`);
  // Heater with stones.
  const hx = x + w * 0.7;
  const hw = w * 0.2;
  const hy = y + h * 0.5;
  out.push(`<rect x="${hx}" y="${hy}" width="${hw}" height="${floorY - hy}" fill="${INK}" stroke="${P}" stroke-width="2.5"/>`);
  for (let i = 0; i < 4; i++) out.push(`<line x1="${hx + 14}" y1="${hy + 40 + i * 28}" x2="${hx + hw - 14}" y2="${hy + 40 + i * 28}" stroke="${P}" stroke-opacity="0.5" stroke-width="1.5"/>`);
  for (let i = 0; i < 9; i++) {
    const sx = hx + 18 + (i % 5) * (hw - 36) / 4 + (i > 4 ? (hw - 36) / 8 : 0);
    const sy = hy - (i > 4 ? 34 : 14);
    out.push(`<ellipse cx="${sx}" cy="${sy}" rx="${hw / 9}" ry="${hw / 13}" fill="${INK}" stroke="${P}" stroke-width="2"/>`);
  }
  // Steam.
  for (let i = 0; i < 3; i++) {
    const sx = hx + hw * (0.3 + i * 0.2);
    out.push(`<path d="M${sx},${hy - 70} c-18,-30 18,-50 0,-80 c-18,-30 18,-50 0,-80" fill="none" stroke="${P}" stroke-opacity="0.45" stroke-width="2" stroke-linecap="round"/>`);
  }
  // Bucket and ladle on the lower bench.
  const bx = x + w * 0.3;
  const by = y + h * 0.6;
  out.push(`<path d="M${bx},${by - 70} L${bx + 70},${by - 70} L${bx + 60},${by} L${bx + 10},${by} Z" fill="${INK}" stroke="${P}" stroke-width="2.5"/>`);
  out.push(`<line x1="${bx + 50}" y1="${by - 60}" x2="${bx + 120}" y2="${by - 150}" stroke="${P}" stroke-width="3" stroke-linecap="round"/>`);
  return out.join('\n');
}

/** Plan view with dimension lines: the footprint, benches and heater from above. */
function planDrawing(model, box) {
  const w = model.widthMm || 2000;
  const d = model.depthMm || 2000;
  const form = formOf(model.slug);
  const s = Math.min((box.w - 160) / w, (box.h - 160) / d);
  const ox = box.x + (box.w - w * s) / 2;
  const oy = box.y + (box.h - d * s) / 2;
  const X = (mm) => ox + mm * s;
  const Y = (mm) => oy + mm * s;
  const out = [];
  const wall = 80;
  if (form === 'barrel') {
    out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${w * s}" height="${d * s}" rx="${w * s * 0.08}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="3"/>`);
  } else if (form === 'corner') {
    const c = Math.min(w, d) * 0.35;
    out.push(`<polygon points="${pts([[X(0), Y(0)], [X(w), Y(0)], [X(w), Y(d - c)], [X(w - c), Y(d)], [X(0), Y(d)]])}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="3"/>`);
  } else {
    out.push(`<rect x="${X(0)}" y="${Y(0)}" width="${w * s}" height="${d * s}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="3"/>`);
  }
  out.push(`<rect x="${X(wall)}" y="${Y(wall)}" width="${(w - 2 * wall) * s}" height="${(d - 2 * wall) * s}" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/>`);
  // Benches along the back wall and one side.
  const bd = Math.min(600, d * 0.3);
  out.push(`<rect x="${X(wall)}" y="${Y(wall)}" width="${(w - 2 * wall) * s}" height="${bd * s}" fill="${INK}" fill-opacity="0.1" stroke="${INK}" stroke-width="1.5"/>`);
  for (let i = 1; i < 5; i++) out.push(`<line x1="${X(wall)}" y1="${Y(wall + (bd * i) / 5)}" x2="${X(w - wall)}" y2="${Y(wall + (bd * i) / 5)}" stroke="${INK}" stroke-opacity="0.35" stroke-width="1"/>`);
  out.push(`<rect x="${X(wall)}" y="${Y(wall + bd)}" width="${bd * 0.8 * s}" height="${(d - 2 * wall - bd) * s * 0.6}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="1.5"/>`);
  // Heater and door swing.
  const hs = Math.min(450, w * 0.2);
  out.push(`<rect x="${X(w - wall - hs - 60)}" y="${Y(d - wall - hs - 60)}" width="${hs * s}" height="${hs * s}" fill="${INK}" stroke="${INK}" stroke-width="1.5"/>`);
  const dw = Math.min(700, w * 0.3);
  const dx = w * 0.3;
  out.push(`<path d="M${X(dx)},${Y(d)} L${X(dx)},${Y(d + dw * 0.0)} A${dw * s},${dw * s} 0 0 0 ${X(dx + dw)},${Y(d - dw)}" fill="none" stroke="${INK}" stroke-width="1.5" stroke-dasharray="6 6"/>`);
  out.push(`<line x1="${X(dx)}" y1="${Y(d)}" x2="${X(dx)}" y2="${Y(d - dw)}" stroke="${INK}" stroke-width="2.5"/>`);
  out.push(`<line x1="${X(dx)}" y1="${Y(d - dw)}" x2="${X(dx + dw)}" y2="${Y(d - dw)}" stroke="${INK}" stroke-width="0"/>`);
  // Dimension lines.
  const dim = (x1, y1, x2, y2, label, vertical) => {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    const tick = (x, y) => `<line x1="${x - 8}" y1="${y + 8}" x2="${x + 8}" y2="${y - 8}" stroke="${INK}" stroke-width="2"/>`;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${INK}" stroke-width="1.5"/>${tick(x1, y1)}${tick(x2, y2)}
      <text x="${mx}" y="${my}" font-family="${MONO}" font-size="24" fill="${INK}" text-anchor="middle" ${vertical ? `transform="rotate(-90 ${mx} ${my}) translate(0 -14)"` : 'dy="-14"'} letter-spacing="1">${esc(label)}</text>`;
  };
  out.push(dim(X(0), Y(0) - 50, X(w), Y(0) - 50, `${nf(w)} mm`, false));
  out.push(dim(X(0) - 50, Y(0), X(0) - 50, Y(d), `${nf(d)} mm`, true));
  return out.join('\n');
}

const GLYPHS = {
  wood: (c) => {
    const out = [];
    for (let i = 0; i < 6; i++) {
      const y = 190 + i * 62;
      out.push(`<rect x="170" y="${y}" width="460" height="52" rx="4" fill="${INK}" fill-opacity="${0.04 + (i % 3) * 0.04}" stroke="${INK}" stroke-width="2.5"/>`);
      out.push(`<path d="M190,${y + 26} C260,${y + 8} 330,${y + 44} 420,${y + 22} S560,${y + 12} 610,${y + 30}" fill="none" stroke="${INK}" stroke-opacity="0.4" stroke-width="1.5"/>`);
    }
    if (c.includes('thermo') || c.includes('cedar')) out.push(`<rect x="170" y="190" width="460" height="362" fill="${INK}" fill-opacity="0.12"/>`);
    return out.join('');
  },
  heater: (c) => {
    if (c.includes('wood')) {
      return `<rect x="270" y="250" width="260" height="300" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
        <rect x="310" y="400" width="180" height="110" rx="4" fill="${INK}" fill-opacity="0.85"/>
        <path d="M370,500 c-20,-40 30,-50 20,-90 c30,30 40,60 10,90 Z" fill="${PAPER}"/>
        <rect x="370" y="140" width="60" height="110" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
        ${[0, 1, 2, 3, 4].map((i) => `<ellipse cx="${300 + i * 50}" cy="250" rx="26" ry="18" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`).join('')}`;
    }
    const kw = c.match(/(\d+)kw/)?.[1] ?? '';
    return `<rect x="270" y="260" width="260" height="290" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      ${[0, 1, 2, 3].map((i) => `<line x1="295" y1="${330 + i * 40}" x2="505" y2="${330 + i * 40}" stroke="${INK}" stroke-opacity="0.35" stroke-width="2"/>`).join('')}
      ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<ellipse cx="${290 + (i % 4) * 70 + (i > 3 ? 35 : 0)}" cy="${i > 3 ? 222 : 252}" rx="34" ry="22" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`).join('')}
      <text x="400" y="525" font-family="${MONO}" font-size="30" text-anchor="middle" fill="${INK}">${esc(kw ? `${kw} kW` : '')}</text>`;
  },
  control: (c) => `<rect x="250" y="200" width="300" height="360" rx="28" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
    <circle cx="400" cy="330" r="80" fill="none" stroke="${INK}" stroke-width="3"/>
    <circle cx="400" cy="330" r="80" fill="none" stroke="${INK}" stroke-width="8" stroke-dasharray="250 600" transform="rotate(-210 400 330)"/>
    <text x="400" y="344" font-family="${MONO}" font-size="40" text-anchor="middle" fill="${INK}">80°</text>
    ${c.includes('wifi') ? `<path d="M350,490 a70,70 0 0 1 100,0 M368,510 a45,45 0 0 1 64,0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/><circle cx="400" cy="528" r="7" fill="${INK}"/>` : `<rect x="330" y="470" width="50" height="40" rx="6" fill="none" stroke="${INK}" stroke-width="3"/><rect x="420" y="470" width="50" height="40" rx="6" fill="none" stroke="${INK}" stroke-width="3"/>`}`,
  door: (c) => `<rect x="285" y="140" width="230" height="440" rx="6" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
    ${c.includes('wood')
      ? [0, 1, 2, 3, 4].map((i) => `<line x1="${315 + i * 42}" y1="160" x2="${315 + i * 42}" y2="560" stroke="${INK}" stroke-opacity="0.3" stroke-width="2"/>`).join('')
      : `<rect x="310" y="165" width="180" height="390" rx="4" fill="${INK}" fill-opacity="${c.includes('bronze') ? 0.3 : 0.06}" stroke="${INK}" stroke-width="2"/><line x1="335" y1="230" x2="400" y2="165" stroke="${INK}" stroke-opacity="0.4" stroke-width="2"/>`}
    <line x1="490" y1="330" x2="490" y2="400" stroke="${INK}" stroke-width="7" stroke-linecap="round"/>`,
  lighting: (c) => {
    if (c.includes('star')) {
      return Array.from({ length: 28 }, (_, i) => {
        const x = 180 + ((i * 97) % 440);
        const y = 170 + ((i * 61) % 360);
        const r = 2 + (i % 4) * 1.6;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;
      }).join('') + `<rect x="160" y="150" width="480" height="400" fill="none" stroke="${INK}" stroke-width="2.5"/>`;
    }
    const y = c.includes('under') ? 430 : 300;
    return `<rect x="170" y="${y - 40}" width="460" height="40" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      ${c.includes('under') ? `<rect x="170" y="${y}" width="460" height="90" fill="${INK}" fill-opacity="0.07"/>` : `<rect x="170" y="${y - 140}" width="460" height="100" fill="${INK}" fill-opacity="0.07"/>`}
      ${Array.from({ length: 9 }, (_, i) => `<circle cx="${200 + i * 50}" cy="${c.includes('under') ? y + 6 : y - 46}" r="6" fill="${INK}"/>`).join('')}
      ${Array.from({ length: 9 }, (_, i) => `<line x1="${200 + i * 50}" y1="${c.includes('under') ? y + 24 : y - 64}" x2="${200 + i * 50}" y2="${c.includes('under') ? y + 70 : y - 120}" stroke="${INK}" stroke-opacity="0.25" stroke-width="2"/>`).join('')}`;
  },
  extras: (c) => {
    if (c.includes('audio')) return `<rect x="270" y="190" width="260" height="380" rx="20" fill="${PAPER}" stroke="${INK}" stroke-width="3"/><circle cx="400" cy="440" r="80" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="400" cy="440" r="22" fill="${INK}"/><circle cx="400" cy="285" r="40" fill="none" stroke="${INK}" stroke-width="3"/>`;
    if (c.includes('aroma')) return `<path d="M400,170 C470,280 520,340 520,410 a120,120 0 0 1 -240,0 C280,340 330,280 400,170 Z" fill="${INK}" fill-opacity="0.07" stroke="${INK}" stroke-width="3"/><path d="M340,430 a60,60 0 0 0 60,60" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
    if (c.includes('salt')) return Array.from({ length: 15 }, (_, i) => `<rect x="${190 + (i % 5) * 86 + (Math.floor(i / 5) % 2) * 43}" y="${200 + Math.floor(i / 5) * 120}" width="80" height="112" rx="4" fill="${INK}" fill-opacity="${0.05 + (i % 3) * 0.05}" stroke="${INK}" stroke-width="2.5"/>`).join('');
    return `<path d="M250,300 L470,300 L445,560 L275,560 Z" fill="${PAPER}" stroke="${INK}" stroke-width="3"/>
      ${[0, 1, 2].map((i) => `<line x1="${256 + i * 2}" y1="${360 + i * 80}" x2="${464 - i * 2}" y2="${360 + i * 80}" stroke="${INK}" stroke-width="2"/>`).join('')}
      <path d="M260,300 C260,210 460,210 460,300" fill="none" stroke="${INK}" stroke-width="3"/>
      <line x1="430" y1="330" x2="590" y2="170" stroke="${INK}" stroke-width="6" stroke-linecap="round"/>
      <ellipse cx="420" cy="345" rx="40" ry="24" fill="${PAPER}" stroke="${INK}" stroke-width="3" transform="rotate(-45 420 345)"/>`;
  },
};

function optionSvg(o) {
  const glyph = (GLYPHS[o.groupCode] ?? GLYPHS.extras)(o.code);
  return frame(800, 800, `
    <text x="56" y="84" font-family="${MONO}" font-size="24" letter-spacing="2" fill="${INK}" opacity="0.7">${esc(o.groupName.toUpperCase())}</text>
    <g transform="translate(0 -10)">${glyph}</g>
    <line x1="56" y1="640" x2="744" y2="640" stroke="${INK}" stroke-width="1.5" opacity="0.25"/>
    ${caption(56, 720, { title: o.name, size: o.name.length > 22 ? 40 : 52 })}`);
}

function roomSvg(r) {
  const preset = r.preset ?? {};
  const W = 1600;
  const H = 1200;
  const floor = preset.floor ?? 'decking';
  const outdoor = floor === 'decking' || floor === 'stone';
  const lerp = (a, b, t) => a + (b - a) * t;
  const back = { x1: W * 0.28, y1: H * 0.2, x2: W * 0.72, y2: H * 0.56 };
  const out = [];
  const hline = (x1, y, x2, extra = '') => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${INK}" ${extra.includes('stroke-width') ? '' : 'stroke-width="1.5"'} ${extra}/>`;

  if (outdoor) {
    // Open air: a horizon, the deck or terrace running towards it, the landscape behind.
    const hy = back.y2;
    out.push(hline(0, hy, W, 'stroke-width="2"'));
    out.push(`<polygon points="${pts([[W * 0.08, H], [back.x1, hy], [back.x2, hy], [W * 0.92, H]])}" fill="${INK}" fill-opacity="0.04" stroke="${INK}" stroke-width="2"/>`);
    const n = floor === 'decking' ? 14 : 7;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      out.push(`<line x1="${lerp(W * 0.08, W * 0.92, t)}" y1="${H}" x2="${lerp(back.x1, back.x2, t)}" y2="${hy}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.5"/>`);
    }
    if (floor === 'stone') {
      for (let j = 1; j < 6; j++) {
        const t = (j / 6) ** 1.6;
        const y = lerp(hy, H, t);
        out.push(`<line x1="${lerp(back.x1, W * 0.08, t)}" y1="${y}" x2="${lerp(back.x2, W * 0.92, t)}" y2="${y}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.5"/>`);
      }
      // Lake: calm water lines and a far shore with a tree line.
      for (let i = 0; i < 7; i++) {
        const y = hy - 14 - i * 16;
        const inset = 40 + i * 70;
        out.push(hline(inset, y, W - inset, `stroke-opacity="${0.35 - i * 0.04}"`));
      }
      const shore = hy - 130;
      out.push(`<path d="M0,${shore} ${Array.from({ length: 33 }, (_, i) => `L${i * 50},${shore - 20 - ((i * 53) % 7) * 9}`).join(' ')} L${W},${shore} Z" fill="${INK}" fill-opacity="0.12" stroke="${INK}" stroke-width="1.5"/>`);
    } else {
      // Garden: lawn edge and a few conifers.
      for (const [tx, th] of [[W * 0.12, 260], [W * 0.2, 340], [W * 0.8, 300], [W * 0.88, 220]]) {
        out.push(`<line x1="${tx}" y1="${hy}" x2="${tx}" y2="${hy - 40}" stroke="${INK}" stroke-width="3"/>`);
        out.push(`<path d="M${tx - th * 0.22},${hy - 40} L${tx},${hy - th} L${tx + th * 0.22},${hy - 40} Z" fill="${INK}" fill-opacity="0.08" stroke="${INK}" stroke-width="2.5"/>`);
      }
      out.push(`<path d="M${W * 0.3},${hy} q${W * 0.2},-90 ${W * 0.4},0" fill="none" stroke="${INK}" stroke-opacity="0.35" stroke-width="1.5"/>`);
    }
  } else {
    // Indoor room in one-point perspective with a tiled floor.
    out.push(`<polygon points="${pts([[0, 0], [back.x1, back.y1], [back.x1, back.y2], [0, H]])}" fill="${INK}" fill-opacity="0.05" stroke="${INK}" stroke-width="2"/>`);
    out.push(`<polygon points="${pts([[W, 0], [back.x2, back.y1], [back.x2, back.y2], [W, H]])}" fill="${INK}" fill-opacity="0.09" stroke="${INK}" stroke-width="2"/>`);
    out.push(`<rect x="${back.x1}" y="${back.y1}" width="${back.x2 - back.x1}" height="${back.y2 - back.y1}" fill="${PAPER}" stroke="${INK}" stroke-width="2.5"/>`);
    out.push(`<polygon points="${pts([[0, H], [back.x1, back.y2], [back.x2, back.y2], [W, H]])}" fill="${INK}" fill-opacity="0.03" stroke="${INK}" stroke-width="2"/>`);
    for (let i = 1; i < 10; i++) {
      const t = i / 10;
      out.push(`<line x1="${lerp(0, W, t)}" y1="${H}" x2="${lerp(back.x1, back.x2, t)}" y2="${back.y2}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.5"/>`);
    }
    for (let j = 1; j < 9; j++) {
      const t = (j / 9) ** 1.8;
      const y = lerp(back.y2, H, t);
      out.push(`<line x1="${lerp(back.x1, 0, t)}" y1="${y}" x2="${lerp(back.x2, W, t)}" y2="${y}" stroke="${INK}" stroke-opacity="0.3" stroke-width="1.5"/>`);
    }
    const ww = preset.windowWall ?? 'none';
    if (ww === 'east') {
      out.push(`<polygon points="${pts([[back.x2 + 60, back.y1 + 60], [W - 120, back.y1 - 40], [W - 120, back.y2 - 60], [back.x2 + 60, back.y2 - 120]])}" fill="${INK}" fill-opacity="0.05" stroke="${INK}" stroke-width="2.5"/>`);
    } else if (ww === 'west') {
      out.push(`<polygon points="${pts([[back.x1 - 60, back.y1 + 60], [120, back.y1 - 40], [120, back.y2 - 60], [back.x1 - 60, back.y2 - 120]])}" fill="${INK}" fill-opacity="0.05" stroke="${INK}" stroke-width="2.5"/>`);
    } else if (ww !== 'none') {
      out.push(`<rect x="${back.x1 + 90}" y="${back.y1 + 50}" width="${back.x2 - back.x1 - 180}" height="${(back.y2 - back.y1) * 0.5}" fill="${INK}" fill-opacity="0.06" stroke="${INK}" stroke-width="2.5"/>`);
    }
    // A pendant lamp for scale.
    out.push(`<line x1="${W / 2}" y1="0" x2="${W / 2}" y2="${back.y1 - 40}" stroke="${INK}" stroke-width="1.5"/>`);
    out.push(`<path d="M${W / 2 - 50},${back.y1 - 10} q50,-60 100,0 Z" fill="${INK}" fill-opacity="0.85"/>`);
  }
  // Where the sauna goes: a dashed footprint on the floor.
  out.push(`<polygon points="${pts([[W / 2 - 170, H * 0.74], [W / 2 + 170, H * 0.74], [W / 2 + 120, H * 0.66], [W / 2 - 120, H * 0.66]])}" fill="none" stroke="${INK}" stroke-width="2" stroke-dasharray="10 8"/>`);
  const dims = preset.widthMm ? `${nf(preset.widthMm)} × ${nf(preset.depthMm)} mm` : '';
  out.push(`<rect x="0" y="${H - 260}" width="${W}" height="260" fill="${PAPER}"/>`);
  out.push(`<line x1="72" y1="${H - 260}" x2="${W - 72}" y2="${H - 260}" stroke="${INK}" stroke-width="2"/>`);
  out.push(caption(72, H - 110, { eyebrow: 'Room scene', title: r.name, spec: dims, size: 88 }));
  return frame(W, H, out.join('\n'));
}

function modelThumbSvg(m) {
  const W = 1600;
  const H = 1200;
  const spec = [m.widthMm && `${nf(m.widthMm)} × ${nf(m.depthMm)} × ${nf(m.heightMm)} mm`, m.persons && `${m.persons} persons`].filter(Boolean).join('  ·  ');
  return frame(W, H, `
    <text x="72" y="96" font-family="${MONO}" font-size="24" letter-spacing="3" fill="${INK}" opacity="0.7">${esc((m.manufacturer ?? '').toUpperCase())}</text>
    <text x="${W - 72}" y="96" font-family="${MONO}" font-size="24" letter-spacing="3" fill="${INK}" opacity="0.7" text-anchor="end">${esc(m.sku ?? '')}</text>
    <line x1="72" y1="900" x2="${W - 72}" y2="900" stroke="${INK}" stroke-width="2"/>
    ${saunaDrawing(m, { x: 260, y: 170, w: W - 520, h: 730 })}
    ${caption(72, 1060, { title: m.name, spec, size: 96 })}`);
}

function modelInteriorSvg(m) {
  const W = 1600;
  const H = 1200;
  return frame(W, H, `
    ${interiorDrawing({ x: 120, y: 120, w: W - 240, h: 820 })}
    ${caption(72, 1080, { eyebrow: 'Interior', title: m.name, size: 80, color: PAPER })}`, { dark: true });
}

function modelPlanSvg(m) {
  const W = 1600;
  const H = 1200;
  return frame(W, H, `
    <g stroke="${INK}" stroke-opacity="0.06" stroke-width="1">${Array.from({ length: 40 }, (_, i) => `<line x1="${i * 40}" y1="0" x2="${i * 40}" y2="${H}"/><line x1="0" y1="${i * 40}" x2="${W}" y2="${i * 40}"/>`).join('')}</g>
    ${planDrawing(m, { x: 300, y: 100, w: W - 600, h: 820 })}
    ${caption(72, 1080, { eyebrow: 'Floor plan', title: m.name, spec: m.sku, size: 80 })}`);
}

// ---- main ------------------------------------------------------------------------------

async function loadSharp() {
  try {
    return (await import('sharp')).default;
  } catch {
    throw new Error('sharp is not installed; run `npm install` at the repository root first.');
  }
}

async function render(sharp, svg, contentType) {
  if (contentType === 'image/svg+xml') return Buffer.from(svg);
  const img = sharp(Buffer.from(svg), { density: 96 });
  if (contentType === 'image/png') return img.png({ compressionLevel: 9 }).toBuffer();
  if (contentType === 'image/jpeg') return img.jpeg({ quality: 86, mozjpeg: true }).toBuffer();
  return img.webp({ quality: 88, effort: 5 }).toBuffer();
}

const QUERY = `
  WITH attrs AS (
    SELECT sauna_model_id,
           max(value_number) FILTER (WHERE attribute_code = 'width_mm')  AS width_mm,
           max(value_number) FILTER (WHERE attribute_code = 'depth_mm')  AS depth_mm,
           max(value_number) FILTER (WHERE attribute_code = 'height_mm') AS height_mm,
           max(value_number) FILTER (WHERE attribute_code = 'capacity_persons') AS persons
      FROM sauna_model_attributes GROUP BY sauna_model_id)
  SELECT a.storage_key, a.content_type, 'model' AS kind, sma.asset_role AS role, sma.position,
         jsonb_build_object('slug', m.slug, 'sku', m.sku, 'name', m.name, 'manufacturer', mf.name,
           'widthMm', at.width_mm, 'depthMm', at.depth_mm, 'heightMm', at.height_mm, 'persons', at.persons) AS item
    FROM sauna_model_assets sma JOIN assets a ON a.id = sma.asset_id
    JOIN sauna_models m ON m.id = sma.sauna_model_id JOIN manufacturers mf ON mf.id = m.manufacturer_id
    LEFT JOIN attrs at ON at.sauna_model_id = m.id
  UNION ALL
  SELECT a.storage_key, a.content_type, 'option', oa.asset_role, 0,
         jsonb_build_object('code', o.code, 'name', o.name, 'groupCode', g.code, 'groupName', g.name)
    FROM option_assets oa JOIN assets a ON a.id = oa.asset_id
    JOIN options o ON o.id = oa.option_id JOIN option_groups g ON g.id = o.option_group_id
  UNION ALL
  SELECT a.storage_key, a.content_type, 'room', ra.asset_role, 0,
         jsonb_build_object('code', r.code, 'name', r.name, 'preset', r.preset)
    FROM room_scene_assets ra JOIN assets a ON a.id = ra.asset_id JOIN room_scenes r ON r.id = ra.room_scene_id
  ORDER BY 1`;

function plan(row) {
  const { kind, role, position, item } = row;
  const num = (v) => (v === null || v === undefined ? null : Number(v));
  if (kind === 'model') {
    const m = { ...item, widthMm: num(item.widthMm), depthMm: num(item.depthMm), heightMm: num(item.heightMm), persons: num(item.persons) };
    if (role === 'MODEL_THUMBNAIL') return { svg: () => modelThumbSvg(m) };
    if (role === 'MODEL_GALLERY') return { svg: () => [modelInteriorSvg, modelPlanSvg, modelThumbSvg][position % 3](m) };
    if (role === 'MODEL_GLB_LOW') return { file: SAMPLE_GLB.low };
    if (role === 'MODEL_GLB_HIGH' || role === 'MODEL_AR_GLB') return { file: SAMPLE_GLB.high };
    return null;
  }
  if (kind === 'option' && role === 'OPTION_THUMBNAIL') return { svg: () => optionSvg(item) };
  if (kind === 'room' && role === 'ROOM_THUMBNAIL') return { svg: () => roomSvg(item) };
  return null;
}

export async function seedMedia({ databaseUrl = DATABASE_URL, force = FORCE } = {}) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let rows;
  try {
    rows = (await client.query(QUERY)).rows;
  } finally {
    await client.end();
  }
  let sharp = null;
  const counts = { written: 0, kept: 0, skipped: 0 };
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.storage_key)) continue;
    seen.add(row.storage_key);
    const job = plan(row);
    if (!job) {
      counts.skipped++;
      continue;
    }
    const dataPath = objectPath('data', row.storage_key);
    if (!force && (await exists(dataPath)) && (await exists(objectPath('meta', row.storage_key)))) {
      counts.kept++;
      continue;
    }
    let body;
    if (job.file) body = await readFile(job.file);
    else {
      sharp ??= await loadSharp();
      body = await render(sharp, job.svg(), row.content_type);
    }
    await putObject(row.storage_key, body, row.content_type);
    counts.written++;
  }
  say(`${counts.written} written, ${counts.kept} already present, ${counts.skipped} without a generator → ${join(OBJECTS, BUCKET)}`);
  return counts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seedMedia().catch((err) => {
    console.error(`[seed-media] ${err.message}`);
    process.exit(1);
  });
}
