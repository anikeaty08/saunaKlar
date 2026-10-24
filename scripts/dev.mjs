#!/usr/bin/env node
/**
 * `npm run dev`: one command for the whole local platform.
 *
 * 1. Checks that Postgres is reachable (DATABASE_URL, default the docker-compose database).
 * 2. Applies pending migrations including the local IdP schema (LOCAL_IDP=1).
 * 3. Seeds the database when it holds no resellers or no local IdP users yet.
 * 4. Starts the API (tsx watch, port 8787) and Vite (port 5173) with prefixed, coloured output.
 *
 * Ctrl+C stops both; if either exits, the other is stopped too.
 * Flags: --no-seed skips step 3, --skip-db skips steps 1 to 3.
 */
import { spawn } from 'node:child_process';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://sauna:sauna@127.0.0.1:5432/sauna';
const API_PORT = process.env.PORT ?? '8787';
const args = new Set(process.argv.slice(2));
const isWindows = process.platform === 'win32';
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = (t) => paint('1', t);
const dim = (t) => paint('2', t);
const say = (msg) => console.log(`${paint('35', '[dev]')} ${msg}`);

/** Connection string without the password, for messages. */
function redacted(url) {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(invalid DATABASE_URL)';
  }
}

async function withClient(fn) {
  const client = new pg.Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 3000 });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function checkPostgres() {
  try {
    await withClient((c) => c.query('SELECT 1'));
    say(`Postgres reachable at ${redacted(DATABASE_URL)}`);
  } catch (err) {
    console.error(`${paint('31', '[dev]')} Cannot reach Postgres at ${redacted(DATABASE_URL)}: ${err.message}`);
    console.error('');
    console.error('  Start the local database with Docker:');
    console.error(`    ${bold('docker compose up -d postgres')}`);
    console.error('  or point DATABASE_URL at a Postgres 16 superuser connection, then run `npm run dev` again.');
    process.exit(1);
  }
}

/** Runs an npm script to completion with inherited output. */
function runNpm(script, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', script], {
      stdio: 'inherit',
      shell: isWindows,
      env: { ...process.env, DATABASE_URL, LOCAL_IDP: '1', ...extraEnv },
    });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`npm run ${script} exited with ${code}`))));
  });
}

async function needsSeed() {
  return withClient(async (c) => {
    const { rows } = await c.query(
      `SELECT (SELECT count(*) FROM resellers)::int AS resellers,
              CASE WHEN to_regclass('idp.users') IS NULL THEN 0
                   ELSE (SELECT count(*) FROM idp.users)::int END AS idp_users`,
    );
    return rows[0].resellers === 0 || rows[0].idp_users === 0;
  });
}

// ---- long-running processes --------------------------------------------------

const children = [];
let stopping = false;

function prefixLines(stream, prefix, out) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) out.write(`${prefix} ${line}\n`);
  });
  stream.on('end', () => {
    if (buffer) out.write(`${prefix} ${buffer}\n`);
  });
}

function start(name, color, workspace) {
  const prefix = paint(color, `[${name}]`.padEnd(5));
  const child = spawn('npm', ['run', 'dev', '-w', workspace], {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: isWindows,
    // Own process group, so stopping reaches tsx/vite and not just the npm wrapper.
    detached: !isWindows,
    env: { ...process.env, DATABASE_URL, PORT: API_PORT, ...(useColor ? { FORCE_COLOR: '1' } : { NO_COLOR: '1' }) },
  });
  prefixLines(child.stdout, prefix, process.stdout);
  prefixLines(child.stderr, prefix, process.stderr);
  child.on('exit', (code, signal) => {
    if (!stopping) {
      say(`${name} exited (${signal ?? code}); stopping everything`);
      stop(code ?? 1);
    }
  });
  children.push(child);
  return child;
}

function kill(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (isWindows) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child, 'SIGTERM');
  const deadline = setTimeout(() => {
    for (const child of children) kill(child, 'SIGKILL');
    process.exit(exitCode);
  }, 5000);
  deadline.unref();
  Promise.all(children.map((c) => (c.exitCode !== null || c.signalCode !== null ? null : new Promise((r) => c.once('exit', r))))).then(() =>
    process.exit(exitCode),
  );
}

process.on('SIGINT', () => {
  console.log('');
  say('stopping…');
  stop(0);
});
process.on('SIGTERM', () => stop(0));

// ---- main -------------------------------------------------------------------

async function main() {
  if (!args.has('--skip-db')) {
    await checkPostgres();
    say('applying migrations (with the local IdP schema)…');
    await runNpm('db:migrate');
    if (!args.has('--no-seed') && (await needsSeed())) {
      say('database is empty: seeding demo data…');
      await runNpm('db:seed');
    }
  }

  start('api', '36', '@saunaklar/api');
  start('web', '32', '@saunaklar/web');

  const lines = [
    ['Storefront (reseller alpha)', 'http://alpha.localhost:5173'],
    ['Reseller admin (alpha)', 'http://alpha.localhost:5173/admin'],
    ['Manufacturer admin', 'http://admin.localhost:5173'],
    ['Dev mailbox (codes, invites)', `http://localhost:${API_PORT}/dev/mail`],
  ];
  console.log('');
  for (const [label, url] of lines) console.log(`  ${label.padEnd(30)} ${bold(url)}`);
  console.log(`  ${dim('Seeded logins use the password Sauna!2026 (see README). Ctrl+C stops everything.')}`);
  console.log('');
}

main().catch((err) => {
  console.error(`${paint('31', '[dev]')} ${err.message}`);
  stop(1);
  if (children.length === 0) process.exit(1);
});
