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
  boards: [2.4, 1.2] as [number, number], // 10 boards of 120 mm, 2.4 m long
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

interface Grain {
  knotty: boolean;
  seed: number;
}

/**
 * Draws wood grain into a rectangle (grain along x). Lines follow a slow wave,
 * bunch into growth rings and bend around knots; knots get a dark core and rings.
 */
function drawGrain(g: CanvasRenderingContext2D, hg: CanvasRenderingContext2D | null, x0: number, y0: number, w: number, h: number, o: Grain, r: () => number) {
  const tone = 220 + r() * 14;
  g.fillStyle = `rgb(${tone + 8},${tone - 4},${tone - 22})`;
  g.fillRect(x0, y0, w, h);
  const knots: { x: number; y: number; rx: number; ry: number }[] = [];
  if (o.knotty) {
    const count = Math.floor(r() * 3) + (r() < 0.6 ? 1 : 0);
    for (let k = 0; k < count; k++) knots.push({ x: x0 + r() * w, y: y0 + h * (0.2 + r() * 0.6), rx: 4 + r() * 9, ry: 3 + r() * 6 });
  }
  const wave = noise1(r);
  const lines = Math.floor(h / 2.2);
  for (let i = 0; i < lines; i++) {
    const base = y0 + (i + r() * 0.6) * (h / lines);
    const ring = Math.sin(i * 0.55 + r() * 0.4);
    const dark = ring > 0.55 ? 0.18 + r() * 0.12 : 0.05 + r() * 0.07;
    g.strokeStyle = `rgba(120,78,40,${dark})`;
    g.lineWidth = ring > 0.55 ? 1.4 + r() * 1.6 : 0.6 + r() * 0.8;
    g.beginPath();
    for (let x = x0; x <= x0 + w; x += 6) {
      let y = base + (wave((x - x0) / w * 0.6 + i * 0.013) - 0.5) * h * 0.18;
      for (const k of knots) {
        const dx = (x - k.x) / (k.rx * 5), dy = (y - k.y) / (k.ry * 4);
        const d = dx * dx + dy * dy;
        if (d < 1) y += Math.sign(y - k.y || 1) * (1 - d) * k.ry * 2.2;
      }
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  for (const k of knots) {
    const grd = g.createRadialGradient(k.x, k.y, 0, k.x, k.y, k.rx * 1.6);
    grd.addColorStop(0, 'rgba(70,38,18,0.95)');
    grd.addColorStop(0.45, 'rgba(105,62,30,0.85)');
    grd.addColorStop(0.75, 'rgba(150,100,55,0.35)');
    grd.addColorStop(1, 'rgba(150,100,55,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.ellipse(k.x, k.y, k.rx * 1.6, k.ry * 1.6, 0, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(60,32,14,0.7)';
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(k.x, k.y, k.rx, k.ry, 0, 0, Math.PI * 2);
    g.stroke();
    if (hg) {
      hg.fillStyle = 'rgba(90,90,90,0.6)';
      hg.beginPath();
      hg.ellipse(k.x, k.y, k.rx, k.ry, 0, 0, Math.PI * 2);
      hg.fill();
    }
  }
}

/** Horizontal tongue-and-groove wall boards (5 per texture), with a matching normal map. */
export function boardTextures(grain: 'knotty' | 'clear'): { map: THREE.Texture; normal: THREE.Texture } {
  const key = `boards:${grain}`;
  const hit = cache.get(key);
  if (hit) return { map: hit, normal: cache.get(`${key}:n`)! };
  const W = 2048;
  const S = 1024;
  const [c, g] = canvas(W, S);
  const [hc, hg] = canvas(W, S);
  hg.fillStyle = '#c8c8c8';
  hg.fillRect(0, 0, W, S);
  const r = rng(grain === 'knotty' ? 11 : 23);
  const boards = 10;
  const bh = S / boards;
  for (let i = 0; i < boards; i++) {
    // Each board is two or three lengths with butt joints at random places, as on a real wall.
    const cuts = [0];
    let x = W * (0.2 + r() * 0.35);
    while (x < W * 0.9) {
      cuts.push(x);
      x += W * (0.3 + r() * 0.4);
    }
    cuts.push(W);
    for (let k = 0; k + 1 < cuts.length; k++) {
      drawGrain(g, hg, cuts[k]!, i * bh, cuts[k + 1]! - cuts[k]!, bh, { knotty: grain === 'knotty', seed: i * 3 + k }, r);
      if (k > 0) {
        g.fillStyle = 'rgba(60,40,22,0.35)';
        g.fillRect(cuts[k]! - 1, i * bh, 2, bh);
      }
    }
    // V-groove: shadow on top, highlight below.
    const y = i * bh;
    g.fillStyle = 'rgba(55,35,18,0.7)';
    g.fillRect(0, y, W, 2);
    g.fillStyle = 'rgba(255,245,225,0.22)';
    g.fillRect(0, y + 2, W, 2);
    const grd = hg.createLinearGradient(0, y - 3, 0, y + 4);
    grd.addColorStop(0, '#c8c8c8');
    grd.addColorStop(0.45, '#202020');
    grd.addColorStop(1, '#c8c8c8');
    hg.fillStyle = grd;
    hg.fillRect(0, y - 3, W, 7);
  }
  const map = toTexture(c, key, TEXTURE_SIZE.boards, true);
  const normal = toTexture(normalFrom(hc, 3), `${key}:n`, TEXTURE_SIZE.boards, false);
  return { map, normal };
}

/** One clear-grain bench slat, grain along u. */
export function slatTexture(): THREE.Texture {
  const hit = cache.get('slat');
  if (hit) return hit;
  const [c, g] = canvas(1024, 128);
  drawGrain(g, null, 0, 0, 1024, 128, { knotty: false, seed: 3 }, rng(5));
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

/** Lattice grille of an infrared emitter: dark red bars over glowing ceramic. */
export function grilleTexture(): THREE.Texture {
  const hit = cache.get('grille');
  if (hit) return hit;
  const S = 256;
  const [c, g] = canvas(S, S);
  g.fillStyle = '#d9c3a6';
  g.fillRect(0, 0, S, S);
  g.fillStyle = '#5b1f17';
  for (let i = 0; i < 4; i++) {
    g.fillRect(i * 64, 0, 14, S);
    g.fillRect(0, i * 64, S, 12);
    g.fillRect(i * 64 + 32, i % 2 ? 0 : 32, 10, 32);
  }
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
