// QA finding B2: mixed contention on the same wallets (purchases + gifts + trades + grants in parallel).
// Target: 0 deadlocks (40P01), 0 non-business failures, money conserved, recon = 0. Writes test-results/concurrency-mixed.json.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { superPool, rolePool, newPlayer, gold, defItem, recon, key } from '../helpers/db';

const su = superPool(5); const api = rolePool('app_api', 100);
const out: Record<string, unknown> = {};
afterAll(async () => {
  fs.mkdirSync(path.resolve(__dirname, '../../test-results'), { recursive: true });
  fs.writeFileSync(path.resolve(__dirname, '../../test-results/concurrency-mixed.json'), JSON.stringify(out, null, 2));
  await Promise.all([su.end(), api.end()]);
});
const BUSINESS = new Set(['insufficient', 'cap_count', 'cap_sent', 'cap_received', 'not_owner', 'item_state', 'trade_exists', 'bad_state', 'invariant', 'sold_out', 'already_claimed']);
const call = async (fn: string, args: unknown[]) => {
  try { return (await api.query(`select ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) r`, args)).rows[0].r; }
  catch (e: any) { return { err: e.code === 'P0001' ? e.hint : e.code }; }
};
const tally = (rs: any[]) => rs.reduce((a, r) => { const k = r?.err ?? (r?.replayed ? 'replayed' : 'ok'); a[k] = (a[k] || 0) + 1; return a; }, {} as Record<string, number>);
const deadlocks = async () => { await sleep(1200); return Number((await su.query('select deadlocks from pg_stat_database where datname = current_database()')).rows[0].deadlocks); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const failures = (t: Record<string, number>) => Object.entries(t).filter(([k]) => k !== 'ok' && k !== 'replayed' && !BUSINESS.has(k)).reduce((s, [, v]) => s + v, 0);

describe('mixed contention on the same wallets (B2)', () => {
  it('QA P1 reproduction: 300 shop_buy + 300 gift_gold racing on one 1000-Gold wallet', async () => {
    const a = await newPlayer(su), b = await newPlayer(su); const item = await defItem(su, { gold: 7 });
    await call('eco.ensure_player', [b]); await call('eco.test_grant_gold', [key(), a, 1000]);
    const d0 = await deadlocks(); const t0 = performance.now();
    const rs = await Promise.all([...Array(300)].flatMap(() => [call('eco.shop_buy', [key('b'), a, item, 'GOLD']), call('eco.gift_gold', [key('g'), a, b, 5])]));
    const ms = Math.round(performance.now() - t0); const dl = (await deadlocks()) - d0;
    const buys = rs.filter((_, i) => i % 2 === 0), gifts = rs.filter((_, i) => i % 2 === 1);
    const nb = buys.filter((r: any) => r.ok).length, ng = gifts.filter((r: any) => r.ok).length;
    const t = tally(rs);
    out.P1 = { calls: 600, ms, deadlocks: dl, failed: failures(t), buys: tally(buys), gifts: tally(gifts), a: await gold(su, a), b: await gold(su, b) };
    console.log('[MESURÉ] P1', JSON.stringify(out.P1));
    expect((await gold(su, a)) + nb * 7 + ng * 5).toBe(1000); expect(await gold(su, b)).toBe(ng * 5);
    expect(dl).toBe(0); expect(failures(t)).toBe(0);
  }, 120_000);

  it('purchases + gifts both ways + trades (lock+settle) + grants + daily on the same two players', async () => {
    const a = await newPlayer(su), b = await newPlayer(su); const def = await defItem(su, { gold: 3 });
    await call('eco.test_grant_gold', [key(), a, 2000]); await call('eco.test_grant_gold', [key(), b, 2000]);
    const items: string[] = [];
    for (let i = 0; i < 60; i++) items.push((await call('eco.shop_buy', [key(), a, def, 'GOLD'])).item);
    const total0 = (await gold(su, a)) + (await gold(su, b));
    const d0 = await deadlocks(); const t0 = performance.now();
    const jobs: Promise<any>[] = [];
    for (let i = 0; i < 60; i++) {
      const tr = randomUUID(); const lines = JSON.stringify([{ side: 'a', item: items[i] }, { side: 'b', gold: 2 }]);
      jobs.push(call('eco.trade_lock', [key(), tr, b, a, b, 1, 'h', lines]).then((r) => (r.ok ? call(i % 3 ? 'eco.trade_settle' : 'eco.trade_cancel', [key(), tr, i % 2 ? a : b]) : r)));
      // same item in a second, competing trade: exactly one of the two may lock it
      const tr2 = randomUUID();
      jobs.push(call('eco.trade_lock', [key(), tr2, a, a, b, 1, 'h2', JSON.stringify([{ side: 'a', item: items[i] }, { side: 'b', gold: 1 }])]).then((r) => (r.ok ? call('eco.trade_cancel', [key(), tr2, a]) : r)));
    }
    for (let i = 0; i < 150; i++) {
      jobs.push(call('eco.shop_buy', [key(), i % 2 ? a : b, def, 'GOLD']));
      jobs.push(call('eco.gift_gold', [key(), i % 2 ? a : b, i % 2 ? b : a, 1]));
    }
    for (let i = 0; i < 40; i++) jobs.push(call('eco.test_grant_gold', [key(), i % 2 ? a : b, 5]));
    jobs.push(call('eco.claim_daily', [key(), a]), call('eco.claim_daily', [key(), b]));
    const rs = await Promise.all(jobs);
    const ms = Math.round(performance.now() - t0); const dl = (await deadlocks()) - d0;
    const t = tally(rs);
    out.mixed = { calls: rs.length, ms, deadlocks: dl, failed: failures(t), tally: t };
    console.log('[MESURÉ] mixed', JSON.stringify(out.mixed));
    expect(Object.values(await recon(su)).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
    expect(total0).toBeGreaterThan(0);
    const locked = Number((await su.query(`select count(*) n from eco.item_instances where state = 'trade_locked' and id = any($1)`, [items])).rows[0].n);
    expect(locked).toBe(0);                                                  // every lock was settled or cancelled
    expect(dl).toBe(0); expect(failures(t)).toBe(0);
  }, 180_000);
});
