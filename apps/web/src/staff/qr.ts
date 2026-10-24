/**
 * Minimal QR Code encoder (ISO/IEC 18004) for the TOTP setup screen: byte
 * mode, error correction level M, versions 1–40, automatic version choice and
 * mask selection by the standard's penalty rules. Follows the structure of
 * Project Nayuki's reference implementation (MIT). No dependencies; returns a
 * square boolean matrix (true = dark) that the staff sign-in renders as one SVG path.
 */

// Level M rows of the standard's tables, indexed by version (index 0 unused).
const ECC_PER_BLOCK = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Format-information bits for level M. */
const ECL_BITS = 0;

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

function rawDataModules(ver: number): number {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const n = Math.floor(ver / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (ver >= 7) r -= 36;
  }
  return r;
}

const dataCodewords = (ver: number) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver]! * NUM_BLOCKS[ver]!;

function alignmentPositions(ver: number, size: number): number[] {
  if (ver === 1) return [];
  const n = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < n; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---- Reed–Solomon over GF(2^8), polynomial 0x11D ----------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const r = new Array<number>(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = gfMul(r[j]!, root);
      if (j + 1 < r.length) r[j]! ^= r[j + 1]!;
    }
    root = gfMul(root, 0x02);
  }
  return r;
}

function rsRemainder(data: number[], divisor: number[]): number[] {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift()!;
    r.push(0);
    divisor.forEach((c, i) => (r[i]! ^= gfMul(c, factor)));
  }
  return r;
}

// ---- encoding -----------------------------------------------------------------------

function encodeData(bytes: Uint8Array, ver: number): number[] {
  const bits: number[] = [];
  const push = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, ver <= 9 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver) * 8;
  push(0, Math.min(4, capacity - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  return out;
}

function addEcc(data: number[], ver: number): number[] {
  const numBlocks = NUM_BLOCKS[ver]!;
  const eccLen = ECC_PER_BLOCK[ver]!;
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const divisor = rsDivisor(eccLen);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0]!.length; i++) {
    blocks.forEach((b, j) => {
      if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]!);
    });
  }
  return out;
}

const MASKS: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_, y) => y % 2 === 0,
  x => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  readonly m: boolean[][];
  readonly fn: boolean[][];
  constructor(readonly size: number) {
    this.m = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.fn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }
  setFn(x: number, y: number, dark: boolean) {
    this.m[y]![x] = dark;
    this.fn[y]![x] = true;
  }
}

function drawFormat(q: Matrix, mask: number) {
  const data = (ECL_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const s = q.size;
  for (let i = 0; i <= 5; i++) q.setFn(8, i, bit(bits, i));
  q.setFn(8, 7, bit(bits, 6));
  q.setFn(8, 8, bit(bits, 7));
  q.setFn(7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) q.setFn(14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) q.setFn(s - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) q.setFn(8, s - 15 + i, bit(bits, i));
  q.setFn(8, s - 8, true);
}

function drawFunctionPatterns(q: Matrix, ver: number) {
  const s = q.size;
  for (let i = 0; i < s; i++) {
    q.setFn(6, i, i % 2 === 0);
    q.setFn(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [s - 4, 3], [3, s - 4]] as const) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < s && y >= 0 && y < s) q.setFn(x, y, d !== 2 && d !== 4);
      }
    }
  }
  const pos = alignmentPositions(ver, s);
  const last = pos.length - 1;
  pos.forEach((px, i) =>
    pos.forEach((py, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) q.setFn(px + dx, py + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(q, 0);
  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const a = s - 11 + (i % 3);
      const b = Math.floor(i / 3);
      q.setFn(a, b, bit(bits, i));
      q.setFn(b, a, bit(bits, i));
    }
  }
}

function drawCodewords(q: Matrix, data: number[]) {
  const s = q.size;
  let i = 0;
  for (let right = s - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < s; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? s - 1 - vert : vert;
        if (!q.fn[y]![x] && i < data.length * 8) {
          q.m[y]![x] = bit(data[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function applyMask(q: Matrix, mask: number) {
  const f = MASKS[mask]!;
  for (let y = 0; y < q.size; y++) for (let x = 0; x < q.size; x++) if (!q.fn[y]![x] && f(x, y)) q.m[y]![x] = !q.m[y]![x];
}

/** Penalty rules 1 (runs), 2 (2×2 blocks), 3 (finder-like patterns) and 4 (balance). */
function penalty(m: boolean[][]): number {
  const s = m.length;
  let p = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= s; i++) {
      if (i < s && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) p += run - 2;
        run = 1;
      }
    }
    const seq = Array.from({ length: s }, (_, i) => get(i));
    const pat = [true, false, true, true, true, false, true];
    for (let i = 0; i + 7 <= s; i++) {
      if (!pat.every((v, k) => seq[i + k] === v)) continue;
      const before = i - 4 >= 0 && seq.slice(i - 4, i).every(v => !v);
      const after = i + 11 <= s && seq.slice(i + 7, i + 11).every(v => !v);
      if (before || after) p += 40;
    }
  };
  for (let y = 0; y < s; y++) line(x => m[y]![x]!);
  for (let x = 0; x < s; x++) line(y => m[y]![x]!);
  for (let y = 0; y + 1 < s; y++) {
    for (let x = 0; x + 1 < s; x++) {
      const c = m[y]![x];
      if (c === m[y]![x + 1] && c === m[y + 1]![x] && c === m[y + 1]![x + 1]) p += 3;
    }
  }
  const dark = m.reduce((a, row) => a + row.filter(Boolean).length, 0);
  const total = s * s;
  p += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
  return p;
}

/** `mask` forces one of the eight masks (tests); by default the lowest-penalty one is used. */
export function qrMatrix(text: string, mask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  let ver = 1;
  while (ver <= 40 && 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8 > dataCodewords(ver) * 8) ver++;
  if (ver > 40) throw new Error('Text too long for a QR code.');
  const codewords = addEcc(encodeData(bytes, ver), ver);
  const base = new Matrix(ver * 4 + 17);
  drawFunctionPatterns(base, ver);
  drawCodewords(base, codewords);

  let best: boolean[][] | null = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m++) {
    if (mask !== undefined && m !== mask) continue;
    const q = new Matrix(base.size);
    for (let y = 0; y < q.size; y++) {
      q.m[y] = [...base.m[y]!];
      q.fn[y] = [...base.fn[y]!];
    }
    applyMask(q, m);
    drawFormat(q, m);
    const score = penalty(q.m);
    if (score < bestScore) {
      bestScore = score;
      best = q.m;
    }
  }
  return best!;
}
