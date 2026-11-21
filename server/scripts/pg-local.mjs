#!/usr/bin/env node
// Start/stop a PRIVATE local Postgres 18 (embedded-postgres binaries) for Phase B development and tests.
// Own data dir (server/.local/pgdata) and own port (54339 by default). Never touches any other cluster.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { initdb, pg_ctl } from '@embedded-postgres/linux-x64';
import { PG_DATA, PG_LOG, PG_PORT, SUPER } from './local-env.mjs';

const cmd = process.argv[2] || 'status';
const run = (bin, args, opts = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', ...opts });
  if (r.status !== 0 && !opts.allowFail) { process.stderr.write(r.stdout + r.stderr); process.exit(r.status ?? 1); }
  return r;
};
function ensureInit() {
  if (fs.existsSync(path.join(PG_DATA, 'PG_VERSION'))) return;
  fs.mkdirSync(path.dirname(PG_DATA), { recursive: true });
  const pw = path.join(path.dirname(PG_DATA), '.pwfile');
  fs.writeFileSync(pw, SUPER.password + '\n', { mode: 0o600 });
  run(initdb, ['-D', PG_DATA, '-U', SUPER.user, '--pwfile', pw, '--auth=scram-sha-256', '-E', 'UTF8', '--locale=C']);
  fs.rmSync(pw);
  // listen on loopback only; enough connections for the 1000-parallel attack suites (client pool ~100)
  fs.appendFileSync(path.join(PG_DATA, 'postgresql.conf'),
    `\nlisten_addresses = '127.0.0.1'\nport = ${PG_PORT}\nmax_connections = 250\nunix_socket_directories = ''\ntimezone = 'UTC'\nshared_buffers = 128MB\nfsync = on\n`);
  console.log('initialised', PG_DATA);
}
const status = () => run(pg_ctl, ['-D', PG_DATA, 'status'], { allowFail: true });
if (cmd === 'start') {
  ensureInit();
  if (status().status === 0) { console.log('already running on port', PG_PORT); process.exit(0); }
  run(pg_ctl, ['-D', PG_DATA, '-l', PG_LOG, '-w', '-t', '60', 'start']);
  const pid = fs.readFileSync(path.join(PG_DATA, 'postmaster.pid'), 'utf8').split('\n')[0];
  console.log(`postgres started: pid ${pid}, 127.0.0.1:${PG_PORT}, data ${PG_DATA}`);
} else if (cmd === 'stop') {
  if (status().status !== 0) { console.log('not running'); process.exit(0); }
  run(pg_ctl, ['-D', PG_DATA, '-m', 'fast', '-w', 'stop']);
  console.log('postgres stopped');
} else {
  const r = status(); process.stdout.write(r.stdout || r.stderr); process.exit(r.status ?? 1);
}
