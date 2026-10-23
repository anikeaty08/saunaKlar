import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

/** Content types of files Vite emits (and a few common extras). */
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

export const contentTypeOf = (path: string): string => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';

export interface StaticFile {
  body: Buffer;
  contentType: string;
  /** Vite's content-hashed files may be cached forever; HTML must revalidate. */
  cacheControl: string;
}

/** Reads `urlPath` below `root`; null when it is missing, a directory or escapes the root. */
export async function readStatic(root: string, urlPath: string): Promise<StaticFile | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const full = resolve(root, `.${decoded}`);
  if (full !== root && !full.startsWith(root + sep)) return null;
  try {
    if (!(await stat(full)).isFile()) return null;
    const body = await readFile(full);
    const hashed = /[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|svg|png|webp|avif|jpg)$/.test(full);
    return {
      body,
      contentType: contentTypeOf(full),
      cacheControl: full.endsWith('.html') ? 'no-cache' : hashed ? 'public, max-age=31536000, immutable' : 'public, max-age=300',
    };
  } catch {
    return null;
  }
}

export async function dirExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
