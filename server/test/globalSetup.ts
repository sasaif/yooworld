// Starts the PRIVATE local Postgres (server/.local/pgdata, port 54339) if needed, recreates the test DB
// from the migrations, and stops Postgres afterwards if this run started it.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
// @ts-expect-error plain .mjs helper
import { migrate } from '../scripts/migrate.mjs';
import { TEST_DB } from './helpers/db';

let startedHere = false;
const script = path.resolve(__dirname, '../scripts/pg-local.mjs');
export async function setup() {
  let running = true;
  try { execFileSync(process.execPath, [script, 'status'], { stdio: 'ignore' }); } catch { running = false; }
  if (!running) { execFileSync(process.execPath, [script, 'start'], { stdio: 'inherit' }); startedHere = true; }
  await migrate({ database: TEST_DB, reset: true, env: 'local', log: () => {} });
}
export async function teardown() {
  if (startedHere && !process.env.KEEP_PG) execFileSync(process.execPath, [script, 'stop'], { stdio: 'inherit' });
}
