import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { processBrandingUpload } from '../../../src/adapters/images.ts';
import { buildIco, readLargestIcoImage } from '../../../src/adapters/images/ico.ts';
import { sniffImageFormat } from '../../../src/adapters/images/sniff.ts';
import { AdapterError } from '../../../src/adapters/errors.ts';

const solid = (width: number, height: number, alpha = 1) =>
  sharp({ create: { width, height, channels: 4, background: { r: 20, g: 110, b: 80, alpha } } });

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AdapterError);
    return (e as AdapterError).code;
  }
  throw new Error('expected a rejection');
};

/** A 2×2 32-bit BMP-in-ICO (BITMAPINFOHEADER, bottom-up rows, AND mask). */
function bmpIco(): Buffer {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(2, 4);
  header.writeInt32LE(4, 8); // XOR + AND
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  // bottom row first: blue, green; top row: red, white (BGRA)
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const mask = Buffer.alloc(8);
  const dib = Buffer.concat([header, pixels, mask]);
  const dir = Buffer.alloc(22);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(1, 4);
  dir[6] = 2;
  dir[7] = 2;
  dir.writeUInt16LE(1, 10);
  dir.writeUInt16LE(32, 12);
  dir.writeUInt32LE(dib.length, 14);
  dir.writeUInt32LE(22, 18);
  return Buffer.concat([dir, dib]);
}

describe('sniffImageFormat', () => {
  it('recognises formats by magic bytes only', async () => {
    expect(sniffImageFormat(await solid(4, 4).png().toBuffer())).toBe('png');
    expect(sniffImageFormat(await solid(4, 4).jpeg().toBuffer())).toBe('jpeg');
    expect(sniffImageFormat(await solid(4, 4).webp().toBuffer())).toBe('webp');
    expect(sniffImageFormat(bmpIco())).toBe('ico');
    expect(sniffImageFormat(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImageFormat(Buffer.from('GIF89a'))).toBeNull();
  });
});

describe('processBrandingUpload LOGO', () => {
  it('re-encodes to WebP and PNG, capped at 1200 px wide', async () => {
    const input = await solid(2400, 600).png().toBuffer();
    const files = await processBrandingUpload('LOGO', input, 'image/png');
    expect(files.map((f) => [f.name, f.contentType, f.width, f.height])).toEqual([
      ['logo.webp', 'image/webp', 1200, 300],
      ['logo.png', 'image/png', 1200, 300],
    ]);
    for (const f of files) {
      expect(f.sha256).toBe(createHash('sha256').update(f.bytes).digest('hex'));
      expect((await sharp(f.bytes).metadata()).width).toBe(1200);
    }
  });

  it('never enlarges and accepts a 1×1 image', async () => {
    const files = await processBrandingUpload('LOGO', await solid(1, 1).jpeg().toBuffer(), 'image/jpeg');
    expect(files.map((f) => [f.width, f.height])).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it('strips metadata', async () => {
    const input = await solid(50, 50).withMetadata({ exif: { IFD0: { Copyright: 'secret-gps' } } }).jpeg().toBuffer();
    const [webp] = await processBrandingUpload('LOGO', input, 'image/jpeg');
    expect(webp!.bytes.includes(Buffer.from('secret-gps'))).toBe(false);
  });

  it('rejects SVG, mismatched types, disallowed types, junk and oversize', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    expect(await codeOf(processBrandingUpload('LOGO', svg, 'image/svg+xml'))).toBe('UPLOAD_INVALID');
    expect(await codeOf(processBrandingUpload('LOGO', svg, 'image/png'))).toBe('UPLOAD_INVALID');
    const png = await solid(10, 10).png().toBuffer();
    expect(await codeOf(processBrandingUpload('LOGO', png, 'image/jpeg'))).toBe('UPLOAD_INVALID');
    expect(await codeOf(processBrandingUpload('LOGO', bmpIco(), 'image/x-icon'))).toBe('UPLOAD_INVALID');
    expect(await codeOf(processBrandingUpload('LOGO', Buffer.concat([png.subarray(0, 40)]), 'image/png'))).toBe('UPLOAD_INVALID');
    expect(await codeOf(processBrandingUpload('LOGO', Buffer.alloc(0), 'image/png'))).toBe('UPLOAD_INVALID');
    expect(await codeOf(processBrandingUpload('LOGO', Buffer.alloc(2 * 1024 * 1024 + 1), 'image/png'))).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects images larger than 4096 px', async () => {
    const big = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
    expect(await codeOf(processBrandingUpload('LOGO', big, 'image/png'))).toBe('UPLOAD_INVALID');
  });
});

describe('processBrandingUpload FAVICON', () => {
  it('produces PNGs in every size plus a multi-size ICO', async () => {
    const files = await processBrandingUpload('FAVICON', await solid(300, 200, 0.5).png().toBuffer(), 'image/png');
    expect(files.map((f) => [f.name, f.width])).toEqual([
      ['favicon-16x16.png', 16],
      ['favicon-32x32.png', 32],
      ['favicon-48x48.png', 48],
      ['apple-touch-icon.png', 180],
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['favicon.ico', 48],
    ]);
    for (const f of files.filter((f) => f.contentType === 'image/png')) {
      const meta = await sharp(f.bytes).metadata();
      expect([meta.width, meta.height, meta.hasAlpha]).toEqual([f.width, f.width, true]);
    }
    const ico = files.at(-1)!;
    expect(ico.contentType).toBe('image/x-icon');
    expect(ico.bytes.readUInt16LE(2)).toBe(1);
    expect(ico.bytes.readUInt16LE(4)).toBe(3);
    expect([ico.bytes[6], ico.bytes[22], ico.bytes[38]]).toEqual([16, 32, 48]);
    // The largest entry is a valid 48×48 PNG.
    const entry = readLargestIcoImage(ico.bytes);
    expect(entry.kind).toBe('png');
    expect((await sharp(entry.kind === 'png' ? entry.data : Buffer.alloc(0)).metadata()).width).toBe(48);
  });

  it('accepts ICO uploads with BMP entries', async () => {
    const files = await processBrandingUpload('FAVICON', bmpIco(), 'image/vnd.microsoft.icon');
    expect(files).toHaveLength(7);
    const { data, info } = await sharp(files[0]!.bytes).raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(16);
    // top-left pixel is red
    expect([data[0], data[1], data[2], data[3]]).toEqual([255, 0, 0, 255]);
  });

  it('accepts ICO uploads with PNG entries and rejects JPEG favicons', async () => {
    const png = await solid(64, 64).png().toBuffer();
    const ico = buildIco([{ size: 64, png }]);
    expect(await processBrandingUpload('FAVICON', ico, 'image/x-icon')).toHaveLength(7);
    expect(await codeOf(processBrandingUpload('FAVICON', await solid(8, 8).jpeg().toBuffer(), 'image/jpeg'))).toBe('UPLOAD_INVALID');
  });

  it('rejects malformed ICO files', async () => {
    const broken = bmpIco();
    broken.writeUInt32LE(99999, 14); // entry size beyond the file
    expect(await codeOf(processBrandingUpload('FAVICON', broken, 'image/x-icon'))).toBe('UPLOAD_INVALID');
  });
});
