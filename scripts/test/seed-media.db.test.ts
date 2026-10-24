/**
 * scripts/seed-media.mjs against a freshly seeded database (vitest project `db`).
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { createTestDatabase } from '@saunaklar/db';
import { LocalObjectFiles } from '@saunaklar/objects';
import { seedMedia } from '../seed-media.mjs';

const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const SAMPLE = join(REPO, 'tools/catalog-import/examples/models');

type TestDb = Awaited<ReturnType<typeof createTestDatabase>>;
let tdb: TestDb;
let objects: string;
let rows: { storage_key: string; content_type: string }[];

beforeAll(async () => {
  tdb = await createTestDatabase({ seed: true });
  objects = await mkdtemp(join(tmpdir(), 'seed-media-'));
  const client = new pg.Client({ connectionString: tdb.url });
  await client.connect();
  try {
    rows = (await client.query(`SELECT DISTINCT a.storage_key, a.content_type FROM assets a WHERE a.id IN (
      SELECT asset_id FROM sauna_model_assets UNION SELECT asset_id FROM option_assets UNION SELECT asset_id FROM room_scene_assets)`)).rows;
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  await tdb?.drop();
  if (objects) await rm(objects, { recursive: true, force: true });
});

describe('seed-media', () => {
  it('writes a file for every seeded catalogue asset, then keeps them on a re-run', async () => {
    const lines: string[] = [];
    const first = await seedMedia({ databaseUrl: tdb.url, objectsDir: objects, bucket: 'assets', force: false, log: (l) => lines.push(l) });
    expect(rows.length).toBeGreaterThan(40);
    expect(first).toEqual({ written: rows.length, kept: 0, skipped: 0 });
    expect(lines.join('\n')).toContain(join(objects, 'assets'));

    const files = new LocalObjectFiles(objects, 'assets');
    for (const row of rows) {
      const body = await files.get(row.storage_key);
      expect(await files.head(row.storage_key), row.storage_key).toEqual({ contentType: row.content_type, byteSize: body?.byteLength });
      const magic = body!.subarray(0, 12).toString('latin1');
      if (row.content_type === 'image/webp') expect(magic, row.storage_key).toMatch(/^RIFF....WEBP$/s);
      if (row.content_type === 'model/gltf-binary') expect(magic.slice(0, 4), row.storage_key).toBe('glTF');
    }

    // Espoo's own models are the real sample GLBs; the low LOD stays the low one.
    const espooLow = rows.find(r => /^assets\/lo\/.*espoo-compact/.test(r.storage_key));
    const espooHigh = rows.find(r => /^assets\/hi\/.*espoo-compact.*high/.test(r.storage_key));
    expect(await files.get(espooLow!.storage_key)).toEqual(await readFile(join(SAMPLE, 'espoo-compact-low.glb')));
    expect(await files.get(espooHigh!.storage_key)).toEqual(await readFile(join(SAMPLE, 'espoo-compact.glb')));

    const second = await seedMedia({ databaseUrl: tdb.url, objectsDir: objects, bucket: 'assets', force: false, log: () => {} });
    expect(second).toEqual({ written: 0, kept: rows.length, skipped: 0 });
  }, 180_000);
});
