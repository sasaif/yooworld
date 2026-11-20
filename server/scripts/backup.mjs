// Logical backup / restore for YoLand Postgres (LOCAL test harness; same flow intended for Neon + R2 in Phase C).
//   dump (COPY of every table in auth, eco, social, prog, mod, audit, app, as role backup_ro = pg_read_all_data)
//   -> age encryption (X25519 recipient; the identity/private key stays OFFLINE with the owner)
//   -> upload to an S3-compatible bucket (local emulator here, R2 later) with SigV4
//   -> download -> decrypt -> restore into an EMPTY database: schema from the migrations, data by COPY with
//      triggers disabled (session_replication_role = replica, like pg_dump --disable-triggers), identities reset.
// Plus a ledger NDJSON export (ledger_tx + entries) for independent audit.
// NOTE: pg_dump is not available on this box (only initdb/pg_ctl/postgres ship with embedded-postgres and the
// Phase B rules forbid other downloads) — see README "Backup". Phase C should ALSO run pg_dump/pg_restore.
import pg from 'pg';
import crypto from 'node:crypto';
import { Encrypter, Decrypter, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { AwsClient } from 'aws4fetch';
import { to as copyTo, from as copyFrom } from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { Readable, Writable } from 'node:stream';
import { migrate } from './migrate.mjs';
import { conn, LOCAL_ROLE_PASSWORDS } from './local-env.mjs';

export const SCHEMAS = ['auth', 'eco', 'social', 'prog', 'mod', 'audit', 'app'];
const qi = (s) => '"' + s.replace(/"/g, '""') + '"';

export async function listTables(c) {
  return (await c.query(`select n.nspname s, c.relname t from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = any($1) and c.relkind in ('r','p') and not c.relispartition order by n.nspname, c.relname`, [SCHEMAS])).rows.map((r) => `${qi(r.s)}.${qi(r.t)}`);
}
export async function rowCounts(c) {
  const out = {}; for (const t of await listTables(c)) out[t] = Number((await c.query(`select count(*) n from ${t}`)).rows[0].n); return out;
}

/** Dump: returns a Buffer (NDJSON header lines + raw COPY text sections). */
export async function dump(database) {
  const c = new pg.Client(conn('backup_ro', LOCAL_ROLE_PASSWORDS.backup_ro, database)); await c.connect();
  try { return await dumpWith(c); } finally { await c.end(); }
}
/** Dump through an already-connected client (role backup_ro).
 *  via 'copy' (default): COPY text sections. via 'json': one JSON array per table, for drivers without COPY
 *  support (the Neon serverless WebSocket driver used from the box, where TCP 5432 is unavailable). */
export async function dumpWith(c, { via = 'copy' } = {}) {
  {
    await c.query('begin isolation level repeatable read read only');      // one consistent snapshot
    const tables = await listTables(c); const parts = []; const counts = {};
    const env = (await c.query('select tag from eco.env')).rows[0]?.tag;
    const mig = (await c.query('select name, checksum from migrations.applied order by version')).rows;
    for (const t of tables) {
      if (via === 'json') {
        const data = Buffer.from(JSON.stringify((await c.query(`select coalesce(json_agg(x), '[]'::json) j from ${t} x`)).rows[0].j));
        counts[t] = JSON.parse(data.toString()).length; parts.push({ t, data }); continue;
      }
      const chunks = [];
      await pipeline(c.query(copyTo(`copy (select * from ${t}) to stdout`)), new Writable({ write(ch, _e, cb) { chunks.push(ch); cb(); } }));
      const data = Buffer.concat(chunks);
      counts[t] = data.length ? data.toString('utf8').split('\n').length - 1 : 0;
      parts.push({ t, data });
    }
    await c.query('commit');
    const header = { format: 'yoland-logical-v1', encoding: via, created_at: new Date().toISOString(), env, migrations: mig, counts,
      sections: parts.map((p) => ({ t: p.t, bytes: p.data.length, sha256: crypto.createHash('sha256').update(p.data).digest('hex') })) };
    return Buffer.concat([Buffer.from(JSON.stringify(header) + '\n'), ...parts.map((p) => p.data)]);
  }
}

export async function newKeypair() { const identity = await generateX25519Identity(); return { identity, recipient: await identityToRecipient(identity) }; }
export async function encrypt(buf, recipient) { const e = new Encrypter(); e.addRecipient(recipient); return Buffer.from(await e.encrypt(buf)); }
export async function decrypt(buf, identity) { const d = new Decrypter(); d.addIdentity(identity); return Buffer.from(await d.decrypt(buf)); }

export function s3(endpoint, bucket, accessKeyId, secretAccessKey) {
  const aws = new AwsClient({ accessKeyId, secretAccessKey, service: 's3', region: 'auto' });
  const u = (k) => `${endpoint}/${bucket}/${k.split('/').map(encodeURIComponent).join('/')}`;
  const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
  return {
    put: async (k, body) => { const r = await aws.fetch(u(k), { method: 'PUT', body, headers: { 'x-amz-content-sha256': sha(body) } }); if (!r.ok) throw new Error(`put ${r.status}`); },
    get: async (k) => { const r = await aws.fetch(u(k), { headers: { 'x-amz-content-sha256': sha(Buffer.alloc(0)) } }); if (!r.ok) throw new Error(`get ${r.status}`); return Buffer.from(await r.arrayBuffer()); },
    list: async (prefix) => { const r = await aws.fetch(`${endpoint}/${bucket}?list-type=2&prefix=${encodeURIComponent(prefix)}`, { headers: { 'x-amz-content-sha256': sha(Buffer.alloc(0)) } }); return [...(await r.text()).matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]); },
  };
}

/** Parse + integrity-check a decrypted backup (format, env, per-section sha256). */
export function parseBackup(buf, env) {
  const nl = buf.indexOf(0x0a); const header = JSON.parse(buf.subarray(0, nl).toString('utf8'));
  if (header.format !== 'yoland-logical-v1') throw new Error('unknown backup format');
  if (header.env !== env) throw new Error(`backup env ${header.env} != target env ${env}`);
  let off = nl + 1; const sections = [];
  for (const s of header.sections) {
    const data = buf.subarray(off, off + s.bytes); off += s.bytes;
    if (crypto.createHash('sha256').update(data).digest('hex') !== s.sha256) throw new Error(`corrupt section ${s.t}`);
    sections.push({ t: s.t, data });
  }
  return { header, sections };
}
/** Restore into a NEW, EMPTY database (refuses an existing one). */
export async function restore(buf, database, { env = 'local' } = {}) {
  parseBackup(buf, env);                                                  // validate before touching anything
  const admin = new pg.Client(conn(undefined, undefined, 'postgres')); await admin.connect();
  try {
    if ((await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount) throw new Error(`target database ${database} already exists (restore only into an empty one)`);
  } finally { await admin.end(); }
  await migrate({ database, reset: false, env, log: () => {} });         // schema = the same migrations (checksums compared below)
  const c = new pg.Client(conn(undefined, undefined, database)); await c.connect();
  try { return await restoreWith(c, buf, { env }); } finally { await c.end(); }
}
/** Sections sorted so that referenced tables load before referencing ones (self references are ignored). */
export async function fkOrder(c, sections) {
  const edges = (await c.query(`select quote_ident(cn.nspname)||'.'||quote_ident(cr.relname) child, quote_ident(pn.nspname)||'.'||quote_ident(pr.relname) parent
      from pg_constraint k join pg_class cr on cr.oid = k.conrelid join pg_namespace cn on cn.oid = cr.relnamespace
      join pg_class pr on pr.oid = k.confrelid join pg_namespace pn on pn.oid = pr.relnamespace where k.contype = 'f'`)).rows;
  const norm = (t) => t.replace(/"/g, '');
  const byName = new Map(sections.map((s) => [norm(s.t), s]));
  const deps = new Map(sections.map((s) => [norm(s.t), new Set()]));
  for (const e of edges) { const ch = norm(e.child), pa = norm(e.parent); if (ch !== pa && deps.has(ch) && deps.has(pa)) deps.get(ch).add(pa); }
  const out = []; const state = new Map();
  const visit = (n) => { if (state.get(n) === 2) return; if (state.get(n) === 1) throw new Error(`foreign-key cycle at ${n}`); state.set(n, 1); for (const d of deps.get(n)) visit(d); state.set(n, 2); out.push(byName.get(n)); };
  for (const n of deps.keys()) visit(n);
  return out;
}
/** Data restore through a connected owner client into a database whose schema was JUST created by the same
 *  migrations (Phase C: a scratch Neon branch / new database). */
export async function restoreWith(c, buf, { env }) {
  const { header, sections } = parseBackup(buf, env);
  try {
    const mig = (await c.query('select name, checksum from migrations.applied order by version')).rows;
    if (JSON.stringify(mig) !== JSON.stringify(header.migrations)) throw new Error('migration set differs from the backup');
    // no triggers during restore (seeded rows replaced). Superuser: session_replication_role = replica (like
    // pg_dump --disable-triggers). Managed Postgres (Neon owner, not superuser): that GUC is refused, so USER
    // triggers are disabled per table inside the transaction and tables are loaded in foreign-key order.
    const superuser = (await c.query('select rolsuper from pg_roles where rolname = current_user')).rows[0]?.rolsuper === true;
    const order = superuser ? sections : await fkOrder(c, sections);
    await c.query('begin');
    if (superuser) await c.query('set local session_replication_role = replica');
    else for (const s of sections) await c.query(`alter table ${s.t} disable trigger user`);
    await c.query(`truncate ${sections.map((s) => s.t).join(', ')}`);
    if (header.encoding === 'json') {
      for (const s of order) await c.query(`insert into ${s.t} overriding system value select * from json_populate_recordset(null::${s.t}, $1::json)`, [s.data.toString('utf8')]);
    } else {
      for (const s of order) if (s.data.length) await pipeline(Readable.from([s.data]), c.query(copyFrom(`copy ${s.t} from stdin`)));
    }
    // identity / serial sequences -> max(id)
    const seqs = (await c.query(`select n.nspname s, t.relname t, a.attname col, pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(t.relname), a.attname) seq
       from pg_attribute a join pg_class t on t.oid = a.attrelid join pg_namespace n on n.oid = t.relnamespace
       where n.nspname = any($1) and a.attnum > 0 and not a.attisdropped and pg_get_serial_sequence(quote_ident(n.nspname)||'.'||quote_ident(t.relname), a.attname) is not null`, [SCHEMAS])).rows;
    for (const r of seqs) await c.query(`select setval($1, coalesce((select max(${qi(r.col)}) from ${qi(r.s)}.${qi(r.t)}), 0) + 1, false)`, [r.seq]);
    if (!superuser) for (const s of sections) await c.query(`alter table ${s.t} enable trigger user`);
    await c.query('commit');
    return header;
  } catch (e) { await c.query('rollback').catch(() => {}); throw e; }
}

/** Ledger NDJSON export: one line per transaction with its entries (independent audit / tax trail). */
export async function ledgerNdjson(database) {
  const c = new pg.Client(conn('backup_ro', LOCAL_ROLE_PASSWORDS.backup_ro, database)); await c.connect();
  try {
    const rows = (await c.query(`select t.id, t.op_type, t.actor, t.idem_key, t.reverses, t.created_at,
        json_agg(json_build_object('wallet', e.wallet_id, 'currency', e.currency, 'amount', e.amount, 'balance_after', e.balance_after) order by e.id) entries
      from eco.ledger_tx t join eco.ledger_entries e on e.tx_id = t.id group by t.id order by t.id`)).rows;
    return rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
  } finally { await c.end(); }
}
