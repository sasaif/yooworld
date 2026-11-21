import { describe, expect, it } from 'vitest';
import { audit, emptyWallet, post } from '../src/economy/ledger';
import { initialState, newAccount, TEST_BALANCES, TEST_FRIEND, TEST_PLAYER } from '../src/economy/bank';
import { checkout, quoteCart } from '../src/economy/purchase';
import { acceptTrade, confirmTrade, openTrade, rejectTrade, sanitizeOffer, setOffer } from '../src/economy/trading';
import { addActivity, claimDaily, REWARDS } from '../src/economy/rewards';
import { EconomyError } from '../src/economy/money';
import * as money from '../src/economy/money';
import * as ledger from '../src/economy/ledger';
import * as trading from '../src/economy/trading';
import { ITEMS } from '../src/fashion/catalogue';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { RemoteEconomy } from '../src/economy/RemoteEconomy';
import { UnavailablePaymentGateway } from '../src/economy/payments/DiamondStore';

const T0 = Date.UTC(2026, 10, 18, 9);
const D0 = TEST_BALANCES[TEST_PLAYER].diamond; // 100 000 TEST diamonds since 2026-11-21 (was 100)
/** same state with the TEST player on a small diamond wallet (to exercise insufficient-funds rules) */
const lowD = (s: ReturnType<typeof initialState>, d = 100) => ({ ...s, accounts: { ...s.accounts, [TEST_PLAYER]: newAccount(TEST_PLAYER, 'Joueur test (toi)', 5000, d, T0) } });
const code = (f: () => unknown) => { try { f(); } catch (e) { return (e as EconomyError).code; } return 'ok'; };
const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('wallets & ledgers', () => {
  it('test player starts with 5,000 Gold and 100 000 Diamonds in separate ledgers', () => {
    const s = initialState(T0); const a = s.accounts[TEST_PLAYER];
    expect(a.gold.balance).toBe(5000); expect(a.diamond.balance).toBe(100000); expect(D0).toBe(100000); expect(a.test).toBe(true);
    expect(a.gold.currency).toBe('gold'); expect(a.diamond.currency).toBe('diamond');
    expect(a.gold.entries.every((e) => e.memo === 'Solde de TEST')).toBe(true);
  });
  it('rejects invalid amounts and negative balances', () => {
    const w = emptyWallet('gold', 0);
    for (const bad of [0, -5, 1.5, NaN, Infinity, '10' as unknown as number]) expect(code(() => post(w, 'reward', bad, 't', T0))).toBe('invalid_amount');
    const w2 = post(w, 'reward', 50, 'r1', T0); expect(code(() => post(w2, 'purchase', 51, 'p1', T0))).toBe('insufficient_funds');
    expect(post(w2, 'purchase', 50, 'p1', T0).balance).toBe(0);
  });
  it('is idempotent per txId (no duplicated credits on retry) and auditable', () => {
    let w = emptyWallet('gold', 0); w = post(w, 'reward', 100, 'tx1', T0); w = post(w, 'reward', 100, 'tx1', T0);
    expect(w.balance).toBe(100); expect(w.entries).toHaveLength(1); expect(audit(w)).toBe(true);
  });
  it('diamond ledger refuses every trade/transfer kind', () => {
    const d = emptyWallet('diamond', 0);
    for (const k of ['trade_escrow', 'trade_receive', 'trade_release', 'reward', 'furniture'])
      expect(code(() => post(d, k as never, 5, 'x', T0))).toBe('not_transferable');
  });
  it('has no Gold<->Diamond conversion path anywhere in the economy API', () => {
    const names = [...Object.keys(money), ...Object.keys(ledger), ...Object.keys(trading), ...Object.getOwnPropertyNames(LocalDevEconomy.prototype)];
    expect(names.filter((n) => /convert|exchange|swap|toGold|toDiamond/i.test(n))).toEqual([]);
  });
});

describe('purchases', () => {
  it('quotes a mixed cart per currency and rejects duplicates / unknown items', () => {
    const q = quoteCart(['tee_stripes', 'jacket_bomber_gold', 'acc_glasses_round'], ITEMS);
    expect(q.totals).toEqual({ gold: 180 + 120, diamond: 45 });
    expect(code(() => quoteCart(['tee_stripes', 'tee_stripes'], ITEMS))).toBe('duplicate_in_cart');
    expect(code(() => quoteCart(['nope'], ITEMS))).toBe('unknown_item');
    expect(code(() => quoteCart([], ITEMS))).toBe('empty_cart');
  });
  it('checks out a mixed cart atomically, binds diamond items, blocks re-buying', () => {
    const s = initialState(T0);
    const r = checkout(s, TEST_PLAYER, ['tee_stripes', 'jacket_bomber_gold'], ITEMS, 'c1', T0);
    const a = r.state.accounts[TEST_PLAYER];
    expect(a.gold.balance).toBe(5000 - 180); expect(a.diamond.balance).toBe(D0 - 45);
    expect(a.owned.jacket_bomber_gold.bound).toBe(true); expect(a.owned.tee_stripes.bound).toBe(false);
    expect(code(() => checkout(r.state, TEST_PLAYER, ['tee_stripes'], ITEMS, 'c2', T0))).toBe('already_owned');
    expect(checkout(r.state, TEST_PLAYER, ['tee_stripes', 'jacket_bomber_gold'], ITEMS, 'c1', T0).state).toBe(r.state); // replay
  });
  it('mixed cart with insufficient diamonds charges nothing (atomicity)', () => {
    const s = lowD(initialState(T0));
    const pricey = ['acc_crown', 'jacket_bomber_gold', 'tee_stripes']; // 60 + 45 = 105 diamonds > 100
    expect(code(() => checkout(s, TEST_PLAYER, pricey, ITEMS, 'c3', T0))).toBe('insufficient_funds');
    expect(s.accounts[TEST_PLAYER].gold.balance).toBe(5000); expect(s.accounts[TEST_PLAYER].owned).toEqual({});
  });
  it('the test balances can buy several items', () => {
    const s = initialState(T0);
    const r = checkout(s, TEST_PLAYER, ['hair_long', 'jacket_leather', 'tee_yoo', 'pants_jeans', 'shoes_boots', 'acc_sunglasses', 'hair_afro', 'eyes_cat'], ITEMS, 'c4', T0);
    expect(r.granted).toHaveLength(8); expect(r.state.accounts[TEST_PLAYER].gold.balance).toBeGreaterThan(0);
  });
});

describe('gold trading', () => {
  const setup = () => openTrade(initialState(T0), TEST_PLAYER, TEST_FRIEND, 't1', T0);
  it('requires both acceptances, escrows, then both confirmations', () => {
    let s = setup(); s = setOffer(s, 't1', TEST_PLAYER, { gold: 300 }, T0); s = setOffer(s, 't1', TEST_FRIEND, { gold: 50 }, T0);
    s = acceptTrade(s, 't1', TEST_PLAYER, T0); expect(s.trades.t1.status).toBe('open');
    s = acceptTrade(s, 't1', TEST_FRIEND, T0); expect(s.trades.t1.status).toBe('locked');
    expect(s.accounts[TEST_PLAYER].gold.balance).toBe(4700); // in escrow
    expect(code(() => setOffer(s, 't1', TEST_PLAYER, { gold: 1 }, T0))).toBe('trade_state');
    s = confirmTrade(s, 't1', TEST_PLAYER, T0); expect(s.trades.t1.status).toBe('locked');
    s = confirmTrade(s, 't1', TEST_FRIEND, T0); expect(s.trades.t1.status).toBe('completed');
    expect(s.accounts[TEST_PLAYER].gold.balance).toBe(5000 - 300 + 50); expect(s.accounts[TEST_FRIEND].gold.balance).toBe(2000 - 50 + 300);
    expect(confirmTrade(s, 't1', TEST_FRIEND, T0)).toBe(s); // idempotent
    expect(audit(s.accounts[TEST_PLAYER].gold)).toBe(true); expect(audit(s.accounts[TEST_FRIEND].gold)).toBe(true);
    // diamonds untouched
    expect(s.accounts[TEST_PLAYER].diamond.balance).toBe(D0); expect(s.accounts[TEST_FRIEND].diamond.balance).toBe(0);
  });
  it('changing an offer resets acceptances', () => {
    let s = setup(); s = setOffer(s, 't1', TEST_PLAYER, { gold: 10 }, T0); s = acceptTrade(s, 't1', TEST_FRIEND, T0);
    s = setOffer(s, 't1', TEST_PLAYER, { gold: 5 }, T0); expect(s.trades.t1.b.accepted).toBe(false);
  });
  it('reject after lock refunds the escrow', () => {
    let s = setup(); s = setOffer(s, 't1', TEST_PLAYER, { gold: 200 }, T0); s = acceptTrade(s, 't1', TEST_PLAYER, T0); s = acceptTrade(s, 't1', TEST_FRIEND, T0);
    s = rejectTrade(s, 't1', TEST_FRIEND, T0); expect(s.trades.t1.status).toBe('rejected'); expect(s.accounts[TEST_PLAYER].gold.balance).toBe(5000);
    expect(code(() => confirmTrade(s, 't1', TEST_PLAYER, T0))).toBe('trade_state');
  });
  it('validates balances and prevents double spending across trades and the shop', () => {
    let s = setup(); expect(code(() => setOffer(s, 't1', TEST_FRIEND, { gold: 2001 }, T0))).toBe('insufficient_funds');
    s = openTrade(s, TEST_FRIEND, TEST_PLAYER, 't2', T0);
    s = setOffer(s, 't1', TEST_FRIEND, { gold: 1500 }, T0); s = setOffer(s, 't2', TEST_FRIEND, { gold: 1500 }, T0); // both fine while open
    s = acceptTrade(s, 't1', TEST_FRIEND, T0); s = acceptTrade(s, 't1', TEST_PLAYER, T0); // t1 locks 1500 in escrow
    s = acceptTrade(s, 't2', TEST_FRIEND, T0);
    expect(code(() => acceptTrade(s, 't2', TEST_PLAYER, T0))).toBe('insufficient_funds'); // only 500 left
    expect(s.accounts[TEST_FRIEND].gold.balance).toBe(500);
  });
  it('diamonds can never be offered', () => {
    const s = setup();
    expect(code(() => setOffer(s, 't1', TEST_PLAYER, { diamond: 5 }, T0))).toBe('not_transferable');
    expect(code(() => setOffer(s, 't1', TEST_PLAYER, { gold: 5, diamonds: 1 }, T0))).toBe('not_transferable');
    expect(code(() => sanitizeOffer({ items: ['acc_crown'] }))).toBe('not_transferable');
    expect(code(() => setOffer(s, 't1', TEST_PLAYER, { gold: -5 }, T0))).toBe('invalid_amount');
  });
  it('cannot trade with yourself or outsiders', () => {
    expect(code(() => openTrade(initialState(T0), TEST_PLAYER, TEST_PLAYER, 'x', T0))).toBe('trade_self');
    expect(code(() => acceptTrade(setup(), 't1', 'stranger', T0))).toBe('trade_not_participant');
  });
});

describe('gold rewards', () => {
  it('daily reward once per cooldown', () => {
    let s = claimDaily(initialState(T0), TEST_PLAYER, T0); expect(s.accounts[TEST_PLAYER].gold.balance).toBe(5000 + REWARDS.daily.gold);
    expect(code(() => claimDaily(s, TEST_PLAYER, T0 + 3600_000))).toBe('reward_cooldown');
    s = claimDaily(s, TEST_PLAYER, T0 + REWARDS.daily.cooldownMs + 1); expect(s.accounts[TEST_PLAYER].gold.balance).toBe(5000 + 2 * REWARDS.daily.gold);
  });
  it('activities pay per period with a daily cap', () => {
    let s = initialState(T0); let total = 0;
    for (let i = 0; i < 100; i++) { const r = addActivity(s, TEST_PLAYER, 'dance', 31, T0 + i); s = r.state; total += r.paid; }
    expect(total).toBe(REWARDS.dance.capPerDay);
    const r = addActivity(s, TEST_PLAYER, 'dance', 29, T0 + 86400_000); expect(r.paid).toBe(0); // carry, new day
    expect(addActivity(r.state, TEST_PLAYER, 'dance', 1, T0 + 86400_001).paid).toBe(REWARDS.dance.gold);
  });
});

describe('LocalDevEconomy / RemoteEconomy / payments', () => {
  it('persists, switches test accounts, grants DEV diamonds with a clear memo', async () => {
    const k = kv(); const e = new LocalDevEconomy(k, 'eco', () => T0);
    await e.checkout(['tee_heart'], 'k1'); await e.devGrantDiamonds(50);
    expect(e.snapshot().account.diamond.entries.at(-1)!.memo).toMatch(/DEV — aucun paiement réel/);
    const e2 = new LocalDevEconomy(k, 'eco', () => T0); expect(e2.owns('tee_heart')).toBe(true); expect(e2.snapshot().account.diamond.balance).toBe(D0 + 50);
    e2.switchAccount(TEST_FRIEND); expect(e2.owns('tee_heart')).toBe(false); expect(e2.snapshot().account.gold.balance).toBe(2000);
    await expect(e2.devGrantDiamonds(5000)).rejects.toThrow();
  });
  it('furniture gold uses the same wallet and cannot go negative', () => {
    const e = new LocalDevEconomy(kv().m.size ? kv() : kv(), 'eco', () => T0);
    e.spendGoldSync(100, 'Canapé', 'f1'); expect(e.goldBalance()).toBe(4900);
    expect(() => e.spendGoldSync(999999, 'x', 'f2')).toThrow(); expect(e.goldBalance()).toBe(4900);
  });
  it('remote economy refuses everything (no server) and never grants dev diamonds', async () => {
    const r = new RemoteEconomy('https://example.invalid');
    await expect(r.checkout()).rejects.toMatchObject({ code: 'server_required' });
    await expect(r.devGrantDiamonds()).rejects.toMatchObject({ code: 'dev_only' });
  });
  it('payment gateway is unavailable and never confirms a payment', async () => {
    const g = new UnavailablePaymentGateway(); expect(g.available).toBe(false);
    await expect(g.createOrder()).rejects.toThrow(/non activés/);
  });
});
