/**
 * catalog-import <dir> [--dry-run] [--validate-only] [--database-url URL] [--target local|s3://bucket]
 *                      [--media-bucket BUCKET] [--var-dir DIR] [--manufacturer NAME|UUID] [--allow-oversize]
 *
 * Exit codes: 0 success (or nothing to do), 1 invalid catalog / failed import, 2 usage or
 * infrastructure error (bad arguments, database unreachable, upload failure).
 */
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createPool, dbAccess, DEFAULT_DATABASE_URL } from './db.ts';
import { objectStoreFromTarget } from './object-store.ts';
import { consoleOutput } from './output.ts';
import { runImport } from './pipeline.ts';

export const USAGE = `Usage: catalog-import <dir> [options]

Validates the catalog in <dir> (attributes.yaml, saunas/*.yaml, rooms/*.yaml), optimises and
uploads its files, and imports it in one transaction per sauna as role catalog_admin.

Options:
  --dry-run               validate and print the plan; upload and write nothing
  --validate-only         validate the manifests and files only (no database)
  --database-url <url>    database (default $DATABASE_URL or ${DEFAULT_DATABASE_URL})
  --target <t>            local (default) or s3://<assets-bucket>; local writes <objects>/<bucket>/{data,meta}/
                          like the local API server ($LOCAL_OBJECTS_DIR or <repo root>/var/objects,
                          bucket $S3_ASSETS_BUCKET or assets)
  --media-bucket <name>   public bucket for media/* keys with an s3 target (default $MEDIA_BUCKET)
  --var-dir <dir>         local var directory: objects go to <dir>/objects (overrides $LOCAL_OBJECTS_DIR)
  --manufacturer <name>   owning manufacturer when the database has several (name or uuid)
  --allow-oversize        downgrade model size budget errors (design A3) to warnings
  -h, --help              show this help
`;

export async function main(argv: string[]): Promise<number> {
  const { out, style } = consoleOutput();
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'dry-run': { type: 'boolean', default: false },
        'validate-only': { type: 'boolean', default: false },
        'database-url': { type: 'string' },
        target: { type: 'string', default: 'local' },
        'media-bucket': { type: 'string' },
        'var-dir': { type: 'string' },
        manufacturer: { type: 'string' },
        'allow-oversize': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (e) {
    out.error(style.red((e as Error).message));
    out.error(USAGE);
    return 2;
  }
  const v = args.values;
  if (v.help) { out.line(USAGE); return 0; }
  if (args.positionals.length !== 1) { out.error(USAGE); return 2; }
  const dir = resolve(args.positionals[0]!);
  if (!existsSync(dir)) { out.error(style.red(`catalog directory not found: ${dir}`)); return 2; }

  if (v['validate-only']) {
    const r = await runImport({ dir, validateOnly: true, allowOversize: v['allow-oversize'], out, style });
    return r.exitCode;
  }

  let store;
  try {
    store = objectStoreFromTarget(v.target, { varDir: v['var-dir'], mediaBucket: v['media-bucket'] });
  } catch (e) {
    out.error(style.red((e as Error).message));
    return 2;
  }

  const pool = createPool(v['database-url'] ?? process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    out.error(style.red(`cannot connect to the database: ${(e as Error).message}`));
    await pool.end();
    return 2;
  }
  try {
    const r = await runImport({
      dir, dryRun: v['dry-run'], allowOversize: v['allow-oversize'], manufacturer: v.manufacturer,
      db: dbAccess(pool), store, out, style,
    });
    return r.exitCode;
  } catch (e) {
    out.error(style.red(`import aborted: ${(e as Error).message}`));
    return 2;
  } finally {
    await pool.end();
  }
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}
