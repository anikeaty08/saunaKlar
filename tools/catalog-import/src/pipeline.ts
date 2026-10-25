/**
 * validate → optimise → plan → (dry-run stops here) → upload → apply (one transaction per
 * sauna/room as catalog_admin) → bump_all_catalog_versions() once.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCatalog, type Catalog } from './catalog.ts';
import { applyAttributes, applyRoom, applySauna, bumpCatalogVersions, describeDbError, resolveManufacturer, type TxRunner } from './apply.ts';
import { IMMUTABLE_CACHE, type ObjectStore } from './object-store.ts';
import { detectOptimiser, prepareAssets, type Optimiser } from './optimise.ts';
import { planAttributes, planIsEmpty, planRoom, planSauna, plannedAssets, roomOwner, type ItemPlan, type Plan, type PlannedAsset } from './plan.ts';
import { makeStyle, printDiagnostics, printPlan, type Output, type Style } from './output.ts';
import type { Queryable } from './state.ts';
import { formatBytes } from './files.ts';

export interface DbAccess {
  /** One transaction as role catalog_admin. */
  catalogTx: TxRunner;
  /** Owner connection used only for read-only pre-checks against reseller data; null to skip them. */
  owner: Queryable | null;
}

export interface RunOptions {
  dir: string;
  dryRun?: boolean;
  allowOversize?: boolean;
  manufacturer?: string | undefined;
  /** Validation only: no database, no plan. */
  validateOnly?: boolean;
  db?: DbAccess;
  store?: ObjectStore;
  /** 'auto' (default) detects gltf-transform on PATH; null disables optimisation. */
  optimiser?: Optimiser | null | 'auto';
  out: Output;
  style?: Style;
}

export interface RunResult {
  exitCode: 0 | 1 | 2;
  catalog?: Catalog;
  plan?: Plan;
  applied: string[];
  failed: { key: string; message: string }[];
  bumped: boolean;
}

export async function runImport(opts: RunOptions): Promise<RunResult> {
  const { out } = opts;
  const st = opts.style ?? makeStyle(false);
  const result: RunResult = { exitCode: 0, applied: [], failed: [], bumped: false };

  // 1. Validate
  out.line(st.bold(`Validating ${opts.dir}`));
  const { catalog, diagnostics } = await loadCatalog(opts.dir, { allowOversize: !!opts.allowOversize });
  result.catalog = catalog;
  printDiagnostics(out, st, diagnostics.items);
  if (!diagnostics.ok) {
    out.error(st.red(`✗ ${diagnostics.errors.length} error(s); nothing was imported.`));
    result.exitCode = 1;
    return result;
  }
  out.line(st.green(`✓ ${catalog.saunas.length} sauna(s), ${catalog.rooms.length} room(s), ${catalog.attributes.length} attribute(s) valid`)
    + (diagnostics.warnings.length ? st.yellow(` (${diagnostics.warnings.length} warning(s))`) : ''));
  if (opts.validateOnly) return result;
  if (!opts.db) throw new Error('database access is required to plan');

  // 2. Optimise
  const optimiser = opts.optimiser === undefined || opts.optimiser === 'auto' ? await detectOptimiser() : opts.optimiser;
  const hasAssets = catalog.saunas.some((s) => s.assets.length) || catalog.rooms.some((r) => r.assets.length);
  if (hasAssets && !optimiser) {
    out.line(st.yellow('! gltf-transform not found on PATH: models are uploaded as they are (no Draco/meshopt, KTX2, LOD). Install @gltf-transform/cli to optimise.'));
  }
  const work = await mkdtemp(join(tmpdir(), 'catalog-import-'));
  try {
    const assets = new Map<string, PlannedAsset[]>();
    for (const s of catalog.saunas) {
      const prepared = await prepareAssets(s.assets, join(work, 'saunas', s.slug), optimiser, (m) => out.line(st.yellow(`! ${m}`)));
      assets.set(`sauna:${s.sku}`, plannedAssets(s.slug, prepared));
    }
    for (const r of catalog.rooms) {
      const prepared = await prepareAssets(r.assets, join(work, 'rooms', r.code), optimiser, (m) => out.line(st.yellow(`! ${m}`)));
      assets.set(`room:${r.code}`, plannedAssets(roomOwner(r.code), prepared));
    }

    // 3. Plan
    const db = opts.db;
    const plan: Plan = await db.catalogTx(async (tx) => {
      const items: ItemPlan[] = [await planAttributes(tx, catalog)];
      for (const s of catalog.saunas) items.push(await planSauna(tx, db.owner, s, assets.get(`sauna:${s.sku}`)!));
      for (const r of catalog.rooms) items.push(await planRoom(tx, r, assets.get(`room:${r.code}`)!));
      return { items };
    });
    result.plan = plan;
    out.line();
    printPlan(out, st, plan);
    const blocked = plan.items.filter((i) => i.blockers.length > 0);

    if (opts.dryRun) {
      out.line(st.dim('Dry run: nothing was uploaded or written.'));
      if (blocked.length) result.exitCode = 1;
      return result;
    }
    if (planIsEmpty(plan) && blocked.length === 0) {
      out.line(st.green('✓ Catalog is up to date.'));
      return result;
    }

    // 4. Upload (only what changed items reference; existing keys are immutable and skipped)
    if (!opts.store) throw new Error('an object store is required to apply');
    const store = opts.store;
    const toApply = plan.items.filter((i) => i.changes.length > 0 && i.blockers.length === 0);
    let uploaded = 0, skipped = 0;
    for (const item of toApply) {
      for (const a of assets.get(`${item.kind}:${item.key}`) ?? []) {
        if (await store.exists(a.key)) { skipped++; continue; }
        await store.put(a.key, await readFile(a.outPath), a.contentType, IMMUTABLE_CACHE);
        out.line(`  ${st.cyan('↑')} ${a.key} ${st.dim(formatBytes(a.byteSize))}`);
        uploaded++;
      }
    }
    if (uploaded || skipped) out.line(st.dim(`Uploaded ${uploaded} file(s) to ${store.description}, ${skipped} already present.`));

    // 5. Apply
    for (const item of blocked) {
      result.failed.push({ key: item.key, message: item.blockers.join('; ') });
      out.error(`${st.red('✗')} ${item.kind} ${st.bold(item.key)} not imported: ${item.blockers.join('; ')}`);
    }
    let manufacturerId: string | null = null;
    const needsManufacturer = toApply.some((i) => i.kind !== 'attributes');
    if (needsManufacturer) manufacturerId = await db.catalogTx((tx) => resolveManufacturer(tx, db.owner, opts.manufacturer));

    for (const item of toApply) {
      try {
        if (item.kind === 'attributes') {
          await db.catalogTx((tx) => applyAttributes(tx, catalog));
        } else if (item.kind === 'sauna') {
          const s = catalog.saunas.find((x) => x.sku === item.key)!;
          await db.catalogTx((tx) => applySauna(tx, manufacturerId!, s, assets.get(`sauna:${s.sku}`)!));
        } else {
          const r = catalog.rooms.find((x) => x.code === item.key)!;
          await db.catalogTx((tx) => applyRoom(tx, manufacturerId!, r, assets.get(`room:${r.code}`)!));
        }
        result.applied.push(item.key);
        out.line(`${st.green('✓')} ${item.kind} ${st.bold(item.key)} ${st.dim(`${item.changes.length} change(s)`)}`);
      } catch (e) {
        const message = describeDbError(e);
        result.failed.push({ key: item.key, message });
        out.error(`${st.red('✗')} ${item.kind} ${st.bold(item.key)} rolled back: ${message}`);
      }
    }

    // 6. Bump once
    if (result.applied.length > 0) {
      await db.catalogTx((tx) => bumpCatalogVersions(tx));
      result.bumped = true;
      out.line(st.dim('Bumped catalog_version for every reseller.'));
    }
    if (result.failed.length) {
      out.error(st.red(`✗ ${result.failed.length} item(s) failed, ${result.applied.length} applied.`));
      result.exitCode = 1;
    } else {
      out.line(st.green(`✓ Imported ${result.applied.length} item(s).`));
    }
    return result;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
