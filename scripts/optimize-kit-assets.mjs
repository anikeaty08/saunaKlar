/**
 * Repeatable asset optimisation (`npm run assets:optimize`). Idempotent; sources stay recoverable via git.
 *
 * 1. apps/web/src/three/kit/assets/kit-parts.glb -> meshopt-compressed in place (EXT_meshopt_compression,
 *    decoded by three-stdlib's MeshoptDecoder, which drei's useGLTF installs by default: no external decoder).
 * 2. wall-*-n.png normal maps -> 1024px lossy-high WebP (still linear data; assets.ts keeps NoColorSpace).
 * 3. apps/web/public/catalogue/<name>.jpg (1200x800 originals, kept) -> responsive variants:
 *      <name>-480|800|1200.{avif,webp,jpg}
 *    which is exactly what LazyImage expects: `${src}-${w}.avif|webp|jpg` with src = "/catalogue/<name>".
 */
import { readdirSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { EXTMeshoptCompression, KHRMeshQuantization } from '@gltf-transform/extensions';
import { dedup, prune, quantize, meshopt } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const kit = join(root, 'apps/web/src/three/kit/assets');
const cat = join(root, 'apps/web/public/catalogue');
const kb = f => (statSync(f).size / 1024).toFixed(0) + ' KB';

// 1. GLB
await MeshoptDecoder.ready; await MeshoptEncoder.ready;
const glb = join(kit, 'kit-parts.glb');
const before = kb(glb);
const io = new NodeIO().registerExtensions([EXTMeshoptCompression, KHRMeshQuantization]).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(glb);
await doc.transform(dedup(), prune(), quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12 }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
await io.write(glb, doc);
console.log(`kit-parts.glb ${before} -> ${kb(glb)}`);

// 2. normal maps
for (const n of ['wall-knotty-n', 'wall-clear-n']) {
  const png = join(kit, `${n}.png`), out = join(kit, `${n}.webp`);
  if (!existsSync(png)) continue;
  const b = kb(png);
  await sharp(png).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 88, effort: 6 }).toFile(out);
  unlinkSync(png); // recoverable with `git checkout`
  console.log(`${n}.png ${b} -> ${n}.webp ${kb(out)}`);
}

// 3. catalogue
const widths = [480, 800, 1200];
for (const f of readdirSync(cat).filter(f => /^[a-z0-9-]+\.jpg$/.test(f) && !/-\d+\.jpg$/.test(f))) {
  const name = f.replace(/\.jpg$/, '');
  for (const w of widths) {
    const img = () => sharp(join(cat, f)).resize({ width: w, withoutEnlargement: true });
    await img().avif({ quality: 50, effort: 4 }).toFile(join(cat, `${name}-${w}.avif`));
    await img().webp({ quality: 75 }).toFile(join(cat, `${name}-${w}.webp`));
    await img().jpeg({ quality: 78, mozjpeg: true }).toFile(join(cat, `${name}-${w}.jpg`));
  }
}
console.log('catalogue variants written');
