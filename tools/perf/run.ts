/**
 * Query-plan benchmark at design scale.
 *
 *   node tools/perf/run.ts                      build a scaled throwaway DB, EXPLAIN, drop it
 *   node tools/perf/run.ts --keep               ...and keep the DB (prints its URL)
 *   node tools/perf/run.ts --url <owner-url>    reuse a kept DB (no load)
 *   node tools/perf/run.ts --url <u> --migrate  apply pending migrations to it first
 *   --scale 0.1        smaller dataset        --runs 5         EXPLAIN runs per query (median)
 *   --plans <dir>      write each text plan   --json <file>    write timings as JSON
 *
 * Each query runs inside a transaction as the role the API uses (app_tenant with
 * app.reseller_id = alpha, the largest tenant; app_platform for manufacturer queries),
 * once to warm the cache and then `--runs` times under EXPLAIN (ANALYZE, BUFFERS).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import pg from 'pg';
import { migrate } from '../../packages/db/src/migrate.ts';
import { createScaleDatabase, tableCounts } from './seed-scale.ts';
import { QUERIES, loadContext, type PerfContext, type PerfQuery } from './queries.ts';

interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  Plans?: PlanNode[];
}

export interface Timing {
  name: string;
  medianMs: number;
  minMs: number;
  sharedHit: number;
  sharedRead: number;
  rows: number;
  scans: string;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/** Distinct scan nodes of a plan, e.g. "Index Scan customers_reseller_created_idx". */
function scans(node: PlanNode, out = new Set<string>()): Set<string> {
  if (/Scan/.test(node['Node Type'])) out.add(`${node['Node Type']} ${node['Index Name'] ?? node['Relation Name'] ?? ''}`.trim());
  for (const child of node.Plans ?? []) scans(child, out);
  return out;
}

async function inRole<T>(client: pg.Client, q: PerfQuery, ctx: PerfContext, fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL ROLE ${q.role}`);
    if (q.role === 'app_tenant') await client.query(`select set_config('app.reseller_id', $1, true)`, [ctx.alphaId]);
    if (q.asCustomer) await client.query(`select set_config('app.actor_customer_id', $1, true)`, [ctx.customerId]);
    return await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

export async function explainAll(url: string, opts: { runs?: number; plansDir?: string; only?: RegExp } = {}): Promise<Timing[]> {
  const runs = opts.runs ?? 3;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`SET jit = off`); // JIT compile time would drown the planner's choices at this size
    const ctx = await loadContext(client);
    if (opts.plansDir) await mkdir(opts.plansDir, { recursive: true });
    const out: Timing[] = [];
    for (const q of QUERIES) {
      if (opts.only && !opts.only.test(q.name)) continue;
      const params = q.params(ctx);
      const result = await inRole(client, q, ctx, async () => {
        const warm = await client.query(q.sql, params);
        const times: number[] = [];
        let last: { Plan: PlanNode; 'Execution Time': number } | undefined;
        let buffers = { hit: 0, read: 0 };
        for (let i = 0; i < runs; i++) {
          const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${q.sql}`, params);
          last = (rows[0]['QUERY PLAN'] as { Plan: PlanNode & { 'Shared Hit Blocks': number; 'Shared Read Blocks': number }; 'Execution Time': number }[])[0]!;
          times.push(last['Execution Time']);
          const p = last.Plan as PlanNode & { 'Shared Hit Blocks': number; 'Shared Read Blocks': number };
          buffers = { hit: p['Shared Hit Blocks'], read: p['Shared Read Blocks'] };
        }
        if (opts.plansDir) {
          const { rows } = await client.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, params);
          const text = rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n');
          const file = q.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
          await writeFile(join(opts.plansDir, `${file}.txt`), `${q.name}\n\n${q.sql.trim()}\n\n${text}\n`);
        }
        return { times, plan: last!.Plan, buffers, rows: warm.rowCount ?? 0 };
      });
      out.push({
        name: q.name,
        medianMs: median(result.times),
        minMs: Math.min(...result.times),
        sharedHit: result.buffers.hit,
        sharedRead: result.buffers.read,
        rows: result.rows,
        scans: [...scans(result.plan)].join(', '),
      });
    }
    return out;
  } finally {
    await client.end();
  }
}

export function markdown(timings: Timing[]): string {
  const lines = ['| Query | median ms | buffers (hit) | rows | scans |', '|---|---:|---:|---:|---|'];
  for (const t of timings) lines.push(`| ${t.name} | ${t.medianMs.toFixed(2)} | ${t.sharedHit} | ${t.rows} | ${t.scans} |`);
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      keep: { type: 'boolean', default: false },
      migrate: { type: 'boolean', default: false },
      scale: { type: 'string', default: '1' },
      runs: { type: 'string', default: '3' },
      plans: { type: 'string' },
      json: { type: 'string' },
      only: { type: 'string' },
    },
  });
  const log = (m: string) => console.error(m);
  let url = values.url;
  let drop: (() => Promise<void>) | undefined;
  if (!url) {
    log(`loading scaled dataset (scale ${values.scale})…`);
    const db = await createScaleDatabase({ scale: Number(values.scale), log });
    url = db.url;
    if (!values.keep) drop = () => db.drop();
    else log(`kept database: ${db.url}`);
  } else if (values.migrate) {
    const applied = await migrate(url, { local: true });
    log(`applied: ${applied.join(', ') || 'nothing'}`);
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    await c.query('ANALYZE');
    await c.end();
  }
  try {
    log(JSON.stringify(await tableCounts(url)));
    const timings = await explainAll(url, { runs: Number(values.runs), ...(values.plans ? { plansDir: values.plans } : {}), ...(values.only ? { only: new RegExp(values.only, 'i') } : {}) });
    console.log(markdown(timings));
    if (values.json) await writeFile(values.json, JSON.stringify(timings, null, 2));
  } finally {
    await drop?.();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
