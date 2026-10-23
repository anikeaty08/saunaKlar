import { createHash } from 'node:crypto';
import { extname } from 'node:path';

export const MB = 1024 * 1024;

/** Manifest asset key → DB asset role code. The sauna_model_assets PK is (model, role), so gallery images get numbered roles. */
export const SAUNA_ASSET_ROLES = {
  model_high: 'MODEL_HIGH',
  model_low: 'MODEL_LOW',
  ar_glb: 'AR_GLB',
  ar_usdz: 'AR_USDZ',
  thumbnail: 'THUMBNAIL',
} as const;
export const galleryRole = (i: number): string => `GALLERY_${i + 1}`;
export const ROOM_ASSET_ROLES = { scene: 'ROOM_SCENE', thumbnail: 'ROOM_THUMBNAIL' } as const;

/** Size budgets from design assumption A3 (bytes). Images get a soft budget. */
export const BUDGETS: Record<string, number> = {
  MODEL_HIGH: 12 * MB,
  MODEL_LOW: 1.5 * MB,
  AR_GLB: 5 * MB,
  AR_USDZ: 5 * MB,
  ROOM_SCENE: 12 * MB,
};
export const IMAGE_BUDGET = 2 * MB;

export type FileKind = 'glb' | 'usdz' | 'image';

export const CONTENT_TYPES: Record<string, string> = {
  '.glb': 'model/gltf-binary',
  '.usdz': 'model/vnd.usdz+zip',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

export function kindForRole(role: string): FileKind {
  if (role === 'AR_USDZ') return 'usdz';
  if (role.startsWith('MODEL_') || role === 'AR_GLB' || role === 'ROOM_SCENE') return 'glb';
  return 'image';
}

export function allowedExtensions(kind: FileKind): string[] {
  return kind === 'glb' ? ['.glb'] : kind === 'usdz' ? ['.usdz'] : ['.png', '.jpg', '.jpeg', '.webp', '.avif'];
}

export function extOf(path: string): string {
  return extname(path).toLowerCase();
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Checks a binary glTF 2.0 container: 'glTF' magic, version 2, declared length equal to the file
 * size, a first JSON chunk that parses and declares asset.version "2.x". Returns an error message or null.
 */
export function checkGlb(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 20) return 'file is too small to be a GLB';
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) return "missing 'glTF' magic bytes (not a binary glTF file)";
  const version = view.getUint32(4, true);
  if (version !== 2) return `glTF container version ${version}, expected 2`;
  const length = view.getUint32(8, true);
  if (length !== bytes.byteLength) return `GLB header declares ${length} bytes but the file has ${bytes.byteLength}`;
  const chunkLength = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  if (chunkType !== 0x4e4f534a) return 'first GLB chunk is not JSON';
  if (20 + chunkLength > bytes.byteLength) return 'JSON chunk runs past the end of the file';
  try {
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + chunkLength))) as { asset?: { version?: unknown } };
    const v = json.asset?.version;
    if (typeof v !== 'string' || !v.startsWith('2.')) return `asset.version is ${JSON.stringify(v)}, expected "2.0"`;
  } catch {
    return 'JSON chunk is not valid JSON';
  }
  return null;
}

export function checkMagic(kind: FileKind, ext: string, bytes: Uint8Array): string | null {
  if (kind === 'glb') return checkGlb(bytes);
  const b = (i: number) => bytes[i] ?? -1;
  if (kind === 'usdz') return b(0) === 0x50 && b(1) === 0x4b && b(2) === 3 && b(3) === 4 ? null : 'not a USDZ (zip) file';
  switch (ext) {
    case '.png': return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 ? null : 'not a PNG file';
    case '.jpg': case '.jpeg': return b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff ? null : 'not a JPEG file';
    case '.webp': return new TextDecoder().decode(bytes.subarray(8, 12)) === 'WEBP' ? null : 'not a WebP file';
    case '.avif': return new TextDecoder().decode(bytes.subarray(4, 12)).startsWith('ftypavi') ? null : 'not an AVIF file';
    default: return `unsupported file type ${ext}`;
  }
}

/** Storage key: `catalog/{slug}/{role-lowercase}-{sha256 first 12}.{ext}`. Content-addressed, so immutable caching is safe. */
export function storageKey(owner: string, role: string, hash: string, ext: string): string {
  return `catalog/${owner}/${role.toLowerCase().replace(/_/g, '-')}-${hash.slice(0, 12)}${ext}`;
}

export function formatBytes(n: number): string {
  return n >= MB ? `${(n / MB).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
}
