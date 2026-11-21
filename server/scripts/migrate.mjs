#!/usr/bin/env node
// Migration runner. Phase B: LOCAL ONLY by default.
//   node scripts/migrate.mjs            apply pending migrations to the local DB (creates it if missing)
//   node scripts/migrate.mjs --reset    drop + recreate the local DB, then apply everything
// Each migration runs in its own transaction with `yoland.env` set (eco.env is written once, immutable).
// Checksums of applied migrations are verified: editing an applied migration is refused.
// Safety: refuses YOLAND_ENV=prod (no production migration in Phase B) and refuses non-loopback hosts.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { SERVER_DIR, DB_NAME, PG_HOST, conn, LOCAL_ROLE_PASSWORDS } from './local-env.mjs';

export const MIGRATIONS_DIR = path.join(SERVER_DIR, 'db', 'migrations');

export function listMigrations() {
  return fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort()
    .map((f) => { const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8');
      return { version: f.slice(0, 4), name: f, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') }; });
}

export async function migrate({ database = DB_NAME, reset = false, env = process.env.YOLAND_ENV || 'local', log = console.log } = {}) {
  if (env === 'prod') throw new Error('Phase B: production migrations are disabled');
  if (!['local', 'uat'].includes(env)) throw new Error(`unknown YOLAND_ENV ${env}`);
  if (PG_HOST !== '127.0.0.1') throw new Error('refusing a non-loopback database host');
  const admin = new pg.Client(conn(undefined, undefined, 'postgres'));
  await admin.connect();
  try {
    const exists = (await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount > 0;
    if (reset && exists) {
      await admin.query('select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()', [database]);
      await admin.query(`drop database ${pg.escapeIdentifier(database)}`);
    }
    if (reset || !exists) await admin.query(`create database ${pg.escapeIdentifier(database)}`);
  } finally { await admin.end(); }

  const c = new pg.Client(conn(undefined, undefined, database));
  await c.connect();
  const applied = [];
  try {
    await c.query(`create schema if not exists migrations;
      revoke all on schema migrations from public;
      create table if not exists migrations.applied (version text primary key, name text not null, checksum text not null,
        env text not null, applied_at timestamptz not null default now())`);
    const done = new Map((await c.query('select version, checksum from migrations.applied')).rows.map((r) => [r.version, r.checksum]));
    for (const m of listMigrations()) {
      if (done.has(m.version)) {
        if (done.get(m.version) !== m.checksum) throw new Error(`migration ${m.name} was modified after being applied`);
        continue;
      }
      const t0 = performance.now();
      await c.query('begin');
      try {
        await c.query(`select set_config('yoland.env', $1, true)`, [env]);
        await c.query(m.sql);
        await c.query('insert into migrations.applied(version, name, checksum, env) values ($1,$2,$3,$4)', [m.version, m.name, m.checksum, env]);
        await c.query('commit');
      } catch (e) { await c.query('rollback'); e.message = `${m.name}: ${e.message}`; throw e; }
      applied.push(m.name);
      log(`applied ${m.name} (${(performance.now() - t0).toFixed(0)} ms)`);
    }
    if (env === 'local') {   // throwaway local passwords only (UAT/prod passwords live in the platform secret store)
      for (const [role, pw] of Object.entries(LOCAL_ROLE_PASSWORDS)) {
        await c.query(`alter role ${pg.escapeIdentifier(role)} password ${pg.escapeLiteral(pw)}`);
      }
    }
  } finally { await c.end(); }
  return applied;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes('--reset') })
    .then((a) => { console.log(a.length ? `${a.length} migration(s) applied` : 'up to date'); })
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
