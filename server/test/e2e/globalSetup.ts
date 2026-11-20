// Starts the private Postgres if needed and recreates yoland_e2e. wrangler is started per test file (harness.ts).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
// @ts-expect-error plain .mjs helper
import { migrate } from '../../scripts/migrate.mjs';
let startedHere = false;
const script = path.resolve(__dirname, '../../scripts/pg-local.mjs');
export async function setup() {
  let running = true;
  try { execFileSync(process.execPath, [script, 'status'], { stdio: 'ignore' }); } catch { running = false; }
  if (!running) { execFileSync(process.execPath, [script, 'start'], { stdio: 'inherit' }); startedHere = true; }
  await migrate({ database: 'yoland_e2e', reset: true, env: 'local', log: () => {} });
}
export async function teardown() {
  if (startedHere && !process.env.KEEP_PG) execFileSync(process.execPath, [script, 'stop'], { stdio: 'inherit' });
}
