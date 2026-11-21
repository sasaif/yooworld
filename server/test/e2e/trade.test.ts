// Trade negotiation room (DO) + settlement through eco.trade_lock / eco.trade_settle. Races included.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { startWrangler, stopWrangler, su, signUp, http, ikey, type Client } from './harness';

const pool = su();
let A: Client, B: Client, C: Client;
const results: Record<string, unknown> = {};
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
let def = '';
const buy = async (p: Client) => (await pool.query(`select eco.shop_buy($1,$2,$3,'GOLD') r`, [ikey(), p.id, def])).rows[0].r.item as string;
const bal = async (p: Client) => (await http('GET', '/api/economy/balance', { cookie: p.cookie })).json.gold as number;
const owner = async (item: string) => (await pool.query('select owner_id, state from eco.item_instances where id = $1', [item])).rows[0];
const newTrade = async (from: Client, to: Client) => (await http('POST', '/api/trades', { cookie: from.cookie, body: { with: to.id } })).json.state.id as string;
const offer = (p: Client, id: string, version: number, lines: unknown) => http('POST', `/api/trades/${id}/offer`, { cookie: p.cookie, body: { version, lines } });
const accept = (p: Client, id: string, version: number) => http('POST', `/api/trades/${id}/accept`, { cookie: p.cookie, body: { version } });

beforeAll(async () => {
  await startWrangler();
  A = await signUp(pool, 'ta'); B = await signUp(pool, 'tb'); C = await signUp(pool, 'tc');
  for (const p of [A, B]) await http('POST', '/api/economy/test-grant', { cookie: p.cookie, body: { amount: 1000 }, headers: { 'idempotency-key': ikey() } });
  await http('GET', '/api/me', { cookie: C.cookie });
  await pool.query(`update eco.players set created_at = now() - interval '30 days' where id = any($1)`, [[A.id, B.id, C.id]]);
  def = `trd_${crypto.randomUUID().slice(0, 8)}`;
  await pool.query(`insert into eco.item_definitions(id, kind, price_gold, price_diamond) values ($1,'furniture',1,1)`, [def]);
});
afterAll(async () => { await stopWrangler(); await pool.end(); });

describe('trade room', () => {
  it('offer, counter-offer, stale versions refused, both accept the same version -> settled once in Postgres', async () => {
    const i1 = await buy(A); const a0 = await bal(A), b0 = await bal(B);
    const id = await newTrade(A, B);
    expect((await offer(A, id, 0, [{ side: 'a', item: i1 }, { side: 'b', gold: 50 }])).json.state.version).toBe(1);
    expect((await offer(B, id, 1, [{ side: 'a', item: i1 }, { side: 'b', gold: 40 }])).json.state.version).toBe(2);
    expect((await offer(A, id, 1, [{ side: 'a', item: i1 }])).json.code).toBe('stale_version');
    expect((await accept(A, id, 2)).json).toMatchObject({ waiting: true });
    expect((await accept(B, id, 1)).json.code).toBe('stale_version');
    expect((await http('GET', `/api/trades/${id}`, { cookie: C.cookie })).status).toBe(403);                // outsider
    expect((await offer(C, id, 2, [{ side: 'a', item: i1 }])).status).toBe(403);
    const done = await accept(B, id, 2);
    expect(done.json).toMatchObject({ ok: true, state: { status: 'settled', version: 2 } });
    expect(await owner(i1)).toMatchObject({ owner_id: B.id, state: 'owned' });
    expect(await bal(A)).toBe(a0 + 40); expect(await bal(B)).toBe(b0 - 40);
    const row = (await pool.query(`select t.status, t.offer_version, t.offer_hash from eco.trades t join eco.trade_lines l on l.trade_id = t.id where l.item_id = $1`, [i1])).rows;
    expect(row).toHaveLength(1);
    expect(row[0]).toMatchObject({ status: 'settled', offer_version: 2, offer_hash: sha(JSON.stringify([id, A.id, B.id, 2, [{ side: 'a', item: i1 }, { side: 'b', gold: 40 }]])) });
    expect((await accept(A, id, 2)).json.code).toBe('bad_state');                                           // settled: frozen
  });

  it('race: 10 + 10 concurrent accepts of the same version -> exactly one settlement', async () => {
    const i = await buy(A); const id = await newTrade(A, B);
    await offer(A, id, 0, [{ side: 'a', item: i }, { side: 'b', gold: 7 }]);
    const tx0 = Number((await pool.query('select count(*) n from eco.ledger_tx')).rows[0].n);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, k) => accept(k % 2 ? A : B, id, 1)));
    const codes = rs.map((r) => r.status);
    expect(codes.every((s) => s < 500)).toBe(true);
    expect(rs.filter((r) => r.json?.state?.status === 'settled' && r.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(Number((await pool.query(`select count(*) n from eco.trades t join eco.trade_lines l on l.trade_id = t.id where l.item_id = $1`, [i])).rows[0].n)).toBe(1);
    expect(Number((await pool.query('select count(*) n from eco.ledger_tx')).rows[0].n)).toBe(tx0 + 2);  // one lock + one settle
    expect(await owner(i)).toMatchObject({ owner_id: B.id });
    results.accept_race = { requests: 20, statuses: codes.reduce((m: any, s) => ((m[s] = (m[s] || 0) + 1), m), {}), settlements: 1 };
  });

  it('race: counter-offer vs acceptance -> never settles a version that was not accepted by both (10 rounds)', async () => {
    const out = { settled_v1: 0, offer_won: 0 };
    for (let k = 0; k < 10; k++) {
      const i = await buy(A); const id = await newTrade(A, B);
      await offer(A, id, 0, [{ side: 'a', item: i }, { side: 'b', gold: 3 }]);
      await accept(A, id, 1);
      const [acc, off] = await Promise.all([accept(B, id, 1), offer(A, id, 1, [{ side: 'a', item: i }, { side: 'b', gold: 9 }])]);
      if (acc.status === 200) { expect(acc.json.state).toMatchObject({ status: 'settled', version: 1 }); expect(off.json.code).toBe('bad_state'); out.settled_v1++;
        expect((await pool.query(`select t.offer_version v from eco.trades t join eco.trade_lines l on l.trade_id=t.id where l.item_id=$1`, [i])).rows[0].v).toBe(1);
      } else { expect(acc.json.code).toBe('stale_version'); expect(off.json.state.version).toBe(2); out.offer_won++;
        expect(Number((await pool.query(`select count(*) n from eco.trade_lines where item_id=$1`, [i])).rows[0].n)).toBe(0);
      }
    }
    expect(out.settled_v1 + out.offer_won).toBe(10);
    results.offer_vs_accept = out;
  });

  it('item moved before the last acceptance -> lock refused, nothing moves, negotiation back to open', async () => {
    const i = await buy(A); const id = await newTrade(A, B);
    await offer(A, id, 0, [{ side: 'a', item: i }, { side: 'b', gold: 11 }]);
    await accept(A, id, 1);
    await pool.query('select eco.gift_item($1,$2,$3,$4)', [ikey(), A.id, C.id, i]);                       // A gives it away meanwhile
    const b0 = await bal(B);
    const r = await accept(B, id, 1);
    expect(r.status).toBe(409); expect(r.json.code).toBe('not_owner');
    expect(r.json.state).toMatchObject({ status: 'open', lastError: 'not_owner', accepted: { a: null, b: null } });
    expect(await bal(B)).toBe(b0);
    expect(await owner(i)).toMatchObject({ owner_id: C.id });
    expect((await http('POST', `/api/trades/${id}/cancel`, { cookie: B.cookie, body: {} })).json.state.status).toBe('cancelled');
  });

  it('same item in two negotiations accepted in parallel -> exactly one settles, the other returns to open', async () => {
    const i = await buy(A);
    const t1 = await newTrade(A, B), t2 = await newTrade(A, B);
    for (const t of [t1, t2]) { await offer(A, t, 0, [{ side: 'a', item: i }, { side: 'b', gold: 2 }]); await accept(A, t, 1); }
    const [r1, r2] = await Promise.all([accept(B, t1, 1), accept(B, t2, 1)]);
    const ok = [r1, r2].filter((r) => r.status === 200); const ko = [r1, r2].filter((r) => r.status === 409);
    expect(ok).toHaveLength(1); expect(ko).toHaveLength(1);
    expect(['item_state', 'not_owner']).toContain(ko[0].json.code);
    expect(ko[0].json.state.status).toBe('open');
    expect(await owner(i)).toMatchObject({ owner_id: B.id, state: 'owned' });
    const recon = (await pool.query('select eco.recon_summary() r')).rows[0].r;
    expect(Object.values(recon).filter((v) => typeof v === 'number' && v !== 0)).toEqual([]);
    results.double_item = { settled: 1, refused: ko[0].json.code };
    console.log('[MESURÉ] trade races', JSON.stringify(results));
  });
});
