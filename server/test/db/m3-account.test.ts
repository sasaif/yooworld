// Milestone 3: account closure (close + anonymise, ledger untouched) and personal-data export through app_api.
import { describe, it, expect, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { superPool, rolePool, newPlayer, gold, defItem, recon, key } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 5);
afterAll(async () => { await Promise.all([su.end(), api.end()]); });
const one = async (sql: string, p: unknown[]) => (await api.query(sql, p)).rows[0].r;

describe('eco.close_account', () => {
  it('deletion request: cancels open trades, freezes balance and items, keeps saves (grace), blocks every later economy call, idempotent', async () => {
    const a = await newPlayer(su), b = await newPlayer(su);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 200]);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), b, 'GOLD', 200]);
    const def = await defItem(su, { gold: 20 });
    const item = (await one('select eco.shop_buy($1,$2,$3,$4) r', [key(), a, def, 'GOLD'])).item;
    const trade = randomUUID();
    await one('select eco.trade_lock($1,$2,$3,$4,$5,1,$6,$7) r', [key(), trade, b, a, b, 'h', JSON.stringify([{ side: 'a', item }, { side: 'b', gold: 30 }])]);
    await one('select app.save_put($1,$2,$3,$4,$5,$6) r', [a, 'profile', 'default', 0, '{"bio":"hello"}', 1]);
    const ledger0 = Number((await su.query('select count(*) n from eco.ledger_entries')).rows[0].n);
    const k = key('close');
    const r = await one('select eco.close_account($1,$2) r', [k, a]);
    expect(r).toMatchObject({ ok: true, closed: true, trades_cancelled: 1, items_frozen: 1, balances_frozen: { gold: 180 }, grace_days: 30 });
    expect(await one('select eco.close_account($1,$2) r', [k, a])).toMatchObject({ replayed: true });   // idempotent replay
    expect(await one('select eco.close_account($1,$2) r', [key('close'), a])).toMatchObject({ already_closed: true });
    expect(Number((await su.query('select count(*) n from eco.ledger_entries')).rows[0].n)).toBe(ledger0 + 2);
    expect(await gold(su, b)).toBe(200); expect(await gold(su, b, 'escrow')).toBe(0);
    expect(await gold(su, a)).toBe(180);                                                      // frozen, not swept
    expect((await su.query('select owner_id, state from eco.item_instances where id = $1', [item])).rows[0]).toMatchObject({ owner_id: a, state: 'owned' });
    await expect(api.query('select eco.gift_gold($1,$2,$3,5)', [key(), b, a])).rejects.toMatchObject({ hint: 'account_closed' });
    await expect(api.query('select eco.claim_daily($1,$2)', [key(), a])).rejects.toBeTruthy();
    await expect(api.query('select eco.test_grant_gold($1,$2,10)', [key(), a])).rejects.toBeTruthy();
    expect(Number((await su.query('select count(*) n from app.saves where player_id = $1', [a])).rows[0].n)).toBe(1);   // M4: kept during grace (restorable)
    expect((await su.query(`select count(*) n from audit.log where action = 'account_deletion_requested' and target = $1`, [a])).rows[0].n).toBe(1);
    expect(Object.values(await recon(su)).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
    await expect(api.query('delete from eco.ledger_entries')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('eco.export_player', () => {
  it('returns only the player\'s own rows, without idempotency keys or moderator ids', async () => {
    const a = await newPlayer(su), b = await newPlayer(su);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), a, 'GOLD', 100]);
    await su.query('select eco.dev_grant($1,$2,$3,$4)', [key(), b, 'GOLD', 100]);
    await one('select eco.gift_gold($1,$2,$3,$4) r', [key(), a, b, 10]);
    await one('select app.save_put($1,$2,$3,$4,$5,$6) r', [b, 'look', 'default', 0, '{"secret_of_b":1}', 1]);
    const ex = await one('select eco.export_player($1) r', [a]);
    expect(ex.format).toBe('yoland-export/1');
    expect(ex.data.player.id).toBe(a);
    expect(ex.data.wallets.find((w: any) => w.purpose === 'main').balance).toBe(90);
    expect(ex.data.gifts).toHaveLength(1);
    expect(ex.data.ledger.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(ex)).not.toContain('secret_of_b');
    expect(JSON.stringify(ex)).not.toContain('idem_key');
    await expect(api.query('select eco.export_player($1)', [randomUUID()])).rejects.toMatchObject({ hint: 'unknown_player' });
  });
});
