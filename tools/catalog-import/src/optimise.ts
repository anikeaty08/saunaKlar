/**
 * Optimise step. A pluggable hook: the default implementation shells out to `gltf-transform`
 * (from @gltf-transform/cli) when it is on PATH, and otherwise uploads the source files unchanged
 * (the CLI prints a warning). No heavy dependencies are pulled into this package.
 */
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { access, constants } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { AssetSource } from './catalog.ts';
import { checkGlb, kindForRole, sha256 } from './files.ts';

const run = promisify(execFile);

export interface PreparedAsset extends AssetSource {
  /** Path of the file to upload (optimised output or the source). */
  outPath: string;
  sha256: string;
  /** Size of the file to upload. */
  outSize: number;
  optimised: boolean;
}

export interface Optimiser {
  readonly name: string;
  /** Produces `outPath` from `asset.path` (or returns false to fall back to copying). */
  optimise(asset: AssetSource, outPath: string): Promise<boolean>;
}

export async function findOnPath(bin: string): Promise<string | null> {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, bin);
    try {
      await access(p, constants.X_OK);
      return p;
    } catch { /* keep looking */ }
  }
  return null;
}

/**
 * gltf-transform pipeline per role. `optimize` runs dedup, prune, weld and compression; the low LOD
 * is also simplified and capped at 1024 px textures; the AR GLB uses Draco + WebP because Android
 * Scene Viewer does not read meshopt or KTX2.
 */
export function gltfTransformSteps(role: string, input: string, output: string): string[][] {
  const tmp = `${output}.tmp.glb`;
  switch (role) {
    case 'MODEL_GLB_LOW':
    case 'ROOM_GLB_LOW':
      return [
        ['optimize', input, tmp, '--compress', 'meshopt', '--texture-compress', 'ktx2', '--texture-size', '1024', '--simplify', 'true', '--simplify-ratio', '0.25'],
        ['copy', tmp, output],
      ];
    case 'MODEL_AR_GLB':
      return [['optimize', input, output, '--compress', 'draco', '--texture-compress', 'webp', '--texture-size', '2048']];
    default:
      return [['optimize', input, output, '--compress', 'meshopt', '--texture-compress', 'ktx2', '--simplify', 'false']];
  }
}

export function gltfTransformOptimiser(bin: string): Optimiser {
  return {
    name: 'gltf-transform',
    async optimise(asset, outPath) {
      if (kindForRole(asset.role) !== 'glb') return false;
      for (const args of gltfTransformSteps(asset.role, asset.path, outPath)) {
        await run(bin, args, { maxBuffer: 16 * 1024 * 1024 });
      }
      await rm(`${outPath}.tmp.glb`, { force: true });
      const err = checkGlb(await readFile(outPath));
      if (err) throw new Error(`gltf-transform produced an invalid GLB for ${asset.manifestPath}: ${err}`);
      return true;
    },
  };
}

/** Picks the optimiser: gltf-transform when available on PATH, otherwise null (copy only). */
export async function detectOptimiser(): Promise<Optimiser | null> {
  const bin = await findOnPath('gltf-transform');
  return bin ? gltfTransformOptimiser(bin) : null;
}

export async function prepareAssets(
  assets: AssetSource[], workDir: string, optimiser: Optimiser | null, warn: (msg: string) => void,
): Promise<PreparedAsset[]> {
  await mkdir(workDir, { recursive: true });
  const out: PreparedAsset[] = [];
  for (const [i, a] of assets.entries()) {
    const outPath = join(workDir, `${i}-${a.role.toLowerCase()}${a.ext}`);
    let optimised = false;
    if (optimiser) {
      try {
        optimised = await optimiser.optimise(a, outPath);
      } catch (e) {
        warn(`${optimiser.name} failed for ${a.manifestPath}, uploading the source file: ${(e as Error).message.split('\n')[0]}`);
      }
    }
    // Without an optimiser the source file itself is uploaded (no copy needed).
    const finalPath = optimised ? outPath : a.path;
    const bytes = await readFile(finalPath);
    out.push({ ...a, outPath: finalPath, sha256: sha256(bytes), outSize: bytes.byteLength, optimised });
  }
  return out;
}
