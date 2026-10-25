export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'ico';

/** Identifies the format from magic bytes only; the declared content type is never trusted. */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat | null {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (b.length >= 6 && b.readUInt16LE(0) === 0 && b.readUInt16LE(2) === 1 && b.readUInt16LE(4) > 0) return 'ico';
  return null;
}

export const CONTENT_TYPES: Record<ImageFormat, readonly string[]> = {
  png: ['image/png'],
  jpeg: ['image/jpeg'],
  webp: ['image/webp'],
  ico: ['image/x-icon', 'image/vnd.microsoft.icon'],
};
