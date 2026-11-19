import { ITEMS } from '../fashion/catalogue';
import { sanitizeLook, serializeLook } from '../fashion/look';
import { fitsBody, isFree } from '../fashion/catalogue';
import type { Look } from '../fashion/types';
import { EconomyError, assertAmount } from './money';
import { post } from './ledger';
import { initialState, TEST_PLAYER, type EconomyState } from './bank';
import { checkout } from './purchase';
import { acceptTrade, confirmTrade, openTrade, rejectTrade, setOffer, type TradeOffer } from './trading';
import { addActivity, claimDaily, type Activity } from './rewards';
import type { EconomyService, EconomySnapshot } from './EconomyService';
import type { KV, SaveProblem } from '../persistence/LocalStorageRepository';
import type { SaveBackups } from '../persistence/backup';

/** DEVELOPMENT-ONLY economy: runs entirely on this device (localStorage). Balances are TEST balances,
 *  anybody can edit localStorage, so NOTHING here is secure — it exists to prototype the UX and to
 *  exercise the same pure rules (ledger/purchase/trading/rewards) the server will run later. */
export class LocalDevEconomy implements EconomyService {
  readonly mode = 'local-dev' as const;
  private s: EconomyState; private acting = TEST_PLAYER; private subs = new Set<() => void>(); private snap: EconomySnapshot | null = null;
  /** P0.B: set when the stored economy exists but cannot be used (corrupt / unknown version). The economy then
   *  runs on in-memory TEST balances and writes NOTHING (readOnly) until the player picks a recovery action. */
  problem: SaveProblem | null = null;
  readOnly = false;
  /** P0.B look quarantine: per `${account}:${body}`, slot -> item id this build does not know (kept in the save). */
  private lookQ = new Map<string, Record<string, string>>();
  private lookFallback = new Map<string, Record<string, string | undefined>>();
  /** `key`/look keys are LOGICAL names: in the app `kv` is storage.data, which namespaces them per save env. */
  constructor(private kv: KV, private key = 'eco:dev', private now: () => number = Date.now, private backups?: SaveBackups) {
    const raw = kv.getItem(key);
    if (raw === null || raw === '') { this.s = initialState(now()); this.save(); return; }
    let s: EconomyState | null = null; let detail = '';
    try { s = JSON.parse(raw) as EconomyState; } catch (e) { detail = String((e as Error).message ?? e).slice(0, 120); }
    const v = (s as { version?: unknown } | null)?.version;
    if (s && v === 1 && s.accounts?.[TEST_PLAYER]) { this.s = s; return; } // valid: nothing to write
    const kind = s && typeof v === 'number' && v > 1 ? 'future_schema' : s ? 'invalid' : 'corrupt';
    this.problem = { key, kind, detail: detail || (kind === 'future_schema' ? `economy version ${String(v)} > 1 (newer build)` : 'unexpected economy shape') };
    backups?.keepRaw(key, raw, kind);
    this.readOnly = true; this.s = initialState(now()); // in memory only: the stored blob is NOT overwritten
  }
  private save() { if (!this.readOnly) this.kv.setItem(this.key, JSON.stringify(this.s)); this.snap = null; this.subs.forEach((f) => f()); }
  /** Recovery "temporary session": keep playing on memory-only TEST balances (also used when the game save is unreadable). */
  enterTemporary() { this.readOnly = true; this.subs.forEach((f) => f()); }
  private commit(next: EconomyState) { this.s = next; this.save(); }
  private get acc() { return this.s.accounts[this.acting]; }
  snapshot(): EconomySnapshot {
    if (!this.snap) this.snap = { mode: this.mode, account: this.acc, accounts: Object.values(this.s.accounts), trades: Object.values(this.s.trades).sort((a, b) => b.updatedAt - a.updatedAt) };
    return this.snap;
  }
  subscribe(cb: () => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
  currentAccount() { return this.acting; }
  switchAccount(id: string) { if (!this.s.accounts[id]) throw new EconomyError('unknown_account'); this.acting = id; this.snap = null; this.subs.forEach((f) => f()); }
  /** An owned id this build's catalogue does not know is still owned (P0.B: never lose purchases across builds). */
  owns(itemId: string, accountId = this.acting) { const it = ITEMS[itemId]; const has = !!this.s.accounts[accountId]?.owned[itemId]; return it ? (!it.price || has) : has; }
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
  private lookKey(body: Look['body']) { return `look:${this.acting}:${body}`; }
  /** Saves the look; slots quarantined at load (unknown ids) are written back in `q` unless the player has since
   *  chosen another item for that slot (an explicit choice, not a silent drop). */
  async saveLook(look: Look) {
    const id = `${this.acting}:${look.body}`; const clean = sanitizeLook(look, (i) => this.owns(i));
    const q: Record<string, string> = {}; const prevQ = this.lookQ.get(id) ?? {}; const fb = this.lookFallback.get(id) ?? {};
    for (const [slot, item] of Object.entries(prevQ)) if ((clean.slots as Record<string, string | undefined>)[slot] === fb[slot]) q[slot] = item;
    this.lookQ.set(id, q);
    const out = Object.keys(q).length ? JSON.stringify({ v: 1, body: clean.body, slots: clean.slots, q }) : serializeLook(clean);
    if (!this.readOnly) this.kv.setItem(this.lookKey(look.body), out);
    this.subs.forEach((f) => f());
  }
  /** Loads a look without dropping anything: ids unknown to this build go to the quarantine `q`; quarantined ids
   *  this build knows again (and the player owns) are restored. An unreadable record is kept (raw backup), not reset. */
  loadLook(body: Look['body']) {
    const k = this.lookKey(body); const raw = this.kv.getItem(k); if (!raw) return null;
    const id = `${this.acting}:${body}`;
    let r: { slots?: Record<string, unknown>; q?: Record<string, unknown> } & Record<string, unknown>;
    try { r = JSON.parse(raw); if (!r || typeof r !== 'object') throw new Error('not an object'); }
    catch { this.backups?.keepRaw(k, raw, 'corrupt'); this.lookQ.set(id, {}); return null; }
    const slots: Record<string, unknown> = { ...(r.slots ?? {}) }; const q: Record<string, string> = {};
    for (const [slot, it] of Object.entries(r.q ?? {})) if (typeof it === 'string') q[slot] = it;
    for (const [slot, it] of Object.entries(slots)) if (typeof it === 'string' && !ITEMS[it]) { q[slot] = it; delete slots[slot]; }
    for (const [slot, it] of Object.entries(q)) {
      const def = ITEMS[it];
      if (def && def.slot === slot && fitsBody(def, body) && (isFree(def) || this.owns(it))) { slots[slot] = it; delete q[slot]; }
    }
    const look = sanitizeLook({ ...r, slots }, (i) => this.owns(i));
    const fb: Record<string, string | undefined> = {}; for (const slot of Object.keys(q)) fb[slot] = (look.slots as Record<string, string | undefined>)[slot];
    this.lookQ.set(id, q); this.lookFallback.set(id, fb);
    return look;
  }
  /** quarantined look slots (diagnostics / recovery UI) */
  quarantinedLook(body: Look['body']) { return { ...(this.lookQ.get(`${this.acting}:${body}`) ?? {}) }; }
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
  resetDev() {
    this.backups?.snapshot('reset test economy'); // explicit, user-confirmed reset: snapshot first (P0.B)
    this.s = initialState(this.now()); for (const b of ['f', 'm']) for (const id of Object.keys(this.s.accounts)) this.kv.removeItem(`look:${id}:${b}`);
    this.problem = null; this.readOnly = false; this.lookQ.clear(); this.lookFallback.clear(); this.save();
  }
  debugState() { return this.s; }
}
