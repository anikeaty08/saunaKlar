import * as THREE from 'three';

/**
 * Procedural material textures, drawn once per page into canvases: tongue-and-
 * groove wall boards (knotty or clear grain), a single bench slat, riven slate
 * tiles, a pebble floor and an infrared grille. They are drawn in warm neutral
 * tones and tinted by the selected wood's swatch colour, so any catalogue wood
 * works without a texture of its own. Nothing is downloaded and no third-party
 * photo is used.
 *
 * Each texture covers a known real size (TEXTURE_SIZE, metres); kit geometry
 * carries UVs in metres, so `repeat = 1 / size` keeps every board true to scale.
 */

export const TEXTURE_SIZE = {
  boards: [2.4, 1.2] as [number, number], // 2.4 m long boards (8 x 150 mm in the Blender maps)
  slat: [1.2, 0.12] as [number, number],
  slate: [0.8, 1.14] as [number, number], // 2 × 2 tiles of 400 × 570 mm
  pebbles: [0.5, 0.5] as [number, number],
  grille: [0.24, 0.24] as [number, number],
};

/** Average brightness of the neutral wood drawings, used to tint to a swatch colour. */
export const WOOD_BASE = 0.82;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Smooth 1D value noise. */
function noise1(r: () => number, n = 64) {
  const v = Array.from({ length: n + 1 }, () => r());
  v[n] = v[0]!;
  return (x: number) => {
    const t = ((x % 1) + 1) % 1 * n;
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return v[i]! * (1 - s) + v[i + 1]! * s;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!] as const;
}

const cache = new Map<string, THREE.Texture>();

function toTexture(c: HTMLCanvasElement, key: string, size: [number, number], srgb: boolean): THREE.Texture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size[0], 1 / size[1]);
  t.anisotropy = 8;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

/** Normal map from a height canvas (white = high). */
function normalFrom(height: HTMLCanvasElement, strength: number): HTMLCanvasElement {
  const w = height.width, h = height.height;
  const src = height.getContext('2d')!.getImageData(0, 0, w, h).data;
  const [c, g] = canvas(w, h);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => src[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x - 1, y) - H(x + 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((dx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

/** Smooth 2D value noise on an integer lattice (hash-based, no tables). */
function hash2(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function noise2(x: number, y: number, s: number): number {
  const xi = Math.floor(x), yi = Math.floor(y);
  const fx = x - xi, fy = y - yi;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(x: number, y: number, s: number, oct = 4): number {
  let v = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) {
    v += noise2(x * f, y * f, s + i * 17) * amp;
    f *= 2;
    amp *= 0.5;
  }
  return v / (1 - Math.pow(0.5, oct));
}

interface Knot { x: number; y: number; r: number }

/**
 * Wood grain, drawn per pixel into a grey (luminance) image so any catalogue
 * wood colour tints it. Modelled on the owner's photos: pale boards with fine,
 * low-contrast, nearly straight grain; knotty woods (spruce, Zirbe) carry small
 * dark knots with the grain bending round them; clear woods (aspen, alder) are
 * almost plain. `pxPerM` keeps grain and knots true to size on any canvas.
 */
function paintBoard(img: ImageData, hmap: ImageData | null, x0: number, y0: number, w: number, h: number, knotty: boolean, pxPerM: number, r: () => number) {
  const W = img.width;
  const seed = Math.floor(r() * 1e6);
  const tone = 0.83 + (r() - 0.5) * 0.06; // board-to-board tone
  const contrast = knotty ? 1 : 0.45;
  const ring = (0.011 + r() * 0.007) * pxPerM; // growth ring spacing, 11–18 mm
  const phase = r() * 100;
  const knots: Knot[] = [];
  if (knotty) {
    const n = Math.round((w / pxPerM) * (0.8 + r() * 1.6));
    for (let k = 0; k < n; k++) knots.push({ x: x0 + 0.04 * pxPerM + r() * (w - 0.08 * pxPerM), y: y0 + h * (0.2 + r() * 0.6), r: (0.003 + r() * 0.006) * pxPerM });
  }
  const along = 1 / (0.35 * pxPerM); // slow waviness along the board
  for (let y = y0; y < y0 + h; y++) {
    const v = (y - y0) / h;
    for (let x = x0; x < x0 + w; x++) {
      let warp = (fbm(x * along, v * 1.5, seed, 3) - 0.5) * ring * 2.2;
      let knotDark = 0;
      for (const k of knots) {
        const dx = (x - k.x) / (k.r * 5), dy = (y - k.y) / (k.r * 3);
        const d2 = dx * dx + dy * dy;
        if (d2 < 1) warp += (y < k.y ? -1 : 1) * (1 - d2) * (1 - d2) * k.r * 2.2;
        const e = Math.hypot((x - k.x) / k.r, (y - k.y) / (k.r * 0.8));
        if (e < 1.7) knotDark = Math.max(knotDark, e < 1 ? 0.55 - e * 0.12 : (1.7 - e) / 0.7 * 0.3);
      }
      const t = ((y + warp + phase) / ring) % 1;
      // Latewood: a thin darker band once per ring.
      const late = Math.exp(-Math.pow((t - 0.5) / 0.09, 2));
      const fibre = fbm(x / (0.08 * pxPerM), y / (0.0012 * pxPerM), seed + 5, 2) - 0.5;
      const cloud = noise2(x / (0.4 * pxPerM), y / (0.2 * pxPerM), seed + 9) - 0.5;
      let l = tone * (1 - 0.075 * late * contrast + 0.035 * fibre * contrast + 0.05 * cloud);
      l *= 1 - knotDark;
      const i = (y * W + x) * 4;
      const c = Math.max(0, Math.min(255, l * 255));
      img.data[i] = c;
      img.data[i + 1] = c;
      img.data[i + 2] = c;
      img.data[i + 3] = 255;
      if (hmap) {
        const hv = 200 - late * 10 * contrast - knotDark * 30;
        hmap.data[i] = hmap.data[i + 1] = hmap.data[i + 2] = hv;
        hmap.data[i + 3] = 255;
      }
    }
  }
}

/** Horizontal tongue-and-groove wall boards (10 per texture, 2.4 m long), with a matching normal map. */
export function boardTextures(grain: 'knotty' | 'clear'): { map: THREE.Texture; normal: THREE.Texture } {
  const key = `boards:${grain}`;
  const hit = cache.get(key);
  if (hit) return { map: hit, normal: cache.get(`${key}:n`)! };
  const W = 2048, S = 1024;
  const pxPerM = W / TEXTURE_SIZE.boards[0];
  const [c, g] = canvas(W, S);
  const [hc, hg] = canvas(W, S);
  const img = g.createImageData(W, S);
  const himg = hg.createImageData(W, S);
  const r = rng(grain === 'knotty' ? 11 : 23);
  const boards = 10;
  const bh = S / boards;
  const joints: [number, number][] = [];
  for (let i = 0; i < boards; i++) {
    // Each board is two or three lengths with butt joints; one joint sits on the
    // texture edge so the repeat lands on a joint, as on a real wall.
    const cuts = [0];
    let x = W * (0.25 + r() * 0.35);
    while (x < W * 0.85) {
      cuts.push(Math.round(x));
      x += W * (0.35 + r() * 0.4);
    }
    cuts.push(W);
    for (let k = 0; k + 1 < cuts.length; k++) {
      paintBoard(img, himg, cuts[k]!, Math.round(i * bh), cuts[k + 1]! - cuts[k]!, Math.round((i + 1) * bh) - Math.round(i * bh), grain === 'knotty', pxPerM, r);
      joints.push([cuts[k]!, i]);
    }
  }
  g.putImageData(img, 0, 0);
  hg.putImageData(himg, 0, 0);
  for (let i = 0; i < boards; i++) {
    const y = Math.round(i * bh);
    // Groove between boards: a soft shadow line, a little lighter lip below.
    g.fillStyle = 'rgba(40,40,40,0.55)';
    g.fillRect(0, y, W, 2);
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, y + 2, W, 2);
    const grd = hg.createLinearGradient(0, y - 3, 0, y + 4);
    grd.addColorStop(0, 'rgb(200,200,200)');
    grd.addColorStop(0.45, 'rgb(40,40,40)');
    grd.addColorStop(1, 'rgb(200,200,200)');
    hg.fillStyle = grd;
    hg.fillRect(0, y - 3, W, 7);
  }
  g.fillStyle = 'rgba(40,40,40,0.4)';
  hg.fillStyle = 'rgb(90,90,90)';
  for (const [x, i] of joints) if (x > 0) {
    g.fillRect(x - 1, Math.round(i * bh), 1.5, bh);
    hg.fillRect(x - 1, Math.round(i * bh), 2, bh);
  }
  const map = toTexture(c, key, TEXTURE_SIZE.boards, true);
  const normal = toTexture(normalFrom(hc, 2.2), `${key}:n`, TEXTURE_SIZE.boards, false);
  return { map, normal };
}

/** One clear-grain bench slat (aspen), grain along u. */
export function slatTexture(): THREE.Texture {
  const hit = cache.get('slat');
  if (hit) return hit;
  const W = 1024, H = 128;
  const [c, g] = canvas(W, H);
  const img = g.createImageData(W, H);
  paintBoard(img, null, 0, 0, W, H, false, W / TEXTURE_SIZE.slat[0], rng(5));
  g.putImageData(img, 0, 0);
  return toTexture(c, 'slat', TEXTURE_SIZE.slat, true);
}

/** Riven slate, 2 × 2 tiles of 400 × 570 mm with dark joints. */
export function slateTextures(): { map: THREE.Texture; normal: THREE.Texture } {
  const hit = cache.get('slate');
  if (hit) return { map: hit, normal: cache.get('slate:n')! };
  const W = 512, H = 730;
  const [c, g] = canvas(W, H);
  const [hc, hg] = canvas(W, H);
  const r = rng(77);
  const img = g.createImageData(W, H);
  const himg = hg.createImageData(W, H);
  const nx = noise1(r, 32), ny = noise1(r, 32), nz = noise1(r, 48);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const layer = nz(y / H * 1.7 + nx(x / W) * 0.25) * 0.6 + ny((x + y * 0.3) / W) * 0.25 + r() * 0.15;
      const v = 40 + layer * 34;
      const i = (y * W + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v + 2;
      img.data[i + 2] = v + 6;
      img.data[i + 3] = 255;
      const hv = 90 + layer * 120;
      himg.data[i] = himg.data[i + 1] = himg.data[i + 2] = hv;
      himg.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  hg.putImageData(himg, 0, 0);
  for (const ctx of [g, hg]) {
    ctx.fillStyle = ctx === g ? '#141618' : '#000';
    ctx.fillRect(0, 0, W, 3);
    ctx.fillRect(0, H / 2 - 1.5, W, 3);
    ctx.fillRect(0, 0, 3, H);
    ctx.fillRect(W / 2 - 1.5, 0, 3, H);
  }
  return { map: toTexture(c, 'slate', TEXTURE_SIZE.slate, true), normal: toTexture(normalFrom(hc, 4), 'slate:n', TEXTURE_SIZE.slate, false) };
}

/** River pebbles set in pale grout. */
export function pebbleTexture(): THREE.Texture {
  const hit = cache.get('pebbles');
  if (hit) return hit;
  const S = 512;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#b9b3a8';
  g.fillRect(0, 0, S, S);
  const r = rng(31);
  for (let i = 0; i < 520; i++) {
    const x = r() * S, y = r() * S, rx = 7 + r() * 14, ry = rx * (0.55 + r() * 0.35), a = r() * Math.PI;
    const v = 70 + r() * 110;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      const grd = g.createRadialGradient(x + ox! - rx * 0.3, y + oy! - ry * 0.3, 1, x + ox!, y + oy!, rx);
      grd.addColorStop(0, `rgb(${v + 40},${v + 36},${v + 30})`);
      grd.addColorStop(1, `rgb(${v - 20},${v - 22},${v - 24})`);
      g.fillStyle = grd;
      g.beginPath();
      g.ellipse(x + ox!, y + oy!, rx, ry, a, 0, Math.PI * 2);
      g.fill();
    }
  }
  return toTexture(c, 'pebbles', TEXTURE_SIZE.pebbles, true);
}

/** Front of an infrared emitter: close vertical red-brown ceramic bars with a darker gap between, as in the photos. */
export function grilleTexture(): THREE.Texture {
  const hit = cache.get('grille');
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#2a0f0b';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 8; i++) {
    const x = i * 32 + 5;
    const grd = g.createLinearGradient(x, 0, x + 22, 0);
    grd.addColorStop(0, '#5e1e14');
    grd.addColorStop(0.5, '#9b3a24');
    grd.addColorStop(1, '#5e1e14');
    g.fillStyle = grd;
    g.fillRect(x, 0, 22, S);
  }
  g.fillStyle = 'rgba(20,6,4,0.55)';
  for (let y = 0; y < S; y += 64) g.fillRect(0, y, S, 3);
  return toTexture(c, 'grille', TEXTURE_SIZE.grille, true);
}

/** Soft vertical glow for LED wall washes (alpha only, white). */
export function washTexture(): THREE.Texture {
  const hit = cache.get('wash');
  if (hit) return hit;
  const [c, g] = canvas(8, 128);
  const grd = g.createLinearGradient(0, 128, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 8, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('wash', t);
  return t;
}

/** Round soft spot for floor glows. */
export function glowTexture(): THREE.Texture {
  const hit = cache.get('glow');
  if (hit) return hit;
  const [c, g] = canvas(128, 128);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set('glow', t);
  return t;
}
