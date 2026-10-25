#!/usr/bin/env node
// Runs the TypeScript CLI through tsx (workspace packages ship TypeScript sources, and some use
// syntax that Node's built-in type stripping does not support).
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tsx = require.resolve('tsx/cli');
const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const r = spawnSync(process.execPath, [tsx, cli, ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(r.status ?? 2);
