// Policy (a): 30-day grace, restore during grace, finalisation (ledger sweep to the system wallet, items to the SYSTEM
// player, personal data erased), reconciliation 0, audit chain intact, idempotent / retry-safe.
import { describe, it, expect, afterAll } from 'vitest';
import { superPool, rolePool, newPlayer, gold, diamonds, defItem, recon, key } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 5);
afterAll(async () => { await Promise.all([su.end(), api.end()]); });
const one = async (sql: string, p: unknown[] = []) => (await api.query(sql, p)).rows[0].r;
const SYSTEM = '00000000-0000-0000-0000-000000000000';
const due = (p: string, sqlInterval: string) => su.query(`update eco.players set deletion_due_at = now() ${sqlInterval} where id = $1`, [p]);
const clean = async () => Object.entries(await recon(su)).filter(([, v]) => Number(v) !== 0);
const chain = async () => (await su.query('select audit.verify_chain() r')).rows[0].r;

describe('account deletion, policy (a)', () => {
  it('config: grace 30 days (approved), items to system', async () => {
    const rows = (await su.query(`select key, value::int v, status from eco.config where key like 'account.%' order by key`)).rows;
    expect(rows).toEqual([{ key: 'account.delete_grace_days', v: 30, status: 'approved' }, { key: 'account.sweep_items_to_system', v: 1, status: 'approved' }]);
  });
  it('restore during grace: account active again, saves and items intact, sanctions freeze preserved', async () => {
    const a = await newPlayer(su);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 100]);
    await one('select app.save_put($1,$2,$3,$4,$5,$6) r', [a, 'look', 'default', 0, '{"hair":2}', 1]);
    const req = await one('select eco.close_account($1,$2) r', [key('close'), a]);
    const dueAt = new Date(req.deletion_due_at).getTime();
    expect(Math.round((dueAt - Date.now()) / 86_400_000)).toBe(30);
    expect(await one('select eco.ensure_player($1) r', [a])).toMatchObject({ state: 'pending_deletion' });
    await expect(api.query('select app.save_put($1,$2,$3,$4,$5,$6)', [a, 'look', 'default', 1, '{}', 1])).rejects.toMatchObject({ hint: 'account_closed' });
    expect(await one('select eco.restore_account($1,$2) r', [key('restore'), a])).toMatchObject({ ok: true, restored: true });
    expect(await one('select eco.ensure_player($1) r', [a])).toMatchObject({ state: 'active', deletion_due_at: null });
    expect(await gold(su, a)).toBe(100);
    expect(Number((await su.query('select count(*) n from app.saves where player_id = $1', [a])).rows[0].n)).toBe(1);
    expect(await one('select eco.gift_gold($1,$2,$3,5) r', [key(), a, await newPlayer(su)])).toMatchObject({ ok: true });   // economy back
    // sanctions: a player frozen by moderation stays frozen after restore
    const f = await newPlayer(su); await su.query('update eco.players set trade_frozen = true where id = $1', [f]);
    await one('select eco.close_account($1,$2) r', [key('close'), f]); await one('select eco.restore_account($1,$2) r', [key('restore'), f]);
    expect((await su.query('select trade_frozen from eco.players where id = $1', [f])).rows[0].trade_frozen).toBe(true);
    // after the grace period: restore refused
    const g = await newPlayer(su); await one('select eco.close_account($1,$2) r', [key('close'), g]); await due(g, "- interval '1 second'");
    await expect(api.query('select eco.restore_account($1,$2)', [key('restore'), g])).rejects.toMatchObject({ hint: 'grace_expired' });
    expect(await clean()).toEqual([]);
  });
  it('expiry: balances swept by ledger tx, items to SYSTEM with provenance, personal data erased, recon 0, audit chain intact', async () => {
    const a = await newPlayer(su), b = await newPlayer(su);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 300]);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'DIAMOND', 40]);
    const def = await defItem(su, { gold: 50 });
    const item = (await one('select eco.shop_buy($1,$2,$3,$4) r', [key(), a, def, 'GOLD'])).item;
    await one('select eco.item_set_state($1,$2,$3) r', [a, item, 'placed']);
    await one('select app.save_put($1,$2,$3,$4,$5,$6) r', [a, 'profile', 'default', 0, '{"bio":"private"}', 1]);
    await su.query('insert into mod.blocks(player_id, blocked_id) values ($1,$2)', [b, a]);
    const sink0 = Number((await su.query(`select coalesce(sum(balance),0) s from eco.wallets where purpose='sink:account_closed' and currency='GOLD_TEST'`)).rows[0].s);
    const ledger0 = Number((await su.query('select count(*) n from eco.ledger_entries')).rows[0].n);
    await one('select eco.close_account($1,$2) r', [key('close'), a]);
    expect((await one('select eco.finalize_deletions(50) r')).finalized).not.toContain(a);            // not due yet
    await due(a, "- interval '1 minute'");
    const t0 = performance.now();
    const fin = await one('select eco.finalize_deletions(50) r');
    const ms = performance.now() - t0;
    expect(fin.finalized).toContain(a); expect(fin.failed).toEqual([]);
    expect(await gold(su, a)).toBe(0); expect(await diamonds(su, a)).toBe(0);
    const sink1 = Number((await su.query(`select coalesce(sum(balance),0) s from eco.wallets where purpose='sink:account_closed' and currency='GOLD_TEST'`)).rows[0].s);
    expect(sink1 - sink0).toBe(250);
    expect(Number((await su.query('select count(*) n from eco.ledger_entries')).rows[0].n)).toBe(ledger0 + 4);   // 2 currencies x 2 legs, nothing removed
    const it = (await su.query('select owner_id, state from eco.item_instances where id = $1', [item])).rows[0];
    expect(it).toEqual({ owner_id: SYSTEM, state: 'owned' });
    const mv = (await su.query('select from_id, to_id, reason from eco.item_moves where item_id = $1 order by id desc limit 1', [item])).rows[0];
    expect(mv).toEqual({ from_id: a, to_id: SYSTEM, reason: 'account_deleted' });
    for (const t of ['app.saves', 'prog.privacy_settings']) expect(Number((await su.query(`select count(*) n from ${t} where player_id = $1`, [a])).rows[0].n)).toBe(0);
    expect(Number((await su.query('select count(*) n from mod.blocks where blocked_id = $1', [a])).rows[0].n)).toBe(0);
    expect((await su.query(`select count(*)::int n from audit.log where action = 'account_finalized' and target = $1`, [a])).rows[0].n).toBe(1);
    expect(await one('select eco.ensure_player($1) r', [a])).toMatchObject({ state: 'deleted' });
    await expect(api.query('select eco.restore_account($1,$2)', [key('restore'), a])).rejects.toMatchObject({ hint: 'account_deleted' });
    expect((await one('select eco.finalize_deletions(50) r')).finalized).not.toContain(a);            // idempotent: nothing twice
    // auth erasure bookkeeping
    expect(await one('select eco.pending_auth_erasure(500) r')).toContain(a);
    expect(await one('select eco.mark_auth_erased($1) r', [a])).toEqual({ ok: true, marked: true });
    expect(await one('select eco.mark_auth_erased($1) r', [a])).toEqual({ ok: true, marked: false });
    expect(await one('select eco.pending_auth_erasure(500) r')).not.toContain(a);
    expect(await clean()).toEqual([]);
    expect(await chain()).toMatchObject({ broken: 0 });
    // the SYSTEM player cannot be targeted by any economy call
    await expect(api.query('select eco.gift_gold($1,$2,$3,5)', [key(), b, SYSTEM])).rejects.toBeTruthy();
    console.log('[MESURÉ] finalize one account (2 currencies, 1 item):', Math.round(ms), 'ms');
  });
  it('items revoked in place when account.sweep_items_to_system = 0', async () => {
    await su.query(`update eco.config set value = 0 where key = 'account.sweep_items_to_system'`);
    try {
      const a = await newPlayer(su); await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 60]);
      const item = (await one('select eco.shop_buy($1,$2,$3,$4) r', [key(), a, await defItem(su, { gold: 10 }), 'GOLD'])).item;
      await one('select eco.close_account($1,$2) r', [key('close'), a]); await due(a, "- interval '1 minute'");
      const fin = await one('select eco.finalize_deletions(50) r'); expect(fin.finalized).toContain(a);
      expect((await su.query('select owner_id, state from eco.item_instances where id = $1', [item])).rows[0]).toEqual({ owner_id: a, state: 'revoked' });
      expect(await clean()).toEqual([]);
    } finally { await su.query(`update eco.config set value = 1 where key = 'account.sweep_items_to_system'`); }
  });
  it('batch of 50 due accounts finalised in one run', async () => {
    const ps: string[] = [];
    for (let i = 0; i < 50; i++) { const p = await newPlayer(su); await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), p, 'GOLD', 10]); await one('select eco.close_account($1,$2) r', [key('c'), p]); await due(p, "- interval '1 minute'"); ps.push(p); }
    const t0 = performance.now(); const fin = await one('select eco.finalize_deletions(50) r'); const ms = performance.now() - t0;
    expect(fin.finalized.length).toBe(50); expect(fin.failed).toEqual([]);
    expect(await clean()).toEqual([]); expect(await chain()).toMatchObject({ broken: 0 });
    console.log('[MESURÉ] finalize batch of 50 accounts:', Math.round(ms), 'ms');
  });
});
