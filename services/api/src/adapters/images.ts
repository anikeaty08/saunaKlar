import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { UPLOAD_LIMITS } from '@saunaklar/shared';
import { AdapterError } from './errors.ts';
import { buildIco, readLargestIcoImage } from './images/ico.ts';
import { CONTENT_TYPES, sniffImageFormat } from './images/sniff.ts';

export type BrandingUploadKind = keyof typeof UPLOAD_LIMITS;

export interface ProcessedFile {
  name: string;
  contentType: string;
  bytes: Buffer;
  width: number;
  height: number;
  sha256: string;
}

export const MAX_IMAGE_DIMENSION = 4096;
const LOGO_MAX_WIDTH = 1200;
export const FAVICON_PNG_SIZES = [16, 32, 48, 180, 192, 512] as const;
const ICO_SIZES = [16, 32, 48] as const;

const FAVICON_NAMES: Record<(typeof FAVICON_PNG_SIZES)[number], string> = {
  16: 'favicon-16x16.png',
  32: 'favicon-32x32.png',
  48: 'favicon-48x48.png',
  180: 'apple-touch-icon.png',
  192: 'icon-192.png',
  512: 'icon-512.png',
};

const invalid = (message: string, cause?: unknown) => new AdapterError('UPLOAD_INVALID', message, { cause });

const file = (name: string, contentType: string, bytes: Buffer, width: number, height: number): ProcessedFile => ({
  name,
  contentType,
  bytes,
  width,
  height,
  sha256: createHash('sha256').update(bytes).digest('hex'),
});

/** Sharp input options shared by every decode: bounded pixels, first frame only, strict. */
const sharpOptions = { limitInputPixels: MAX_IMAGE_DIMENSION * MAX_IMAGE_DIMENSION, failOn: 'error' } as const;

/**
 * Validates and re-encodes a reseller branding upload. Untrusted bytes never reach the CDN
 * as uploaded: the format is sniffed from magic bytes (SVG and everything else rejected), it
 * must match the declared type, and every output is freshly encoded without metadata.
 */
export async function processBrandingUpload(
  kind: BrandingUploadKind,
  bytes: Uint8Array,
  declaredContentType: string,
): Promise<ProcessedFile[]> {
  const limits = UPLOAD_LIMITS[kind];
  if (bytes.byteLength === 0) throw invalid('The file is empty.');
  if (bytes.byteLength > limits.maxBytes) throw new AdapterError('PAYLOAD_TOO_LARGE', `The file exceeds ${limits.maxBytes} bytes.`);

  const declared = declaredContentType.split(';')[0]!.trim().toLowerCase();
  if (!(limits.contentTypes as readonly string[]).includes(declared)) throw invalid(`Content type ${declared} is not allowed for ${kind}.`);
  const format = sniffImageFormat(bytes);
  if (!format) throw invalid('The file is not a PNG, JPEG, WebP or ICO image.');
  if (!CONTENT_TYPES[format].includes(declared)) throw invalid('The file content does not match its content type.');

  const source = await decode(Buffer.from(bytes), format);
  return kind === 'LOGO' ? processLogo(source) : processFavicon(source);
}

/** Decodes to a normalised sharp pipeline (EXIF orientation applied) and checks dimensions. */
async function decode(buf: Buffer, format: ReturnType<typeof sniffImageFormat>): Promise<sharp.Sharp> {
  try {
    let image: sharp.Sharp;
    if (format === 'ico') {
      const entry = readLargestIcoImage(buf);
      image =
        entry.kind === 'png'
          ? sharp(entry.data, sharpOptions)
          : sharp(entry.data, { ...sharpOptions, raw: { width: entry.width, height: entry.height, channels: 4 } });
    } else {
      image = sharp(buf, sharpOptions);
    }
    const meta = await image.metadata();
    if (format === 'ico' ? false : meta.format !== (format === 'jpeg' ? 'jpeg' : format)) throw invalid('The image could not be decoded.');
    const { width, height } = meta;
    if (!width || !height) throw invalid('The image has no dimensions.');
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      throw invalid(`The image must be at most ${MAX_IMAGE_DIMENSION}×${MAX_IMAGE_DIMENSION} pixels.`);
    }
    // Materialise once: validates the whole stream and lets each output clone a decoded image.
    const { data, info } = await image.rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
  } catch (e) {
    if (e instanceof AdapterError) throw e;
    throw invalid('The image could not be decoded.', e);
  }
}

async function processLogo(source: sharp.Sharp): Promise<ProcessedFile[]> {
  const resized = source.clone().resize({ width: LOGO_MAX_WIDTH, withoutEnlargement: true });
  const webp = await resized.clone().webp({ quality: 90, alphaQuality: 100, effort: 5 }).toBuffer({ resolveWithObject: true });
  const png = await resized.clone().png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer({ resolveWithObject: true });
  return [
    file('logo.webp', 'image/webp', webp.data, webp.info.width, webp.info.height),
    file('logo.png', 'image/png', png.data, png.info.width, png.info.height),
  ];
}

async function processFavicon(source: sharp.Sharp): Promise<ProcessedFile[]> {
  const pngs = new Map<number, Buffer>();
  for (const size of FAVICON_PNG_SIZES) {
    const out = await source
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: size <= 48 ? 'lanczos3' : 'mitchell' })
      .png({ compressionLevel: 9 })
      .toBuffer();
    pngs.set(size, out);
  }
  const files = FAVICON_PNG_SIZES.map((size) => file(FAVICON_NAMES[size], 'image/png', pngs.get(size)!, size, size));
  const ico = buildIco(ICO_SIZES.map((size) => ({ size, png: pngs.get(size)! })));
  files.push(file('favicon.ico', 'image/x-icon', ico, 48, 48));
  return files;
}
