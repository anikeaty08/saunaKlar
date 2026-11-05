import * as THREE from 'three';

/**
 * Procedural textures for the non-wood finishes, drawn once per page into
 * canvases: riven slate tiles, a pebble floor, an infrared grille and the soft
 * LED wash and glow sprites. The wood maps (wall boards, bench slat) are made
 * in Blender and downloaded with the kit parts (see assets.ts); no third-party
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
