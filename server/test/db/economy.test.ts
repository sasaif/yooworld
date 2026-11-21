// Functional tests of the EconomyGate through the TypeScript gate (app_api role, like the Worker).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createEconomyGate } from '../../src/core/economy';
import { superPool, rolePool, newPlayer, makeVip, gold, diamonds, setCfg, defItem, recon, key } from '../helpers/db';

const su = superPool();
const api = rolePool('app_api', 10);
const gate = createEconomyGate(api);
const dev = (p: string, base: 'GOLD' | 'DIAMOND', n: number) => su.query('select eco.dev_grant($1,$2,$3,$4)', [key('dev'), p, base, n]);
const backdate = (sql: string, params: unknown[]) => su.query(sql, params);
afterAll(async () => { await Promise.all([su.end(), api.end()]); });

describe('player + TEST Gold', () => {
  it('ensure_player is idempotent; test grant credits GOLD_TEST only', async () => {
    const p = randomUUID();
    expect(await gate.ensurePlayer(p)).toMatchObject({ ok: true });
    expect(await gate.ensurePlayer(p)).toMatchObject({ ok: true });
    const r = await gate.testGrantGold(p, 1000, key());
    expect(r).toMatchObject({ ok: true, currency: 'GOLD_TEST', amount: 1000 });
    expect(await gate.balances(p)).toMatchObject({ gold: 1000, diamond: 0, test: true });
    const real = (await su.query(`select count(*) n from eco.wallets where currency in ('GOLD','DIAMOND')`)).rows[0].n;
    expect(real).toBe(0);
  });
  it('a real-currency wallet cannot exist in a non-prod database', async () => {
    const p = await newPlayer(su);
    await expect(su.query(`insert into eco.wallets(owner_kind, player_id, currency, purpose) values ('player',$1,'GOLD','main')`, [p]))
      .rejects.toMatchObject({ hint: 'env_currency' });
  });
  it('rejects bad amounts and bad keys', async () => {
    const p = await newPlayer(su);
    expect(await gate.testGrantGold(p, 0, key())).toMatchObject({ ok: false, code: 'amount' });
    expect(await gate.testGrantGold(p, 10_000_000, key())).toMatchObject({ ok: false, code: 'amount' });
    expect(await gate.testGrantGold(p, 10, 'short')).toMatchObject({ ok: false, code: 'bad_key' });
    expect(await gate.testGrantGold(randomUUID(), 10, key())).toMatchObject({ ok: false, code: 'unknown_player' });
  });
});

describe('shop_buy', () => {
  it('Gold purchase debits the price into the shop sink and creates an owned, tradable item with provenance', async () => {
    const p = await newPlayer(su); await gate.testGrantGold(p, 250, key());
    const def = await defItem(su, { gold: 100 });
    const r: any = await gate.shopBuy(p, def, 'GOLD', key());
    expect(r).toMatchObject({ ok: true, price: 100, tradable: true, hold_until: null });
    expect(await gold(su, p)).toBe(150);
    const mv = (await su.query('select reason, from_id, to_id from eco.item_moves where item_id=$1', [r.item])).rows;
    expect(mv).toEqual([{ reason: 'shop', from_id: null, to_id: p }]);
  });
  it('owner rule: Diamond purchase is TRADABLE immediately (hold default 0), records a purchase event with account age', async () => {
    const p = await newPlayer(su, 30); const q = await newPlayer(su); await dev(p, 'DIAMOND', 50);
    const def = await defItem(su, { diamond: 10 });
    const r: any = await gate.shopBuy(p, def, 'DIAMOND', key());
    expect(r).toMatchObject({ ok: true, tradable: true, currency: 'DIAMOND_TEST', hold_until: null });
    expect(await diamonds(su, p)).toBe(40);
    const ev = (await su.query('select kind, currency, amount, item_def, account_age_days from eco.purchase_events where item_id = $1', [r.item])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'shop', currency: 'DIAMOND_TEST', amount: 10, item_def: def });
    expect(Number(ev[0].account_age_days)).toBeGreaterThan(29.99); expect(Number(ev[0].account_age_days)).toBeLessThan(30.01);
    expect(Number((await api.query('select eco.account_age_days($1) r', [p])).rows[0].r)).toBeCloseTo(30, 1);
    await expect(api.query('select * from eco.purchase_events')).rejects.toMatchObject({ code: '42501' });
    await expect(su.query('update eco.purchase_events set amount = 1 where item_id = $1', [r.item])).rejects.toMatchObject({ hint: 'append_only' });
    expect(await gate.giftItem(p, q, r.item, key())).toMatchObject({ ok: true });            // tradable immediately
    const nt = await defItem(su, { diamond: 10, tradable: false });
    const r2: any = await gate.shopBuy(p, nt, 'DIAMOND', key());
    expect(r2.tradable).toBe(false);
    expect(await gate.giftItem(p, q, r2.item, key())).toMatchObject({ ok: false, code: 'not_tradable' });
  });
  it('the hold mechanism is kept: with item.diamond_hold_days > 0 the item gets a hold', async () => {
    const p = await newPlayer(su); await dev(p, 'DIAMOND', 50);
    await setCfg(su, 'item.diamond_hold_days', 14);
    try {
      const def = await defItem(su, { diamond: 10 });
      const r: any = await gate.shopBuy(p, def, 'DIAMOND', key());
      const days = (new Date(r.hold_until).getTime() - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(13.9); expect(days).toBeLessThan(14.1);
    } finally { await setCfg(su, 'item.diamond_hold_days', 0); }
  });
  it('refuses unknown / unpriced items, wrong currency and insufficient funds', async () => {
    const p = await newPlayer(su); await gate.testGrantGold(p, 50, key());
    const def = await defItem(su, { gold: 100, diamond: null });
    expect(await gate.shopBuy(p, 'nope', 'GOLD', key())).toMatchObject({ code: 'not_for_sale' });
    expect(await gate.shopBuy(p, def, 'DIAMOND', key())).toMatchObject({ code: 'not_for_sale' });
    expect(await gate.shopBuy(p, def, 'GOLD_TEST' as any, key())).toMatchObject({ code: 'bad_currency' });
    expect(await gate.shopBuy(p, def, 'GOLD', key())).toMatchObject({ code: 'insufficient' });
    expect(await gold(su, p)).toBe(50);
  });
});

describe('Diamonds are never transferable between players', () => {
  it('there is no gift/trade path for Diamonds, and a forged tx moving Diamonds between players is refused at COMMIT', async () => {
    const a = await newPlayer(su); const b = await newPlayer(su); await dev(a, 'DIAMOND', 100);
    const lines = [{ side: 'a', item: randomUUID() }, { side: 'a', diamond: 10 }];
    expect(await gate.tradeLock(randomUUID(), a, { a, b, version: 1, hash: 'h', lines: lines as any }, key())).toMatchObject({ code: 'bad_lines' });
    const c = await su.connect();
    try {
      await c.query('begin'); await c.query('set local role eco_owner');
      await c.query(`insert into eco.idempotency(key, client_key, op, request_hash) values ('forge:1','forge:1','x','x')`);
      const tx = (await c.query(`insert into eco.ledger_tx(op_type, idem_key, actor) values ('admin_adjust','forge:1','attacker') returning id`)).rows[0].id;
      await c.query(`select eco._move($1, eco._wallet($2,'DIAMOND_TEST'), eco._wallet($3,'DIAMOND_TEST'), 'DIAMOND_TEST', 10)`, [tx, a, b]);
      await expect(c.query('commit')).rejects.toMatchObject({ hint: 'diamond_transfer' });
    } finally { c.release(); }
    expect(await diamonds(su, a)).toBe(100); expect(await diamonds(su, b)).toBe(0);
  });
  it('an unbalanced forged tx is refused at COMMIT', async () => {
    const a = await newPlayer(su);
    const c = await su.connect();
    try {
      await c.query('begin'); await c.query('set local role eco_owner');
      await c.query(`insert into eco.idempotency(key, client_key, op, request_hash) values ('forge:2','forge:2','x','x')`);
      const tx = (await c.query(`insert into eco.ledger_tx(op_type, idem_key, actor) values ('admin_adjust','forge:2','attacker') returning id`)).rows[0].id;
      const w = (await c.query(`select eco._wallet($1,'GOLD_TEST') w`, [a])).rows[0].w;
      await c.query(`update eco.wallets set balance = 1000 where id = $1`, [w]);
      await c.query(`insert into eco.ledger_entries(tx_id, wallet_id, currency, amount, balance_after) values ($1,$2,'GOLD_TEST',1000,1000)`, [tx, w]);
      await expect(c.query('commit')).rejects.toMatchObject({ hint: 'unbalanced' });
    } finally { c.release(); }
  });
});

describe('claim_daily and activities (server clock)', () => {
  it('daily reward once per Paris day; same key replays; VIP gets exactly the same amount', async () => {
    const p = await newPlayer(su); const v = await newPlayer(su); await makeVip(su, v);
    const k = key();
    expect(await gate.claimDaily(p, k)).toMatchObject({ ok: true, gold: 150 });
    expect(await gate.claimDaily(p, k)).toMatchObject({ ok: true, gold: 150, replayed: true });
    expect(await gate.claimDaily(p, key())).toMatchObject({ ok: false, code: 'already_claimed' });
    expect(await gate.claimDaily(v, key())).toMatchObject({ ok: true, gold: 150 });
    expect(await gold(su, p)).toBe(150); expect(await gold(su, v)).toBe(150);
  });
  it('activity task is refused before the minimum duration and paid after it; daily cap applies', async () => {
    const p = await newPlayer(su);
    const s: any = await gate.activityStart(p, 'factory', 'uat:factory:1', key());
    expect(s).toMatchObject({ ok: true, min_seconds: 30 });
    expect(await gate.activityStart(p, 'factory', 'uat:factory:1', key())).toMatchObject({ ok: true, session: s.session, resumed: true });
    expect(await gate.completeActivityTask(p, s.session, key())).toMatchObject({ ok: false, code: 'too_fast' });
    await backdate(`update eco.activity_sessions set started_at = now() - interval '31 seconds' where id = $1`, [s.session]);
    expect(await gate.completeActivityTask(p, s.session, key())).toMatchObject({ ok: true, gold: 20, tasks_done: 1 });
    expect(await gate.completeActivityTask(p, s.session, key())).toMatchObject({ ok: false, code: 'too_fast' });
    const other = await newPlayer(su);
    expect(await gate.completeActivityTask(other, s.session, key())).toMatchObject({ ok: false, code: 'bad_session' });
    await su.query(`update eco.activity_definitions set daily_task_cap = 1 where id = 'factory'`);
    try {
      await backdate(`update eco.activity_sessions set last_task_at = now() - interval '31 seconds' where id = $1`, [s.session]);
      expect(await gate.completeActivityTask(p, s.session, key())).toMatchObject({ ok: false, code: 'daily_cap' });
    } finally { await su.query(`update eco.activity_definitions set daily_task_cap = 40 where id = 'factory'`); }
  });
});

describe('gifts (foundation, limits pending approval)', () => {
  it('gold gift moves gold one way; self, new accounts, blocked, frozen are refused', async () => {
    const a = await newPlayer(su); const b = await newPlayer(su); const young = await newPlayer(su, 1);
    await gate.testGrantGold(a, 1000, key());
    expect(await gate.giftGold(a, b, 100, key())).toMatchObject({ ok: true });
    expect(await gate.giftGold(a, a, 10, key())).toMatchObject({ code: 'self' });
    expect(await gate.giftGold(a, young, 10, key())).toMatchObject({ code: 'account_age' });
    expect(await gate.giftGold(a, b, 1001, key())).toMatchObject({ code: 'amount' });
    await api.query('select mod.block($1,$2)', [b, a]);
    expect(await gate.giftGold(a, b, 10, key())).toMatchObject({ code: 'blocked' });
    await api.query('select mod.unblock($1,$2)', [b, a]);
    await su.query('update eco.players set trade_frozen = true where id = $1', [b]);
    expect(await gate.giftGold(a, b, 10, key())).toMatchObject({ code: 'frozen' });
    expect(await gold(su, a)).toBe(900); expect(await gold(su, b)).toBe(100);
    const ev = (await su.query(`select type_id from prog.player_events where player_id in ($1,$2) and type_id like 'gift%' order by id`, [a, b])).rows.map((r) => r.type_id);
    expect(ev).toEqual(['gift_sent', 'gift_received']);
  });
  it('Diamond item: when a hold is configured, refused during the hold and accepted after it', async () => {
    const a = await newPlayer(su); const b = await newPlayer(su); await dev(a, 'DIAMOND', 10);
    const def = await defItem(su, { diamond: 10 });
    await setCfg(su, 'item.diamond_hold_days', 14);
    let r: any;
    try { r = await gate.shopBuy(a, def, 'DIAMOND', key()); } finally { await setCfg(su, 'item.diamond_hold_days', 0); }
    expect(await gate.giftItem(a, b, r.item, key())).toMatchObject({ code: 'on_hold' });
    await su.query(`update eco.item_instances set hold_until = now() - interval '1 second' where id = $1`, [r.item]);
    expect(await gate.giftItem(a, b, r.item, key())).toMatchObject({ ok: true });
    expect(await gate.giftItem(a, b, r.item, key())).toMatchObject({ code: 'not_owner' });
  });
});

describe('trade state machine', () => {
  async function setup() {
    const a = await newPlayer(su); const b = await newPlayer(su);
    await gate.testGrantGold(a, 1000, key()); await gate.testGrantGold(b, 1000, key());
    const def = await defItem(su, { gold: 100 });
    const ia: any = await gate.shopBuy(a, def, 'GOLD', key());
    const ib: any = await gate.shopBuy(b, def, 'GOLD', key());
    return { a, b, ia: ia.item as string, ib: ib.item as string };
  }
  it('lock -> settle swaps items and gold atomically, through escrow', async () => {
    const { a, b, ia, ib } = await setup(); const t = randomUUID();
    const snap = { a, b, version: 2, hash: 'h2', lines: [{ side: 'a' as const, item: ia }, { side: 'a' as const, gold: 50 }, { side: 'b' as const, item: ib }] };
    expect(await gate.tradeLock(t, a, snap, key())).toMatchObject({ ok: true, status: 'locked' });
    expect(await gold(su, a, 'escrow')).toBe(50); expect(await gold(su, a)).toBe(850);
    expect(await gate.giftItem(a, b, ia, key())).toMatchObject({ code: 'item_state' });
    const outsider = await newPlayer(su);
    expect(await gate.tradeSettle(t, outsider, key())).toMatchObject({ code: 'not_participant' });
    expect(await gate.tradeSettle(t, b, key())).toMatchObject({ ok: true, status: 'settled' });
    expect(await gate.tradeCancel(t, a, key())).toMatchObject({ code: 'bad_state' });
    const own = (await su.query('select id, owner_id, state from eco.item_instances where id = any($1)', [[ia, ib]])).rows;
    expect(own.find((r) => r.id === ia)).toMatchObject({ owner_id: b, state: 'owned' });
    expect(own.find((r) => r.id === ib)).toMatchObject({ owner_id: a, state: 'owned' });
    expect(await gold(su, a)).toBe(850); expect(await gold(su, b)).toBe(950); expect(await gold(su, a, 'escrow')).toBe(0);
  });
  it('lock -> cancel restores everything; expiry blocks settle and allows a system cancel', async () => {
    const { a, b, ia } = await setup(); const t = randomUUID();
    await gate.tradeLock(t, a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ia }, { side: 'b', gold: 300 }] }, key());
    expect(await gate.tradeCancel(t, null, key())).toMatchObject({ code: 'not_participant' });
    await su.query(`alter table eco.trades disable trigger trade_state`);
    await su.query(`update eco.trades set locked_at = now() - interval '20 minutes', expires_at = now() - interval '10 minutes' where id = $1`, [t]);
    await su.query(`alter table eco.trades enable trigger trade_state`);
    expect(await gate.tradeSettle(t, a, key())).toMatchObject({ code: 'expired' });
    expect(await gate.tradeCancel(t, null, key())).toMatchObject({ ok: true, status: 'cancelled' });
    expect((await su.query('select owner_id, state, locked_by_trade from eco.item_instances where id=$1', [ia])).rows[0]).toEqual({ owner_id: a, state: 'owned', locked_by_trade: null });
    expect(await gold(su, b)).toBe(900); expect(await gold(su, b, 'escrow')).toBe(0);
  });
  it('refuses trades without items, foreign items, duplicated items and Diamond lines', async () => {
    const { a, b, ia, ib } = await setup();
    expect(await gate.tradeLock(randomUUID(), a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', gold: 10 }] }, key())).toMatchObject({ code: 'no_item' });
    expect(await gate.tradeLock(randomUUID(), a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ib }] }, key())).toMatchObject({ code: 'not_owner' });
    expect(await gate.tradeLock(randomUUID(), a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ia }, { side: 'a', item: ia }] }, key())).toMatchObject({ code: 'bad_lines' });
    expect(await gate.tradeLock(randomUUID(), a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ia }, { side: 'b', gold: 1.5 }] }, key())).toMatchObject({ code: 'bad_lines' });
    const outsider = await newPlayer(su);
    expect(await gate.tradeLock(randomUUID(), outsider, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ia }] }, key())).toMatchObject({ code: 'not_participant' });
  });
  it('the trades state machine cannot be bypassed even by the owner role', async () => {
    const { a, b, ia } = await setup(); const t = randomUUID();
    await gate.tradeLock(t, a, { a, b, version: 1, hash: 'h', lines: [{ side: 'a', item: ia }] }, key());
    await gate.tradeCancel(t, a, key());
    await expect(su.query(`update eco.trades set status = 'settled' where id = $1`, [t])).rejects.toMatchObject({ hint: 'bad_state' });
    await expect(su.query(`delete from eco.trades where id = $1`, [t])).rejects.toMatchObject({ code: '42501' });
  });
});

describe('Prestige and VIP', () => {
  it('a Prestige grant from a monetary event (purchase, gift, trade, VIP) is refused; from gameplay it is accepted', async () => {
    const p = await newPlayer(su); await gate.testGrantGold(p, 200, key());
    const def = await defItem(su, { gold: 100 });
    await gate.shopBuy(p, def, 'GOLD', key());
    const buyEv = (await su.query(`select id from prog.player_events where player_id=$1 and type_id='shop_buy'`, [p])).rows[0].id;
    await expect(su.query(`insert into prog.prestige_grants(player_id, dimension, points, source_type, source_event) values ($1,'style',10,'shop_buy',$2)`, [p, buyEv]))
      .rejects.toMatchObject({ hint: 'prestige_bought' });
    const vipEv = (await su.query(`insert into prog.player_events(player_id, type_id, payload, source) values ($1,'vip_granted','{}','test') returning id`, [p])).rows[0].id;
    await expect(su.query(`insert into prog.prestige_grants(player_id, dimension, points, source_type, source_event) values ($1,'style',10,'vip_granted',$2)`, [p, vipEv]))
      .rejects.toMatchObject({ hint: 'prestige_bought' });
    const gameEv = (await su.query(`insert into prog.player_events(player_id, type_id, payload, source) values ($1,'dominoes_result','{}','test') returning id`, [p])).rows[0].id;
    await su.query(`insert into prog.prestige_grants(player_id, dimension, points, source_type, source_event) values ($1,'games',5,'dominoes_result',$2)`, [p, gameEv]);
    await expect(su.query(`update prog.event_types set monetary = false where id = 'shop_buy'`)).rejects.toThrow(/cannot become non-monetary/);
  });
  it('VIP has no economic edge: same price, same caps, same reward', async () => {
    const v = await newPlayer(su); const n = await newPlayer(su); await makeVip(su, v);
    await gate.testGrantGold(v, 500, key()); await gate.testGrantGold(n, 500, key());
    const def = await defItem(su, { gold: 120 });
    const rv: any = await gate.shopBuy(v, def, 'GOLD', key()); const rn: any = await gate.shopBuy(n, def, 'GOLD', key());
    expect(rv.price).toBe(rn.price);
    const src = (await su.query(`select string_agg(prosrc, ' ') s from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace where ns.nspname = 'eco' and proname <> 'is_vip'`)).rows[0].s as string;
    expect(src.includes('is_vip')).toBe(false);   // no economy function reads VIP
  });
});

describe('events (foundation)', () => {
  it('1 per rolling hour for normal players; VIP not limited hourly; kick bans 60 min; list by category', async () => {
    const p = await newPlayer(su); const v = await newPlayer(su); const g = await newPlayer(su); await makeVip(su, v);
    const start = new Date(Date.now() + 3600_000).toISOString();
    const e1: any = (await api.query('select social.create_event($1,$2,$3,$4,$5,$6) r', [p, 'party', 'Beach party', 'beach', start, 60])).rows[0].r;
    expect(e1.ok).toBe(true);
    await expect(api.query('select social.create_event($1,$2,$3,$4,$5,$6)', [p, 'party', 'Second', 'beach', start, 60])).rejects.toMatchObject({ hint: 'rate_hour' });
    for (let i = 0; i < 3; i++) await api.query('select social.create_event($1,$2,$3,$4,$5,$6)', [v, 'music', `VIP ${i}`, 'club', start, 60]);
    expect((await api.query('select social.kick($1,$2,$3,$4) r', [e1.event, p, g, 'spam'])).rows[0].r.ok).toBe(true);
    expect((await api.query('select social.can_join($1,$2) r', [e1.event, g])).rows[0].r).toMatchObject({ ok: false, reason: 'kicked' });
    await expect(api.query('select social.kick($1,$2,$3,$4)', [e1.event, g, p, 'x'])).rejects.toMatchObject({ hint: 'not_owner' });
    const list = (await api.query('select * from social.list_events($1,null,null,50)', ['music'])).rows;
    expect(list.filter((r) => r.owner_id === v)).toHaveLength(3);
    expect((await api.query('select social.can_join($1,$2) r', [e1.event, g])).rows[0].r.until).toBeTruthy();
  });
});

describe('audit chain', () => {
  it('audit.log is hash-chained and verifiable', async () => {
    for (let i = 0; i < 5; i++) await su.query(`insert into audit.log(actor, action, target, hash) values ('admin:test','test_action',$1,'\\x00')`, [`t${i}`]);
    expect((await su.query('select audit.verify_chain() r')).rows[0].r).toMatchObject({ broken: 0 });
  });
});

describe('read functions', () => {
  it('list_items, get_config and activity_end work for app_api', async () => {
    const p = await newPlayer(su); await gate.testGrantGold(p, 100, key());
    const def = await defItem(su, { gold: 100 });
    const b: any = await gate.shopBuy(p, def, 'GOLD', key());
    const items = (await api.query('select * from eco.list_items($1)', [p])).rows;
    expect(items).toEqual([expect.objectContaining({ id: b.item, def_id: def, state: 'owned', origin: 'gold', tradable: true })]);
    const cfg = (await api.query('select * from eco.get_config()')).rows;
    expect(cfg.find((r) => r.key === 'item.diamond_hold_days')).toMatchObject({ value: 0, status: 'owner_rule' });
    const s: any = await gate.activityStart(p, 'factory', 'local:factory:9', key());
    expect((await api.query('select eco.activity_end($1,$2) r', [p, s.session])).rows[0].r).toEqual({ ok: true, ended: true });
    expect((await api.query('select eco.activity_end($1,$2) r', [p, s.session])).rows[0].r).toEqual({ ok: true, ended: false });
  });
});

describe('reconciliation', () => {
  it('is all zeros after the functional suite', async () => {
    const r = await recon(su);
    expect(r).toEqual(Object.fromEntries(Object.keys(r).map((k) => [k, 0])));
    expect(await gate.reconciliation()).toMatchObject({ ok: true });
  });
});
