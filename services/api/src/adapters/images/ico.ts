/**
 * Minimal ICO reader/writer. libvips cannot read ICO, so uploads are decoded here: PNG
 * entries are passed through, BMP (DIB) entries are converted to raw RGBA.
 */

export type IcoImage = { kind: 'png'; data: Buffer } | { kind: 'rgba'; data: Buffer; width: number; height: number };

interface DirEntry {
  width: number;
  height: number;
  bitCount: number;
  size: number;
  offset: number;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const MAX_ENTRIES = 64;

function readDirectory(buf: Buffer): DirEntry[] {
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('Not an ICO file');
  const count = buf.readUInt16LE(4);
  if (count === 0 || count > MAX_ENTRIES || buf.length < 6 + count * 16) throw new Error('Malformed ICO directory');
  const entries: DirEntry[] = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    const entry = {
      width: buf[o] || 256,
      height: buf[o + 1] || 256,
      bitCount: buf.readUInt16LE(o + 6),
      size: buf.readUInt32LE(o + 8),
      offset: buf.readUInt32LE(o + 12),
    };
    if (entry.size === 0 || entry.offset + entry.size > buf.length) throw new Error('ICO entry out of bounds');
    entries.push(entry);
  }
  return entries;
}

/** The largest (then deepest) image in the file. */
export function readLargestIcoImage(buf: Buffer): IcoImage {
  const best = readDirectory(buf).sort((a, b) => b.width * b.height - a.width * a.height || b.bitCount - a.bitCount)[0]!;
  const data = buf.subarray(best.offset, best.offset + best.size);
  if (data.length >= 4 && data.subarray(0, 4).equals(PNG_MAGIC)) return { kind: 'png', data: Buffer.from(data) };
  return { kind: 'rgba', ...decodeDib(data) };
}

/** Decodes an uncompressed (BI_RGB) DIB with 1/4/8/24/32 bits per pixel plus its AND mask. */
function decodeDib(dib: Buffer): { data: Buffer; width: number; height: number } {
  if (dib.length < 40) throw new Error('Truncated ICO bitmap');
  const headerSize = dib.readUInt32LE(0);
  const width = dib.readInt32LE(4);
  const height = Math.abs(dib.readInt32LE(8)) / 2; // XOR + AND mask
  const bpp = dib.readUInt16LE(14);
  const compression = dib.readUInt32LE(16);
  if (headerSize < 40 || compression !== 0 || width <= 0 || width > 256 || !Number.isInteger(height) || height <= 0 || height > 256) {
    throw new Error('Unsupported ICO bitmap');
  }
  if (![1, 4, 8, 24, 32].includes(bpp)) throw new Error('Unsupported ICO bit depth');

  const paletteSize = bpp <= 8 ? dib.readUInt32LE(32) || 2 ** bpp : 0;
  if (paletteSize > 2 ** bpp && bpp <= 8) throw new Error('Malformed ICO palette');
  const paletteOffset = headerSize;
  const pixelOffset = paletteOffset + paletteSize * 4;
  const stride = Math.ceil((width * bpp) / 32) * 4;
  const maskStride = Math.ceil(width / 32) * 4;
  const maskOffset = pixelOffset + stride * height;
  const hasMask = dib.length >= maskOffset + maskStride * height;
  if (dib.length < maskOffset) throw new Error('Truncated ICO bitmap');

  const out = Buffer.alloc(width * height * 4);
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = pixelOffset + (height - 1 - y) * stride; // rows are stored bottom-up
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r: number, g: number, b: number, a = 255;
      if (bpp === 32 || bpp === 24) {
        const p = row + x * (bpp / 8);
        b = dib[p]!;
        g = dib[p + 1]!;
        r = dib[p + 2]!;
        if (bpp === 32) {
          a = dib[p + 3]!;
          if (a) anyAlpha = true;
        }
      } else {
        const bitPos = x * bpp;
        const byte = dib[row + (bitPos >> 3)]!;
        const index = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        if (index >= paletteSize) throw new Error('ICO palette index out of range');
        const q = paletteOffset + index * 4;
        b = dib[q]!;
        g = dib[q + 1]!;
        r = dib[q + 2]!;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  // Without an alpha channel (or with an all-zero one) transparency comes from the AND mask.
  if (hasMask && (bpp !== 32 || !anyAlpha)) {
    for (let y = 0; y < height; y++) {
      const row = maskOffset + (height - 1 - y) * maskStride;
      for (let x = 0; x < width; x++) {
        const transparent = (dib[row + (x >> 3)]! >> (7 - (x & 7))) & 1;
        out[(y * width + x) * 4 + 3] = transparent ? 0 : 255;
      }
    }
  } else if (bpp === 32 && !anyAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
  }
  return { data: out, width, height };
}

/** Assembles a multi-size ICO from square PNGs (PNG-compressed entries, supported since Vista). */
export function buildIco(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let offset = header.length + dir.length;
  images.forEach(({ size, png }, i) => {
    if (size < 1 || size > 256) throw new Error('ICO sizes must be 1..256');
    const o = i * 16;
    dir[o] = size === 256 ? 0 : size;
    dir[o + 1] = size === 256 ? 0 : size;
    dir[o + 2] = 0; // no palette
    dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); // planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...images.map((i) => i.png)]);
}
