// Box tool (committed for review): needs `@neondatabase/serverless` + `ws` resolvable from here (deliberately NOT in
// package.json; the box runs a copy in work-backend/neon-tools). Env: NEON_API_KEY, NEON_OWNER_URL, BACKUP_RO_PW.
// uat backup drill: dump uat (backup_ro) -> age encrypt -> [R2 upload BLOCKED: R2 not enabled] -> decrypt ->
// scratch Neon branch from uat + NEW empty database -> same 13 migrations -> restore -> verify -> delete scratch branch.
import { Pool, neonConfig } from '@neondatabase/serverless'; import ws from 'ws';
import { dumpWith, newKeypair, encrypt, decrypt, restoreWith, rowCounts } from '../../scripts/backup.mjs';
import { applyMigrations } from './migrate-url.mjs';
neonConfig.webSocketConstructor = ws;
const API = 'https://console.neon.tech/api/v2', P = 'spring-recipe-02836917', UAT = 'br-rough-scene-bgxojamf';
const H = { authorization: `Bearer ${process.env.NEON_API_KEY}`, 'content-type': 'application/json', accept: 'application/json' };
const neon = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: H, body: b && JSON.stringify(b) }); const j = await r.json(); if (!r.ok) throw new Error(`${m} ${p} ${r.status} ${j.message}`); return j; };
const R = {}; const t = () => performance.now(); const ms = (t0) => +(performance.now() - t0).toFixed(0);
const withPool = async (url, fn) => { const pool = new Pool({ connectionString: url }); const c = await pool.connect();
  // box-only shim: the Neon WebSocket socket lacks pause/resume, which pg-copy-streams calls for back-pressure
  const st = c.connection?.stream; if (st) { st.pause ??= () => {}; st.resume ??= () => {}; }
  try { return await fn(c); } finally { c.release(); await pool.end(); } };
const owner = new URL(process.env.NEON_OWNER_URL);
const roleUrl = (host, db, user, pw) => { const u = new URL(owner); u.hostname = host; u.pathname = '/' + db; if (user) { u.username = user; u.password = pw; } return u.toString(); };
let scratch = null;
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const cleanup = async () => { if (scratch) { const id = scratch; scratch = null; try { await neon('DELETE', `/projects/${P}/branches/${id}`); R.scratch_deleted = true; } catch (e) { R.scratch_deleted = 'FAILED ' + e.message; } } };
setTimeout(async () => { R.error = 'watchdog 900 s'; await cleanup(); console.log(JSON.stringify(R, null, 1)); process.exit(3); }, 900_000).unref();
try {
  let t0 = t();
  const buf = await withPool(roleUrl(owner.hostname, "yoland", "backup_ro", process.env.BACKUP_RO_PW), (c) => dumpWith(c, { via: "json" }));
  const header = JSON.parse(buf.subarray(0, buf.indexOf(10)).toString());
  R.dump = { bytes: buf.length, ms: ms(t0), env: header.env, tables: header.sections.length, rows: Object.values(header.counts).reduce((a, b) => a + b, 0) };
  t0 = t(); const kp = await newKeypair(); const enc = await encrypt(buf, kp.recipient); R.encrypt = { bytes: enc.length, ms: ms(t0), identity: 'in memory only, discarded' };
  log('dumped'); R.r2_upload = 'BLOCKED: R2 is not enabled on the YoLand Cloudflare account (API 10042: enable R2 in the dashboard)';
  const dec = await decrypt(enc, kp.identity); R.decrypt_roundtrip_equal = Buffer.compare(dec, buf) === 0;

  t0 = t();
  const name = `scratch-restore-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}`;
  const b = await neon('POST', `/projects/${P}/branches`, { branch: { name, parent_id: UAT }, endpoints: [{ type: 'read_write', autoscaling_limit_max_cu: 0.25 }] });
  scratch = b.branch.id; const host = b.endpoints[0].host;
  for (let i = 0; i < 60; i++) { const ops = (await neon('GET', `/projects/${P}/operations?limit=10`)).operations.filter((o) => o.branch_id === scratch && !['finished', 'skipped'].includes(o.status)); if (!ops.length) break; await new Promise((r) => setTimeout(r, 1000)); }
  await neon('POST', `/projects/${P}/branches/${scratch}/databases`, { database: { name: 'yoland_restore', owner_name: owner.username } });
  for (let i = 0; i < 60; i++) { const ops = (await neon('GET', `/projects/${P}/operations?limit=10`)).operations.filter((o) => o.branch_id === scratch && !['finished', 'skipped'].includes(o.status)); if (!ops.length) break; await new Promise((r) => setTimeout(r, 1000)); }
  log('scratch ready'); R.scratch = { branch: name, id: scratch, ms: ms(t0) };
  const target = roleUrl(host, 'yoland_restore');
  t0 = t();
  R.restore = await withPool(target, async (c) => {
    const empty = Number((await c.query(`select count(*) n from pg_namespace where nspname in ('eco','auth')`)).rows[0].n) === 0;
    if (!empty) throw new Error('target not empty');
    log('migrations'); await applyMigrations(c, 'uat', { log });
    log('restore'); await restoreWith(c, dec, { env: 'uat' });
    log('counts'); const counts = await rowCounts(c); log('verify');
    const same = Object.entries(header.counts).every(([k, v]) => counts[k] === v);
    const v = (await c.query('select eco.recon_summary() r, audit.verify_chain() a, (select count(*) from migrations.applied) m, (select tag from eco.env) env')).rows[0];
    const gold = (await c.query(`select coalesce(sum(balance),0)::int g from eco.wallets w join eco.players p on p.id = w.player_id where p.kind = 'player'`).catch(() => ({ rows: [{ g: 'n/a' }] }))).rows[0].g;
    return { ms: 0, row_counts_equal: same, migrations: Number(v.m), env: v.env, recon_all_zero: Object.values(v.r).every((x) => x === 0), audit_chain: v.a, player_gold_total: gold };
  });
  R.restore.ms = ms(t0);
} catch (e) { R.error = String(e?.message ?? e).slice(0, 400); process.exitCode = 1; }
finally {
  await cleanup();
  console.log(JSON.stringify(R, null, 1));
}
