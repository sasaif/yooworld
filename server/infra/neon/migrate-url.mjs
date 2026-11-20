#!/usr/bin/env node
// Applies db/migrations to a database given by URL (Phase C: Neon, as the owner the first time, then `migrator`).
// Same bookkeeping as scripts/migrate.mjs (migrations.applied + checksums, one transaction per migration,
// yoland.env set per transaction) but never creates/drops databases and never sets passwords.
// Guards: YOLAND_ENV must be uat|prod (or local with --allow-loopback for the local rehearsal); non-local requires
// sslmode=require and a non-loopback host; uat refuses a URL containing "prod"; prod requires --i-am-alessandro.
//   YOLAND_ENV=uat DATABASE_URL=postgres://...?sslmode=require node infra/neon/migrate-url.mjs [--dry-run]
import pg from 'pg';
import { listMigrations } from '../../scripts/migrate.mjs';

const env = process.env.YOLAND_ENV, url = process.env.DATABASE_URL ?? '';
const flag = (f) => process.argv.includes(f);
const die = (m) => { console.error(m); process.exit(2); };
if (!['local', 'uat', 'prod'].includes(env)) die('YOLAND_ENV must be uat|prod (local only with --allow-loopback)');
let u; try { u = new URL(url); } catch { die('DATABASE_URL is not a URL'); }
const loop = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
if (env === 'local' && !(loop && flag('--allow-loopback'))) die('local rehearsal needs a loopback URL and --allow-loopback');
if (env !== 'local' && (loop || u.searchParams.get('sslmode') !== 'require')) die(`${env}: non-loopback host with sslmode=require required`);
if (env === 'uat' && /prod/i.test(u.hostname + u.pathname)) die('uat URL looks like production');
if (env === 'prod' && !flag('--i-am-alessandro')) die('prod migrations require --i-am-alessandro (run by the account owner)');

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  await c.query(`create schema if not exists migrations;
    create table if not exists migrations.applied (version text primary key, name text not null, checksum text not null,
      env text not null, applied_at timestamptz not null default now())`);
  const done = new Map((await c.query('select version, checksum from migrations.applied')).rows.map((r) => [r.version, r.checksum]));
  for (const m of listMigrations()) {
    if (done.has(m.version)) { if (done.get(m.version) !== m.checksum) die(`migration ${m.name} was modified after being applied`); continue; }
    if (flag('--dry-run')) { console.log(`would apply ${m.name}`); continue; }
    const t0 = performance.now();
    await c.query('begin');
    try {
      await c.query(`select set_config('yoland.env', $1, true)`, [env]);
      await c.query(m.sql);
      await c.query('insert into migrations.applied(version, name, checksum, env) values ($1,$2,$3,$4)', [m.version, m.name, m.checksum, env]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); die(`${m.name}: ${e.message}`); }
    console.log(`applied ${m.name} (${(performance.now() - t0).toFixed(0)} ms)`);
  }
} finally { await c.end(); }
