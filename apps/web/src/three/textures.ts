import * as THREE from 'three';

/** Deterministic pseudo-random numbers so textures do not flicker between renders. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function shade(hex: string, amount: number): string {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + amount)));
  return `#${c.getHexString()}`;
}

const cache = new Map<string, THREE.CanvasTexture>();

function finish(canvas: HTMLCanvasElement, key: string, repeat: [number, number]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

export type FloorKind = 'oak' | 'concrete' | 'tiles' | 'stone' | 'decking';

/** Floor materials for room presets. */
export function floorTexture(kind: FloorKind): THREE.CanvasTexture {
  const key = `floor:${kind}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const r = rng(kind.length * 131);
  if (kind === 'oak' || kind === 'decking') {
    const base = kind === 'oak' ? '#b48a5a' : '#8f7356';
    const rows = kind === 'oak' ? 6 : 8;
    const h = size / rows;
    for (let i = 0; i < rows; i++) {
      const off = r() * size;
      for (let x = -off; x < size; x += size * 0.6) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.1);
        g.fillRect(x, i * h, size * 0.6, h);
        g.fillStyle = shade(base, -0.3);
        g.fillRect(x, i * h, 2, h);
      }
      g.fillStyle = shade(base, kind === 'decking' ? -0.45 : -0.3);
      g.fillRect(0, i * h, size, kind === 'decking' ? 5 : 2);
    }
  } else if (kind === 'tiles' || kind === 'stone') {
    const base = kind === 'tiles' ? '#d9d6cf' : '#9b978f';
    const n = kind === 'tiles' ? 4 : 3;
    const s = size / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        g.fillStyle = shade(base, (r() - 0.5) * 0.05);
        g.fillRect(i * s, j * s, s, s);
      }
    g.strokeStyle = shade(base, -0.18);
    g.lineWidth = 3;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, size);
      g.moveTo(0, i * s);
      g.lineTo(size, i * s);
      g.stroke();
    }
  } else {
    g.fillStyle = '#b7b4ad';
    g.fillRect(0, 0, size, size);
    for (let k = 0; k < 2500; k++) {
      g.fillStyle = shade('#b7b4ad', (r() - 0.5) * 0.12);
      g.globalAlpha = 0.4;
      g.fillRect(r() * size, r() * size, 2 + r() * 6, 2 + r() * 6);
    }
    g.globalAlpha = 1;
  }
  return finish(c, key, [1, 1]);
}
