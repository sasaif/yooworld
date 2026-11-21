// Milestone 2 SQL functions through the real roles: saves, inventory state, activity presence lookup,
// authoritative match results, admin two-person approval with hash-chained audit.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { superPool, rolePool, newPlayer, gold, defItem, recon, key } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 5);
const admin = rolePool('admin_ops', 5);
afterAll(async () => { await Promise.all([su.end(), api.end(), admin.end()]); });
const one = async (pool: typeof su, sql: string, p: unknown[]) => (await pool.query(sql, p)).rows[0].r;

describe('server saves (app.save_put / save_load)', () => {
  it('optimistic versioning, kinds, size limit, no table access for app_api', async () => {
    const p = await newPlayer(su);
    expect(await one(api, 'select app.save_load($1,$2,$3) r', [p, 'look', 'default'])).toBeNull();
    expect(await one(api, 'select app.save_put($1,$2,$3,$4,$5,$6) r', [p, 'look', 'default', 0, '{"hair":3}', 1])).toMatchObject({ ok: true, version: 1 });
    expect(await one(api, 'select app.save_put($1,$2,$3,$4,$5,$6) r', [p, 'look', 'default', 1, '{"hair":4}', 1])).toMatchObject({ version: 2 });
    await expect(api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [p, 'look', 'default', 1, '{"hair":5}', 1])).rejects.toMatchObject({ hint: 'version_conflict' });
    expect(await one(api, 'select app.save_load($1,$2,$3) r', [p, 'look', 'default'])).toMatchObject({ version: 2, data: { hair: 4 } });
    await expect(api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [p, 'wallet', 'default', 0, '{}', 1])).rejects.toMatchObject({ hint: 'bad_kind' });
    await expect(api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [p, 'prefs', 'default', 0, '[1]', 1])).rejects.toMatchObject({ hint: 'bad_data' });
    const big = JSON.stringify({ x: 'a'.repeat(70_000) });
    await expect(api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [p, 'apartment', 'default', 0, big, 1])).rejects.toMatchObject({ hint: 'too_large' });
    await expect(api.query('select * from app.saves')).rejects.toMatchObject({ code: '42501' });
    await expect(api.query(`update app.saves set version = 99`)).rejects.toMatchObject({ code: '42501' });
  });
});

describe('inventory equip/place (eco.item_set_state)', () => {
  it('owner can equip/place/unequip; others cannot; revoked items cannot change', async () => {
    const a = await newPlayer(su), b = await newPlayer(su);
    const def = await defItem(su, { gold: 10 });
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 100]);
    const buy = await one(api, 'select eco.shop_buy($1,$2,$3,$4) r', [key(), a, def, 'GOLD']);
    const item = buy.item;
    expect(await one(api, 'select eco.item_set_state($1,$2,$3) r', [a, item, 'equipped'])).toMatchObject({ ok: true, state: 'equipped' });
    expect(await one(api, 'select eco.item_set_state($1,$2,$3) r', [a, item, 'placed'])).toMatchObject({ state: 'placed' });
    expect(await one(api, 'select eco.item_set_state($1,$2,$3) r', [a, item, 'owned'])).toMatchObject({ state: 'owned' });
    await expect(api.query('select eco.item_set_state($1,$2,$3)', [b, item, 'equipped'])).rejects.toMatchObject({ hint: 'not_owner' });
    await expect(api.query('select eco.item_set_state($1,$2,$3)', [a, item, 'trade_locked'])).rejects.toBeTruthy();
    await su.query(`update eco.item_instances set state='revoked' where id=$1`, [item]);
    await expect(api.query('select eco.item_set_state($1,$2,$3)', [a, item, 'equipped'])).rejects.toMatchObject({ hint: 'item_state' });
    expect(Object.values(await recon(su)).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
  });
});

describe('activity room lookup + farm reward definition', () => {
  it('farm is defined from pending-approval config; activity_room returns the room only to its owner', async () => {
    const rr = (await su.query(`select gold, approved_by from eco.reward_rules where id='farm_task'`)).rows[0];
    expect(rr).toEqual({ gold: 15, approved_by: 'pending_approval' });
    const p = await newPlayer(su), o = await newPlayer(su);
    const s = await one(api, 'select eco.activity_start($1,$2,$3,$4) r', [key(), p, 'farm', 'local:farm:1']);
    expect(await one(api, 'select eco.activity_room($1,$2) r', [p, s.session])).toBe('local:farm:1');
    expect(await one(api, 'select eco.activity_room($1,$2) r', [o, s.session])).toBeNull();
    await expect(api.query('select eco.activity_complete_task($1,$2,$3)', [key(), p, s.session])).rejects.toMatchObject({ hint: 'too_fast' });
    await su.query(`update eco.activity_sessions set started_at = now() - interval '46 seconds' where id=$1`, [s.session]);
    expect(await one(api, 'select eco.activity_complete_task($1,$2,$3) r', [key(), p, s.session])).toMatchObject({ ok: true, gold: 15 });
    expect(await gold(su, p)).toBe(15);
  });
});

describe('prog.record_match (authoritative result storage)', () => {
  it('idempotent per table, conflicting result refused, winners must be players, append-only', async () => {
    const a = await newPlayer(su), b = await newPlayer(su), t = randomUUID();
    const args = (w: string[], h: string) => [t, 'dominoes', [a, b], w, [10, 0], 12, h];
    expect(await one(api, 'select prog.record_match($1,$2,$3,$4,$5,$6,$7) r', args([a], 'h1'))).toMatchObject({ ok: true });
    expect(await one(api, 'select prog.record_match($1,$2,$3,$4,$5,$6,$7) r', args([a], 'h1'))).toMatchObject({ replayed: true });
    await expect(api.query('select prog.record_match($1,$2,$3,$4,$5,$6,$7)', args([b], 'h2'))).rejects.toMatchObject({ hint: 'result_conflict' });
    await expect(api.query('select prog.record_match($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'dominoes', [a, b], [randomUUID()], [1, 0], 3, 'x'])).rejects.toMatchObject({ code: '23514' });
    await expect(su.query('update prog.match_results set winners = $2 where table_id = $1', [t, [b]])).rejects.toMatchObject({ hint: 'append_only' });
    await expect(api.query('insert into prog.match_results values ($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), 'dominoes', [a, b], [b], [0, 1], 1, 'f'])).rejects.toMatchObject({ code: '42501' });
    const ev = (await su.query(`select count(*)::int n from prog.player_events where type_id='dominoes_result' and payload->>'table'=$1`, [t])).rows[0].n;
    expect(ev).toBe(2);
  });
});

describe('admin_adjust: 2FA + second admin + hash-chained audit', () => {
  async function adminUser(twoFa: boolean, listed = true) {
    const id = randomUUID();
    await su.query(`insert into auth."user"(id, name, email, "emailVerified", "twoFactorEnabled") values ($1,'adm',$2,true,$3)`, [id, `${id}@local.test`, twoFa]);
    if (listed) await su.query(`insert into audit.admins(user_id, added_by) values ($1,'test')`, [id]);
    return id;
  }
  it('requester cannot approve; non-admin and no-2FA refused; approval moves TEST Gold and chains audit', async () => {
    const a1 = await adminUser(true), a2 = await adminUser(true), no2fa = await adminUser(false), outsider = await adminUser(true, false);
    const p = await newPlayer(su);
    const payload = JSON.stringify({ player: p, base: 'GOLD', amount: 500 });
    await expect(admin.query('select audit.admin_request($1,$2,$3,$4)', [no2fa, 'admin_adjust', payload, 'support ticket 42 refund'])).rejects.toMatchObject({ hint: 'admin_2fa' });
    await expect(admin.query('select audit.admin_request($1,$2,$3,$4)', [outsider, 'admin_adjust', payload, 'support ticket 42 refund'])).rejects.toMatchObject({ hint: 'not_admin' });
    await expect(admin.query('select audit.admin_request($1,$2,$3,$4)', [a1, 'admin_adjust', payload, 'short'])).rejects.toMatchObject({ hint: 'reason' });
    const r = await one(admin, 'select audit.admin_request($1,$2,$3,$4) r', [a1, 'admin_adjust', payload, 'support ticket 42 refund']);
    await expect(admin.query('select audit.admin_approve($1,$2)', [a1, r.request])).rejects.toMatchObject({ hint: 'same_admin' });
    await expect(admin.query('select audit.admin_approve($1,$2)', [no2fa, r.request])).rejects.toMatchObject({ hint: 'admin_2fa' });
    expect(await gold(su, p)).toBe(0);
    expect(await one(admin, 'select audit.admin_approve($1,$2) r', [a2, r.request])).toMatchObject({ ok: true, amount: 500, currency: 'GOLD_TEST' });
    expect(await gold(su, p)).toBe(500);
    await expect(admin.query('select audit.admin_approve($1,$2)', [a2, r.request])).rejects.toMatchObject({ hint: 'already_approved' });
    const neg = await one(admin, 'select audit.admin_request($1,$2,$3,$4) r', [a2, 'admin_adjust', JSON.stringify({ player: p, base: 'GOLD', amount: -200 }), 'duplicate reward clawback']);
    await one(admin, 'select audit.admin_approve($1,$2) r', [a1, neg.request]);
    expect(await gold(su, p)).toBe(300);
    // roles: app_api cannot call admin functions; admin_ops cannot touch tables directly
    await expect(api.query('select audit.admin_request($1,$2,$3,$4)', [a1, 'admin_adjust', payload, 'support ticket 42 refund'])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query('update audit.admin_approvals set approved_by = $1', [a1])).rejects.toMatchObject({ code: '42501' });
    await expect(admin.query('insert into audit.admins values ($1, now(), $2)', [outsider, 'self'])).rejects.toMatchObject({ code: '42501' });
    const chain = (await su.query('select audit.verify_chain() r')).rows[0].r;
    expect(chain.broken).toBe(0);
    const log = (await su.query(`select action from audit.log where target = $1 order by id`, [p])).rows.map((x) => x.action);
    expect(log).toEqual(['admin_request', 'admin_adjust', 'admin_request', 'admin_adjust']);
  });
  it('tampering with an audit row is impossible (append-only) and an edited payload is detected', async () => {
    await expect(su.query(`update audit.log set reason = 'x' where id = (select max(id) from audit.log)`)).rejects.toMatchObject({ hint: 'append_only' });
  });
});
