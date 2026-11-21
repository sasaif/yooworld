#!/usr/bin/env node
// Applies db/migrations to a database given by URL (Phase C: Neon, as the owner the first time, then `migrator`).
// Same bookkeeping as scripts/migrate.mjs (migrations.applied + checksums, one transaction per migration,
// yoland.env set per transaction) but never creates/drops databases and never sets passwords.
// Guards: YOLAND_ENV must be uat|prod (or local with --allow-loopback for the local rehearsal); non-local requires
// sslmode=require and a non-loopback host; uat refuses a URL containing "prod"; prod requires --i-am-alessandro.
//   YOLAND_ENV=uat DATABASE_URL=postgres://...?sslmode=require node infra/neon/migrate-url.mjs [--dry-run]
import pg from 'pg';
import { listMigrations } from '../../scripts/migrate.mjs';

/** Applies pending migrations through an already-connected pg-compatible client (pg.Client, or a pooled client of the
 *  Neon serverless driver when raw 5432 is not routable). Throws on a modified or failing migration. */
/** Managed Postgres (Neon): the owner role is not a superuser, and PostgreSQL refuses the SUPERUSER/NOSUPERUSER clause
 *  from a non-superuser even as a no-op. Roles created by a non-superuser can never be superusers, so the clause is
 *  dropped from 0001 only (checksum still recorded for the ORIGINAL file; rolsuper = false is asserted afterwards by
 *  infra/neon/setup-roles.sql). Nothing else is ever rewritten. The owner session also sets createrole_self_grant. */
export function managedPgSql(name, sql) {
  if (!name.startsWith('0001_')) return sql;
  return sql.replace(/(ALTER ROLE\s+\w+\s+)NOSUPERUSER\s+/g, '$1');
}
export async function applyMigrations(c, env, { dryRun = false, log = console.log } = {}) {
  const superuser = (await c.query('select rolsuper from pg_roles where rolname = current_user')).rows[0]?.rolsuper === true;
  // PG16+: a non-superuser creator only gets ADMIN on the roles it creates; the migrations need SET (SET ROLE eco_owner,
  // ALTER DEFAULT PRIVILEGES FOR ROLE eco_owner), so the owner session grants itself SET + INHERIT on new roles.
  if (!superuser) await c.query(`set createrole_self_grant = 'set, inherit'`);
  await c.query(`create schema if not exists migrations;
    create table if not exists migrations.applied (version text primary key, name text not null, checksum text not null,
      env text not null, applied_at timestamptz not null default now())`);
  const done = new Map((await c.query('select version, checksum from migrations.applied')).rows.map((r) => [r.version, r.checksum]));
  const applied = [];
  for (const m of listMigrations()) {
    if (done.has(m.version)) { if (done.get(m.version) !== m.checksum) throw new Error(`migration ${m.name} was modified after being applied`); continue; }
    if (dryRun) { log(`would apply ${m.name}`); continue; }
    const t0 = performance.now();
    await c.query('begin');
    try {
      await c.query(`select set_config('yoland.env', $1, true)`, [env]);
      await c.query(superuser ? m.sql : managedPgSql(m.name, m.sql));
      await c.query('insert into migrations.applied(version, name, checksum, env) values ($1,$2,$3,$4)', [m.version, m.name, m.checksum, env]);
      await c.query('commit');
    } catch (e) { await c.query('rollback'); throw new Error(`${m.name}: ${e.message}`); }
    applied.push(m.name); log(`applied ${m.name} (${(performance.now() - t0).toFixed(0)} ms)`);
  }
  return applied;
}
/** Same guards as the CLI (exported for reuse/tests). */
export function checkTarget(env, url, flags) {
  if (!['local', 'uat', 'prod'].includes(env)) return 'YOLAND_ENV must be uat|prod (local only with --allow-loopback)';
  let u; try { u = new URL(url); } catch { return 'DATABASE_URL is not a URL'; }
  const loop = ['127.0.0.1', 'localhost', '::1'].includes(u.hostname);
  if (env === 'local' && !(loop && flags.includes('--allow-loopback'))) return 'local rehearsal needs a loopback URL and --allow-loopback';
  if (env !== 'local' && (loop || u.searchParams.get('sslmode') !== 'require')) return `${env}: non-loopback host with sslmode=require required`;
  if (env === 'uat' && /prod/i.test(u.hostname + u.pathname)) return 'uat URL looks like production';
  if (env === 'prod' && !flags.includes('--i-am-alessandro')) return 'prod migrations require --i-am-alessandro (run by the account owner)';
  return null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const env = process.env.YOLAND_ENV, url = process.env.DATABASE_URL ?? '';
  const bad = checkTarget(env, url, process.argv);
  if (bad) { console.error(bad); process.exit(2); }
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await applyMigrations(c, env, { dryRun: process.argv.includes('--dry-run') }); }
  catch (e) { console.error(e.message); process.exitCode = 2; }
  finally { await c.end(); }
}
