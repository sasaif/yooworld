// Starts the PRIVATE local Postgres (server/.local/pgdata, port 54339) if needed, recreates the test DB
// from the migrations, writes SQL function coverage (pg_stat_user_functions) at the end, and stops
// Postgres afterwards if this run started it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
// @ts-expect-error plain .mjs helper
import { migrate } from '../scripts/migrate.mjs';
// @ts-expect-error plain .mjs helper
import { conn } from '../scripts/local-env.mjs';
import { TEST_DB } from './helpers/db';

let startedHere = false;
const script = path.resolve(__dirname, '../scripts/pg-local.mjs');
export async function setup() {
  let running = true;
  try { execFileSync(process.execPath, [script, 'status'], { stdio: 'ignore' }); } catch { running = false; }
  if (!running) { execFileSync(process.execPath, [script, 'start'], { stdio: 'inherit' }); startedHere = true; }
  await migrate({ database: TEST_DB, reset: true, env: 'local', log: () => {} });
  const c = new pg.Client(conn(undefined, undefined, TEST_DB)); await c.connect();
  await c.query(`alter database ${TEST_DB} set track_functions = 'all'`); await c.end();
}
export async function teardown() {
  try {
    await new Promise((r) => setTimeout(r, 1500));   // let backend stats flush
    const c = new pg.Client(conn(undefined, undefined, TEST_DB)); await c.connect();
    const rows = (await c.query(`
      select n.nspname || '.' || p.proname as fn, coalesce(s.calls, 0)::int as calls
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      left join pg_stat_user_functions s on s.funcid = p.oid
      where n.nspname in ('eco','social','prog','mod','audit') and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
      order by 1`)).rows as { fn: string; calls: number }[];
    await c.end();
    const covered = rows.filter((r) => r.calls > 0);
    const out = path.resolve(__dirname, '../test-results/sql-coverage.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ covered: covered.length, total: rows.length, uncovered: rows.filter((r) => !r.calls).map((r) => r.fn), rows }, null, 2));
    console.log(`SQL function coverage: ${covered.length}/${rows.length} (uncovered: ${rows.filter((r) => !r.calls).map((r) => r.fn).join(', ') || 'none'})`);
  } catch (e) { console.warn('sql coverage skipped:', (e as Error).message); }
  if (startedHere && !process.env.KEEP_PG) execFileSync(process.execPath, [script, 'stop'], { stdio: 'inherit' });
}
