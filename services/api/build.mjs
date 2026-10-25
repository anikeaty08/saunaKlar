// Bundles one ESM file per Lambda function (design 4.2) plus the local server.
// sharp ships native binaries, so it stays external and is provided by a
// Lambda layer built for linux-arm64 (see infra/README.md).
import { build } from 'esbuild';
import { cp, rm } from 'node:fs/promises';

const functions = ['public-catalog', 'customer', 'reseller-admin', 'manufacturer-admin', 'asset-signer', 'worker', 'cognito-custom-message'];
const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  minify: true,
  external: ['sharp', 'pg-native', '@aws-sdk/signature-v4-crt', 'aws-crt'],
  // esbuild's ESM output needs require() for a few CJS dependencies.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
};

await rm(new URL('./dist', import.meta.url), { recursive: true, force: true });
await Promise.all([
  ...functions.map(fn => build({ ...common, entryPoints: [`src/functions/${fn}.ts`], outfile: `dist/lambda/${fn}/index.mjs` })),
  build({ ...common, minify: false, entryPoints: ['src/local.ts'], outfile: 'dist/local.js', external: [...common.external, 'esbuild'] }),
]);
// The worker's `{task:'migrate'}` hook resolves migrations relative to its bundle
// (packages/db MIGRATIONS_DIR = ../migrations/ from dist/lambda/worker/index.mjs). Local-only
// SQL (local IdP, dev mailbox) is never shipped.
await cp(new URL('../../packages/db/migrations/', import.meta.url), new URL('./dist/lambda/migrations/', import.meta.url), {
  recursive: true,
  filter: src => !/[\\/]migrations[\\/]local([\\/]|$)/.test(src),
});
