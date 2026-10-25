/**
 * Prints the estimated plan (EXPLAIN without ANALYZE) of the perf queries whose name
 * matches a pattern, in the same role and tenant context as run.ts uses.
 *   node tools/perf/plan.ts --url <db> --only "config.*page 1" [--analyze]
 */
import { parseArgs } from 'node:util';
import pg from 'pg';
import { QUERIES, loadContext } from './queries.ts';

const { values } = parseArgs({ options: { url: { type: 'string' }, only: { type: 'string', default: '.' }, analyze: { type: 'boolean', default: false } } });
const client = new pg.Client({ connectionString: values.url });
await client.connect();
try {
  await client.query('SET jit = off');
  const ctx = await loadContext(client);
  const only = new RegExp(values.only!, 'i');
  for (const q of QUERIES.filter((x) => only.test(x.name))) {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${q.role}`);
      if (q.role === 'app_tenant') await client.query(`select set_config('app.reseller_id', $1, true)`, [ctx.alphaId]);
      if (q.asCustomer) await client.query(`select set_config('app.actor_customer_id', $1, true)`, [ctx.customerId]);
      const { rows } = await client.query(`EXPLAIN ${values.analyze ? '(ANALYZE, BUFFERS) ' : ''}${q.sql}`, q.params(ctx));
      console.log(`== ${q.name}\n${rows.map((r: Record<string, string>) => r['QUERY PLAN']).join('\n')}\n`);
    } finally {
      await client.query('ROLLBACK');
    }
  }
} finally {
  await client.end();
}
