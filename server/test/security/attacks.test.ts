// Security suite: 1000-parallel attacks against the LOCAL Postgres through the app_api role (pool of 100
// connections, like ~100 concurrent Worker isolates). Measurements land in test-results/security.json.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { superPool, rolePool, newPlayer, gold, setCfg, defItem, recon, key, flood, record, makeVip } from '../helpers/db';

const N = Number(process.env.ATTACK_N || 1000);
const su = superPool(10);
const api = rolePool('app_api', 100);
const call = (fn: string, args: unknown[]) => api.query(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args);
const grant = (p: string, n: number) => call('eco.test_grant_gold', [key('g'), p, n]);

beforeAll(async () => { await api.query('select 1'); });
afterAll(async () => { await Promise.all([su.end(), api.end()]); });

describe(`EconomyGate under ${N} parallel attacks`, () => {
  it('S1 replay: same idempotency key x N -> exactly one transfer', async () => {
    const a = await newPlayer(su), b = await newPlayer(su); await grant(a, 1000);
    const k = key('replay');
    const r = await flood(N, () => call('eco.gift_gold', [k, a, b, 100]));
    const txs = (await su.query(`select count(*) c from eco.ledger_tx where idem_key like '%' || $1`, [k])).rows[0].c;
    record('S1_replay', { ...r, txs, a: await gold(su, a), b: await gold(su, b) });
    expect(r.ok).toBe(1); expect(r.replayed).toBe(N - 1); expect(txs).toBe(1);
    expect(await gold(su, a)).toBe(900); expect(await gold(su, b)).toBe(100);
  });

  it('S2 replay with a different payload (same key, other amount / target) -> refused', async () => {
    const a = await newPlayer(su), b = await newPlayer(su), c = await newPlayer(su); await grant(a, 1000);
    const k = key('reuse');
    await call('eco.gift_gold', [k, a, b, 100]);
    const r = await flood(N, (i) => call('eco.gift_gold', [k, a, i % 2 ? b : c, 100 + (i % 2)]));
    record('S2_key_reuse', r);
    expect(r.ok).toBe(0); expect(r.errors.key_reuse).toBe(N);
    expect(await gold(su, a)).toBe(900);
  });

  it('S3 double-spend: N distinct-key purchases of 10 from a 1000 balance -> 100 succeed, balance 0', async () => {
    const p = await newPlayer(su); await grant(p, 1000);
    const def = await defItem(su, { gold: 10 });
    const r = await flood(N, (i) => call('eco.shop_buy', [key(`ds${i}`), p, def, 'GOLD']));
    const items = (await su.query('select count(*) c from eco.item_instances where owner_id=$1', [p])).rows[0].c;
    record('S3_double_spend', { ...r, balance: await gold(su, p), items });
    expect(r.ok).toBe(100); expect(r.errors.insufficient).toBe(N - 100);
    expect(await gold(su, p)).toBe(0); expect(items).toBe(100);
  });

  it('S4 limited stock: N buys (N/10 players) of an item with stock 1 -> exactly 1 success', async () => {
    const players = await Promise.all(Array.from({ length: N / 10 }, () => newPlayer(su)));
    await Promise.all(players.map((p) => grant(p, 10_000)));
    const def = await defItem(su, { gold: 100, stock: 1 });
    const r = await flood(N, (i) => call('eco.shop_buy', [key(`ltd${i}`), players[i % players.length], def, 'GOLD']));
    const sold = (await su.query('select stock_sold from eco.item_definitions where id=$1', [def])).rows[0].stock_sold;
    const inst = (await su.query('select count(*) c from eco.item_instances where def_id=$1', [def])).rows[0].c;
    record('S4_limited_stock', { ...r, sold, instances: inst });
    expect(r.ok).toBe(1); expect(r.errors.sold_out).toBe(N - 1); expect(sold).toBe(1); expect(inst).toBe(1);
  });

  it('S5 trade race: N different trades try to lock the SAME item -> exactly 1 lock', async () => {
    const a = await newPlayer(su); const bs = await Promise.all(Array.from({ length: 20 }, () => newPlayer(su)));
    await grant(a, 1000); await Promise.all(bs.map((b) => grant(b, 1000)));
    const def = await defItem(su, { gold: 100 });
    const item = (await call('eco.shop_buy', [key(), a, def, 'GOLD'])).rows[0].r.item;
    const r = await flood(N, (i) => call('eco.trade_lock', [key(`tl${i}`), randomUUID(), a, a, bs[i % 20], 1, 'h',
      JSON.stringify([{ side: 'a', item }, { side: 'b', gold: 10 }])]));
    const locks = (await su.query(`select count(*) c from eco.trade_lines l join eco.trades t on t.id=l.trade_id where l.item_id=$1 and t.status='locked'`, [item])).rows[0].c;
    const escrow = (await su.query(`select coalesce(sum(balance),0) s from eco.wallets where purpose='escrow' and player_id = any($1)`, [bs])).rows[0].s;
    record('S5_trade_same_item', { ...r, open_locks_on_item: locks, total_escrow: escrow });
    expect(r.ok).toBe(1); expect(locks).toBe(1); expect(escrow).toBe(10);
    expect(Object.keys(r.errors).every((k) => ['item_state', 'trade_exists'].includes(k))).toBe(true);
  });

  it('S6 settle/cancel race: N mixed settle + cancel calls on one locked trade -> exactly one terminal transition', async () => {
    const a = await newPlayer(su), b = await newPlayer(su); await grant(a, 1000); await grant(b, 1000);
    const def = await defItem(su, { gold: 100 });
    const ia = (await call('eco.shop_buy', [key(), a, def, 'GOLD'])).rows[0].r.item;
    const ib = (await call('eco.shop_buy', [key(), b, def, 'GOLD'])).rows[0].r.item;
    const t = randomUUID();
    await call('eco.trade_lock', [key(), t, a, a, b, 1, 'h', JSON.stringify([{ side: 'a', item: ia }, { side: 'a', gold: 200 }, { side: 'b', item: ib }])]);
    const r = await flood(N, (i) => i % 2 ? call('eco.trade_settle', [key(`st${i}`), t, i % 4 === 1 ? a : b]) : call('eco.trade_cancel', [key(`cx${i}`), t, i % 4 === 0 ? a : b]));
    const st = (await su.query('select status from eco.trades where id=$1', [t])).rows[0].status;
    const moves = (await su.query(`select count(*) c from eco.item_moves where item_id = any($1) and reason='trade'`, [[ia, ib]])).rows[0].c;
    const total = (await gold(su, a)) + (await gold(su, b)) + (await gold(su, a, 'escrow')) + (await gold(su, b, 'escrow'));
    record('S6_settle_cancel_race', { ...r, final_status: st, trade_moves: moves, gold_total_ab: total });
    expect(r.ok).toBe(1); expect(r.errors.bad_state).toBe(N - 1);
    expect(moves).toBe(st === 'settled' ? 2 : 0);
    expect(total).toBe(1800);
  });

  it('S7 duplication: one item gifted N times in parallel to 20 receivers -> exactly 1 owner change', async () => {
    const a = await newPlayer(su); const bs = await Promise.all(Array.from({ length: 20 }, () => newPlayer(su)));
    await grant(a, 1000); await setCfg(su, 'gift.count_per_day', 1e6);
    try {
      const def = await defItem(su, { gold: 100 });
      const item = (await call('eco.shop_buy', [key(), a, def, 'GOLD'])).rows[0].r.item;
      const r = await flood(N, (i) => call('eco.gift_item', [key(`gi${i}`), a, bs[i % 20], item]));
      const moves = (await su.query(`select count(*) c from eco.item_moves where item_id=$1 and reason='gift'`, [item])).rows[0].c;
      record('S7_item_gift_dup', { ...r, moves });
      expect(r.ok).toBe(1); expect(r.errors.not_owner).toBe(N - 1); expect(moves).toBe(1);
    } finally { await setCfg(su, 'gift.count_per_day', 10); }
  });

  it('S8 duplication: gift_item and trade_lock of the same item in parallel -> item ends up in exactly one place', async () => {
    const a = await newPlayer(su), b = await newPlayer(su), c = await newPlayer(su); await grant(a, 1000);
    await setCfg(su, 'gift.count_per_day', 1e6);
    try {
      const def = await defItem(su, { gold: 100 });
      const item = (await call('eco.shop_buy', [key(), a, def, 'GOLD'])).rows[0].r.item;
      const r = await flood(N, (i) => i % 2
        ? call('eco.gift_item', [key(`g${i}`), a, c, item])
        : call('eco.trade_lock', [key(`t${i}`), randomUUID(), a, a, b, 1, 'h', JSON.stringify([{ side: 'a', item }])]));
      const it = (await su.query('select owner_id, state from eco.item_instances where id=$1', [item])).rows[0];
      record('S8_gift_vs_trade', { ...r, final: it });
      expect(r.ok).toBe(1);
      expect((it.owner_id === c && it.state === 'owned') || (it.owner_id === a && it.state === 'trade_locked')).toBe(true);
    } finally { await setCfg(su, 'gift.count_per_day', 10); }
  });

  it('S9 negative balance: N gifts that together exceed the balance -> never negative', async () => {
    await setCfg(su, 'gift.count_per_day', 1e6); await setCfg(su, 'gift.gold_sent_per_day', 1e9); await setCfg(su, 'gift.gold_received_per_day', 1e9);
    try {
      const a = await newPlayer(su), b = await newPlayer(su); await grant(a, 995);
      const r = await flood(N, (i) => call('eco.gift_gold', [key(`neg${i}`), a, b, 10]));
      const neg = (await su.query(`select count(*) c from eco.wallets where owner_kind='player' and balance < 0`)).rows[0].c;
      record('S9_negative', { ...r, a: await gold(su, a), b: await gold(su, b), negative_wallets: neg });
      expect(r.ok).toBe(99); expect(await gold(su, a)).toBe(5); expect(neg).toBe(0);
    } finally {
      await setCfg(su, 'gift.count_per_day', 10); await setCfg(su, 'gift.gold_sent_per_day', 2000); await setCfg(su, 'gift.gold_received_per_day', 5000);
    }
  });

  it('S10 deadlock storm: N opposite-direction gifts A<->B -> no deadlock, total conserved', async () => {
    await setCfg(su, 'gift.count_per_day', 1e6); await setCfg(su, 'gift.gold_sent_per_day', 1e9); await setCfg(su, 'gift.gold_received_per_day', 1e9);
    try {
      const x = await newPlayer(su), y = await newPlayer(su); await grant(x, 5000); await grant(y, 5000);
      const r = await flood(N, (i) => i % 2 ? call('eco.gift_gold', [key(`xy${i}`), x, y, 7]) : call('eco.gift_gold', [key(`yx${i}`), y, x, 7]));
      const tot = (await gold(su, x)) + (await gold(su, y));
      record('S10_deadlock_storm', { ...r, total: tot });
      expect(r.ok).toBe(N); expect(r.errors['40P01']).toBeUndefined(); expect(tot).toBe(10_000);
    } finally {
      await setCfg(su, 'gift.count_per_day', 10); await setCfg(su, 'gift.gold_sent_per_day', 2000); await setCfg(su, 'gift.gold_received_per_day', 5000);
    }
  });

  it('S11 gift caps under concurrency (pending-approval defaults): N gifts of 150 -> exactly 10 accepted', async () => {
    const a = await newPlayer(su), b = await newPlayer(su); await grant(a, 100_000);
    const r = await flood(N, (i) => call('eco.gift_gold', [key(`cap${i}`), a, b, 150]));
    record('S11_gift_caps', { ...r, b: await gold(su, b) });
    expect(r.ok).toBe(10); expect(await gold(su, b)).toBe(1500);
  });

  it('S12 reward farming: N claim_daily with distinct keys -> exactly 1 reward', async () => {
    const p = await newPlayer(su);
    const r = await flood(N, (i) => call('eco.claim_daily', [key(`d${i}`), p]));
    record('S12_daily_farming', { ...r, gold: await gold(su, p) });
    expect(r.ok).toBe(1); expect(r.errors.already_claimed).toBe(N - 1); expect(await gold(su, p)).toBe(150);
  });

  it('S13 reward farming: N task completions in parallel -> 0 before the minimum duration, exactly 1 after', async () => {
    const p = await newPlayer(su);
    const s = (await call('eco.activity_start', [key(), p, 'factory', 'local:factory:1'])).rows[0].r.session;
    const early = await flood(N, (i) => call('eco.activity_complete_task', [key(`e${i}`), p, s]));
    await su.query(`update eco.activity_sessions set started_at = now() - interval '31 seconds' where id=$1`, [s]);
    const late = await flood(N, (i) => call('eco.activity_complete_task', [key(`l${i}`), p, s]));
    // parallel sessions cannot be opened to multiply the rate
    const starts = await flood(50, (i) => call('eco.activity_start', [key(`s${i}`), p, 'factory', 'local:factory:2']));
    const sessions = (await su.query(`select count(*) c from eco.activity_sessions where player_id=$1 and ended_at is null`, [p])).rows[0].c;
    record('S13_activity_farming', { early, late, open_sessions_after_50_starts: sessions, gold: await gold(su, p) });
    expect(early.ok).toBe(0); expect(early.errors.too_fast).toBe(N);
    expect(late.ok).toBe(1); expect(late.errors.too_fast).toBe(N - 1);
    expect(starts.ok).toBe(50); expect(sessions).toBe(1); expect(await gold(su, p)).toBe(20);
  });

  it('S14 events: N parallel creations by a normal player -> 1; by a VIP -> safeguard (5 active) respected', async () => {
    const p = await newPlayer(su), v = await newPlayer(su); await makeVip(su, v);
    const start = new Date(Date.now() + 3600_000).toISOString();
    const r = await flood(N, (i) => api.query('select social.create_event($1,$2,$3,$4,$5,$6) r', [p, 'party', `Party ${i}`, 'beach', start, 60]));
    const rv = await flood(N, (i) => api.query('select social.create_event($1,$2,$3,$4,$5,$6) r', [v, 'party', `VIP ${i}`, 'beach', start, 60]));
    record('S14_events', { normal: r, vip: rv });
    expect(r.ok).toBe(1); expect(r.errors.rate_hour).toBe(N - 1);
    expect(rv.ok).toBe(5); expect(rv.errors.vip_active).toBe(N - 5);
  });

  it('S15 reconciliation after all attacks: every check is 0', async () => {
    const r = await recon(su);
    record('S15_reconciliation', r);
    expect(r).toEqual(Object.fromEntries(Object.keys(r).map((k) => [k, 0])));
  });
});
