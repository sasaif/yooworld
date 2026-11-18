import { ITEMS } from '../fashion/catalogue';
import { sanitizeLook, serializeLook } from '../fashion/look';
import type { Look } from '../fashion/types';
import { EconomyError, assertAmount } from './money';
import { post } from './ledger';
import { initialState, TEST_PLAYER, type EconomyState } from './bank';
import { checkout } from './purchase';
import { acceptTrade, confirmTrade, openTrade, rejectTrade, setOffer, type TradeOffer } from './trading';
import { addActivity, claimDaily, type Activity } from './rewards';
import type { EconomyService, EconomySnapshot } from './EconomyService';
import type { KV } from '../persistence/LocalStorageRepository';

/** DEVELOPMENT-ONLY economy: runs entirely on this device (localStorage). Balances are TEST balances,
 *  anybody can edit localStorage, so NOTHING here is secure — it exists to prototype the UX and to
 *  exercise the same pure rules (ledger/purchase/trading/rewards) the server will run later. */
export class LocalDevEconomy implements EconomyService {
  readonly mode = 'local-dev' as const;
  private s: EconomyState; private acting = TEST_PLAYER; private subs = new Set<() => void>(); private snap: EconomySnapshot | null = null;
  constructor(private kv: KV, private key = 'yooworld:eco:dev', private now: () => number = Date.now) {
    let s: EconomyState | null = null;
    try { const raw = kv.getItem(key); if (raw) s = JSON.parse(raw) as EconomyState; } catch { s = null; }
    this.s = s && s.version === 1 && s.accounts?.[TEST_PLAYER] ? s : initialState(now());
    this.save();
  }
  private save() { this.kv.setItem(this.key, JSON.stringify(this.s)); this.snap = null; this.subs.forEach((f) => f()); }
  private commit(next: EconomyState) { this.s = next; this.save(); }
  private get acc() { return this.s.accounts[this.acting]; }
  snapshot(): EconomySnapshot {
    if (!this.snap) this.snap = { mode: this.mode, account: this.acc, accounts: Object.values(this.s.accounts), trades: Object.values(this.s.trades).sort((a, b) => b.updatedAt - a.updatedAt) };
    return this.snap;
  }
  subscribe(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  currentAccount() { return this.acting; }
  switchAccount(id: string) { if (!this.s.accounts[id]) throw new EconomyError('unknown_account'); this.acting = id; this.snap = null; this.subs.forEach((f) => f()); }
  owns(itemId: string, accountId = this.acting) { const it = ITEMS[itemId]; return !!it && (!it.price || !!this.s.accounts[accountId]?.owned[itemId]); }
  async checkout(itemIds: string[], key: string) { const r = checkout(this.s, this.acting, itemIds, ITEMS, key, this.now()); this.commit(r.state); return { granted: r.granted, totals: r.totals }; }
  async spendGold(amount: number, memo: string, key: string) { this.spendGoldSync(amount, memo, key); }
  /** synchronous variant for the (sync) furniture flows of GameController; throws on insufficient funds */
  spendGoldSync(amount: number, memo: string, key: string) {
    assertAmount(amount); const a = this.s.accounts[TEST_PLAYER];
    this.commit({ ...this.s, accounts: { ...this.s.accounts, [a.id]: { ...a, gold: post(a.gold, 'furniture', amount, key, this.now(), memo) } } });
  }
  goldBalance() { return this.s.accounts[TEST_PLAYER].gold.balance; }
  async claimDaily() { const before = this.acc.gold.balance; this.commit(claimDaily(this.s, this.acting, this.now())); return this.acc.gold.balance - before; }
  async reportActivity(act: Activity, seconds: number) { const r = addActivity(this.s, this.acting, act, seconds, this.now()); if (r.state !== this.s) this.commit(r.state); return r.paid; }
  async saveLook(look: Look) { this.kv.setItem(`yooworld:look:${this.acting}:${look.body}`, serializeLook(sanitizeLook(look, (id) => this.owns(id)))); this.subs.forEach((f) => f()); }
  loadLook(body: Look['body']) { const raw = this.kv.getItem(`yooworld:look:${this.acting}:${body}`); return raw ? sanitizeLook(JSON.parse(raw), (id) => this.owns(id)) : null; }
  async openTrade(withAccount: string, id: string) { this.commit(openTrade(this.s, this.acting, withAccount, id, this.now())); return this.s.trades[id]; }
  async setOffer(id: string, offer: TradeOffer) { this.commit(setOffer(this.s, id, this.acting, offer, this.now())); return this.s.trades[id]; }
  async acceptTrade(id: string) { this.commit(acceptTrade(this.s, id, this.acting, this.now())); return this.s.trades[id]; }
  async confirmTrade(id: string) { this.commit(confirmTrade(this.s, id, this.acting, this.now())); return this.s.trades[id]; }
  async rejectTrade(id: string, cancel = false) { this.commit(rejectTrade(this.s, id, this.acting, this.now(), cancel)); return this.s.trades[id]; }
  async devGrantDiamonds(amount: number) {
    assertAmount(amount); if (amount > 500) throw new EconomyError('invalid_amount', 'Max 500 en DEV');
    const a = this.acc; const txId = `dev:${a.id}:${this.now()}:${Math.random().toString(36).slice(2, 6)}`;
    this.commit({ ...this.s, accounts: { ...this.s.accounts, [a.id]: { ...a, diamond: post(a.diamond, 'dev_grant', amount, txId, this.now(), 'DEV — aucun paiement réel') } } });
  }
  /** wipe the dev economy back to TEST balances */
  resetDev() { this.s = initialState(this.now()); for (const b of ['f', 'm']) for (const id of Object.keys(this.s.accounts)) this.kv.removeItem(`yooworld:look:${id}:${b}`); this.save(); }
  debugState() { return this.s; }
}
