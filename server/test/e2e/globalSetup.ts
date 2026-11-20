// Starts the private Postgres if needed and recreates yoland_e2e. wrangler is started per test file (harness.ts).
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
// @ts-expect-error plain .mjs helper
import { migrate } from '../../scripts/migrate.mjs';
let startedHere = false;
const script = path.resolve(__dirname, '../../scripts/pg-local.mjs');
export async function setup() {
  let running = true;
  try { execFileSync(process.execPath, [script, 'status'], { stdio: 'ignore' }); } catch { running = false; }
  if (!running) { execFileSync(process.execPath, [script, 'start'], { stdio: 'inherit' }); startedHere = true; }
  await migrate({ database: 'yoland_e2e', reset: true, env: 'local', log: () => {} });
  // the database is recreated, so the Durable Object state (directory shards, rooms, trades) of earlier runs is stale:
  // start from an empty local DO store too (otherwise shard numbers depend on previous runs)
  fs.rmSync(path.resolve(__dirname, '../../.local/wrangler-e2e'), { recursive: true, force: true });
}
export async function teardown() {
  if (startedHere && !process.env.KEEP_PG) execFileSync(process.execPath, [script, 'stop'], { stdio: 'inherit' });
}
