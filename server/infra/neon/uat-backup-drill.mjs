// Box tool (committed for review): needs `@neondatabase/serverless` + `ws` resolvable from here (deliberately NOT in
// package.json; the box runs a copy in work-backend/neon-tools). Env: NEON_API_KEY, NEON_OWNER_URL, BACKUP_RO_PW.
// uat backup drill: dump uat (backup_ro) -> age encrypt -> R2 upload + download (Cloudflare API, bucket R2_BUCKET) -> decrypt ->
// scratch Neon branch from uat + NEW empty database -> same 13 migrations -> restore -> per-table content md5 vs source
// -> delete the scratch branch. Extra env: CLOUDFLARE_API_TOKEN, CF_ACCOUNT, R2_BUCKET.
import crypto from 'node:crypto';
import { Pool, neonConfig } from '@neondatabase/serverless'; import ws from 'ws';
import { dumpWith, newKeypair, encrypt, decrypt, restoreWith, rowCounts, listTables } from '../../scripts/backup.mjs';
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
// content fingerprint per table: md5 of all rows as text, sorted (independent of physical order)
const fingerprints = async (c) => { const out = {}; for (const t of await listTables(c)) out[t] = (await c.query(`select count(*)::int n, coalesce(md5(string_agg(x::text, E'\\n' order by x::text)), '') h from ${t} x`)).rows[0]; return out; };
const owner = new URL(process.env.NEON_OWNER_URL);
const roleUrl = (host, db, user, pw) => { const u = new URL(owner); u.hostname = host; u.pathname = '/' + db; if (user) { u.username = user; u.password = pw; } return u.toString(); };
let scratch = null;
const log = (m) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${m}\n`);
const cleanup = async () => { if (scratch) { const id = scratch; scratch = null; try { await neon('DELETE', `/projects/${P}/branches/${id}`); R.scratch_deleted = true; } catch (e) { R.scratch_deleted = 'FAILED ' + e.message; } } };
setTimeout(async () => { R.error = 'watchdog 900 s'; await cleanup(); console.log(JSON.stringify(R, null, 1)); process.exit(3); }, 900_000).unref();
try {
  let t0 = t();
  let srcFp;
  const buf = await withPool(roleUrl(owner.hostname, "yoland", "backup_ro", process.env.BACKUP_RO_PW), async (c) => { const b = await dumpWith(c, { via: "json" }); srcFp = await fingerprints(c); return b; });
  const header = JSON.parse(buf.subarray(0, buf.indexOf(10)).toString());
  R.dump = { bytes: buf.length, ms: ms(t0), env: header.env, tables: header.sections.length, rows: Object.values(header.counts).reduce((a, b) => a + b, 0) };
  t0 = t(); const kp = await newKeypair(); const enc = await encrypt(buf, kp.recipient); R.encrypt = { bytes: enc.length, ms: ms(t0), identity: 'in memory only, discarded' };
  log('dumped');
  // R2 through the Cloudflare API with the Workers/R2-scoped API token (no S3 key pair needed)
  const CF = `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT}/r2/buckets/${process.env.R2_BUCKET}/objects/`;
  const CFH = { authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` };
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  const key = `uat/${new Date().toISOString().slice(0, 10)}/yoland-uat-${Date.now()}.dump.age`;
  t0 = t(); let r = await fetch(CF + key, { method: 'PUT', headers: { ...CFH, 'content-type': 'application/octet-stream' }, body: enc });
  if (!r.ok) throw new Error(`r2 put ${r.status} ${(await r.text()).slice(0, 200)}`);
  R.r2_upload = { bucket: process.env.R2_BUCKET, key, bytes: enc.length, sha256: sha(enc), ms: ms(t0) };
  t0 = t(); r = await fetch(CF + key, { headers: CFH }); if (!r.ok) throw new Error(`r2 get ${r.status}`);
  const got = Buffer.from(await r.arrayBuffer());
  R.r2_download = { bytes: got.length, ms: ms(t0), sha256_equal: sha(got) === sha(enc), starts_with_age_header: got.subarray(0, 21).toString() === 'age-encryption.org/v1', plaintext_marker_absent: !got.includes(Buffer.from('GOLD_TEST')) };
  try { await decrypt(got, (await newKeypair()).identity); R.other_key_can_decrypt = true; } catch { R.other_key_can_decrypt = false; }
  const dec = await decrypt(got, kp.identity); R.decrypt_roundtrip_equal = Buffer.compare(dec, buf) === 0;

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
    log('fingerprints'); const dstFp = await fingerprints(c); log('verify');
    const diffs = Object.keys({ ...srcFp, ...dstFp }).filter((k) => JSON.stringify(srcFp[k]) !== JSON.stringify(dstFp[k]));
    const same = Object.entries(header.counts).every(([k, v]) => dstFp[k]?.n === v);
    const v = (await c.query('select eco.recon_summary() r, audit.verify_chain() a, (select count(*) from migrations.applied) m, (select tag from eco.env) env')).rows[0];
    return { ms: 0, row_counts_equal: same, tables_compared: Object.keys(dstFp).length, content_differences: diffs.length, differing_tables: diffs, migrations: Number(v.m), env: v.env, recon_all_zero: Object.values(v.r).every((x) => x === 0), audit_chain: v.a };
  });
  R.restore.ms = ms(t0);
} catch (e) { R.error = String(e?.message ?? e).slice(0, 400); process.exitCode = 1; }
finally {
  await cleanup();
  console.log(JSON.stringify(R, null, 1));
}
