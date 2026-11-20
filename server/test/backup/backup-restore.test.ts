// Real restore test: workload -> logical dump -> age encryption -> local S3 (SigV4) -> download -> decrypt ->
// restore into an EMPTY database -> reconciliation 0, identical row counts, identical ledger NDJSON, audit chain intact.
import { describe, it, expect, afterAll } from 'vitest';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// @ts-expect-error plain .mjs helper
import { dump, restore, encrypt, decrypt, newKeypair, s3, rowCounts, ledgerNdjson } from '../../scripts/backup.mjs';
// @ts-expect-error plain .mjs helper
import { startS3Local } from '../../scripts/s3-local.mjs';
// @ts-expect-error plain .mjs helper
import { migrate } from '../../scripts/migrate.mjs';
// @ts-expect-error plain .mjs helper
import { conn, LOCAL_ROLE_PASSWORDS, SERVER_DIR } from '../../scripts/local-env.mjs';

const SRC = 'yoland_bk_src', DST = 'yoland_bk_dst';
const pools: pg.Pool[] = [];
const pool = (db: string, role?: string) => { const p = new pg.Pool({ ...conn(role, role ? (LOCAL_ROLE_PASSWORDS as any)[role] : undefined, db), max: 5 }); pools.push(p); return p; };
afterAll(async () => { await Promise.all(pools.map((p) => p.end())); });
const k = () => `bk-${crypto.randomUUID()}`;

async function workload(db: string, players = 60) {
  const su = pool(db), api = pool(db, 'app_api'), adm = pool(db, 'admin_ops');
  const ids: string[] = [];
  for (let i = 0; i < players; i++) {
    const id = crypto.randomUUID(); ids.push(id);
    await su.query(`insert into auth."user"(id, name, email, "emailVerified", "twoFactorEnabled") values ($1,'p',$2,true,$3)`, [id, `${id}@bk.local`, i < 2]);
    await su.query(`insert into eco.players(id, created_at) values ($1, now() - interval '30 days')`, [id]);
    await api.query('select eco.test_grant_gold($1,$2,$3)', [k(), id, 1000 + i]);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [k(), id, 'DIAMOND', 50]);
    await api.query('select eco.claim_daily($1,$2)', [k(), id]);
  }
  await su.query(`insert into eco.item_definitions(id, kind, price_gold, price_diamond) values ('bk_sofa','furniture',100,10)`);
  const items: string[] = [];
  for (let i = 0; i < players; i++) items.push((await api.query('select eco.shop_buy($1,$2,$3,$4) r', [k(), ids[i], 'bk_sofa', i % 2 ? 'GOLD' : 'DIAMOND'])).rows[0].r.item);
  for (let i = 0; i < players - 1; i++) await api.query('select eco.gift_gold($1,$2,$3,$4)', [k(), ids[i], ids[i + 1], 10]);
  for (let i = 0; i < 10; i++) await api.query('select eco.gift_item($1,$2,$3,$4)', [k(), ids[i], ids[i + 20], items[i]]);
  await su.query(`insert into audit.admins(user_id, added_by) values ($1,'bk'),($2,'bk')`, [ids[0], ids[1]]);
  const r = (await adm.query('select audit.admin_request($1,$2,$3,$4) r', [ids[0], 'admin_adjust', JSON.stringify({ player: ids[5], base: 'GOLD', amount: 77 }), 'backup test adjust'])).rows[0].r;
  await adm.query('select audit.admin_approve($1,$2)', [ids[1], r.request]);
  await api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [ids[3], 'look', 'default', 0, '{"hair":1}', 1]);
  return ids;
}

describe('backup -> encrypted S3 object -> restore into an empty database', () => {
  it('restores byte-identical data: reconciliation 0, equal row counts, equal ledger NDJSON, audit chain intact', async () => {
    const t: Record<string, number> = {}; const lap = (name: string, t0: number) => { t[name] = Math.round(performance.now() - t0); };
    await migrate({ database: SRC, reset: true, env: 'local', log: () => {} });
    const admin = pool('postgres');
    await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1`, [DST]);
    await admin.query(`drop database if exists ${DST}`);
    let t0 = performance.now(); await workload(SRC); lap('workload_ms', t0);

    const { identity, recipient } = await newKeypair();
    const secretKey = crypto.randomBytes(24).toString('hex');
    const st = await startS3Local({ dir: path.join(SERVER_DIR, '.local', 's3'), accessKeyId: 'local-backup-key', secretAccessKey: secretKey });
    try {
      const b = s3(st.endpoint, 'yoland-backups-local', 'local-backup-key', secretKey);
      await expect(s3(st.endpoint, 'yoland-backups-local', 'local-backup-key', 'wrong-secret').put('x', Buffer.from('x'))).rejects.toThrow(/403/);
      t0 = performance.now(); const plain = await dump(SRC); lap('dump_ms', t0);
      t0 = performance.now(); const enc = await encrypt(plain, recipient); lap('encrypt_ms', t0);
      expect(enc.subarray(0, 21).toString()).toBe('age-encryption.org/v1');
      expect(plain.includes(Buffer.from('GOLD_TEST'))).toBe(true); expect(enc.includes(Buffer.from('GOLD_TEST'))).toBe(false);   // nothing readable in the stored object
      const key = `local/${new Date().toISOString().slice(0, 10)}/yoland-${Date.now()}.dump.age`;
      t0 = performance.now(); await b.put(key, enc); lap('upload_ms', t0);
      const ndjson = await ledgerNdjson(SRC);
      await b.put(key.replace('.dump.age', '.ledger.ndjson.age'), await encrypt(Buffer.from(ndjson), recipient));
      expect(await b.list('local/')).toContain(key);
      t0 = performance.now(); const got = await b.get(key); lap('download_ms', t0);
      await expect(decrypt(got, (await newKeypair()).identity)).rejects.toThrow();     // another key cannot read it
      t0 = performance.now(); const dec = await decrypt(got, identity); lap('decrypt_ms', t0);
      expect(dec.equals(plain)).toBe(true);
      await expect(restore(dec, SRC)).rejects.toThrow(/already exists/);               // never restores over a live DB
      t0 = performance.now(); await restore(dec, DST); lap('restore_ms', t0);

      const s = pool(SRC), d = pool(DST);
      const counts = async (pl: pg.Pool) => { const c = await pl.connect(); try { return await rowCounts(c); } finally { c.release(); } };
      const [cs, cd] = [await counts(s), await counts(d)];
      expect(cd).toEqual(cs);
      expect(Object.values(cs).reduce((a: number, b) => a + (b as number), 0)).toBeGreaterThan(1000);
      const recon = (await d.query('select eco.recon_summary() r')).rows[0].r;
      expect(Object.values(recon).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
      expect((await d.query('select audit.verify_chain() r')).rows[0].r).toMatchObject({ broken: 0 });
      expect(await ledgerNdjson(DST)).toBe(ndjson);
      // the restored DB keeps working (identities reset, triggers active again)
      const p = (await d.query('select id from eco.players limit 1')).rows[0].id;
      const api = pool(DST, 'app_api');
      expect((await api.query('select eco.test_grant_gold($1,$2,$3) r', [k(), p, 5])).rows[0].r).toMatchObject({ ok: true });
      await expect(d.query('update eco.ledger_entries set amount = 0')).rejects.toMatchObject({ hint: 'append_only' });
      const out = { timings_ms: t, bytes: { plain: plain.length, encrypted: enc.length, ledger_ndjson: ndjson.length }, tables: Object.keys(cs).length,
        rows_total: Object.values(cs).reduce((a: number, b) => a + (b as number), 0), ledger_tx: ndjson.split('\n').length - 1, s3: st.stats, recon };
      fs.mkdirSync(path.join(SERVER_DIR, 'test-results'), { recursive: true });
      fs.writeFileSync(path.join(SERVER_DIR, 'test-results/backup-restore.json'), JSON.stringify(out, null, 2));
    } finally { await st.close(); }
  });
});
