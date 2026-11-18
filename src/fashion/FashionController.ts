import { Store } from '../core/store';
import { CATEGORIES, ITEMS, OPTIONAL_SLOTS, fitsBody, isFree } from './catalogue';
import { DEFAULT_LOOK, cloneLook, equip, revertUnowned, sameLook, unequip, unownedItems } from './look';
import type { Body, ItemDef, Look, ShopCategory, Slot } from './types';
import type { EconomyService } from '../economy/EconomyService';
import { newTxId } from '../economy/EconomyService';
import { EconomyError, zeroTotals, type Totals } from '../economy/money';
import type { Activity } from '../economy/rewards';
/** Avatar-customisation + shop UI state. Talks to the economy ONLY through EconomyService
 *  (so the same UI works with the future server-authoritative RemoteEconomy). */
export type StudioTab = 'shop' | 'owned' | 'equipped' | 'trade' | 'wallet';
export interface Studio { body: Body; base: Look; draft: Look; cat: ShopCategory; tab: StudioTab; selected: string | null; confirm: boolean; leaving: boolean; compare: boolean }
export interface FashionState { looks: Record<Body, Look>; studio: Studio | null; msg: { text: string; kind: 'ok' | 'err' | 'gold'; at: number } | null; ecoRev: number }
const ERR: Partial<Record<string, string>> = {
  insufficient_funds: 'Solde insuffisant', already_owned: 'Déjà dans tes articles', duplicate_in_cart: 'Article en double', empty_cart: 'Panier vide', not_transferable: 'Les diamants ne sont pas échangeables',
  trade_state: 'Action impossible à cette étape', reward_cooldown: 'Déjà réclamée — reviens plus tard', invalid_amount: 'Montant invalide', trade_self: 'Choisis un autre compte',
};
export const errText = (e: unknown) => (e instanceof EconomyError ? ERR[e.code] ?? e.message : e instanceof Error ? e.message : String(e));

export class FashionController {
  readonly store: Store<FashionState>;
  constructor(readonly eco: EconomyService) {
    const looks = { f: eco.loadLook('f') ?? cloneLook(DEFAULT_LOOK.f), m: eco.loadLook('m') ?? cloneLook(DEFAULT_LOOK.m) };
    this.store = new Store<FashionState>({ looks, studio: null, msg: null, ecoRev: 0 });
    eco.subscribe(() => this.store.set((s) => ({ ecoRev: s.ecoRev + 1 })));
  }
  get s() { return this.store.get(); }
  private say(text: string, kind: 'ok' | 'err' | 'gold' = 'ok') { const at = Date.now(); this.store.set({ msg: { text, kind, at } }); setTimeout(() => { if (this.s.msg?.at === at) this.store.set({ msg: null }); }, 2600); }
  private patch(p: Partial<Studio>) { const st = this.s.studio; if (st) this.store.set({ studio: { ...st, ...p } }); }
  owns = (id: string) => this.eco.owns(id);
  /** look currently shown for a body (live try-on while the studio edits it) */
  lookFor(body: Body) { const st = this.s.studio; return st && st.body === body ? st.draft : this.s.looks[body]; }

  // ---------- studio ----------
  open(body: Body, cat: ShopCategory = 'hair', tab: StudioTab = 'shop') { const base = this.s.looks[body]; this.store.set({ studio: { body, base, draft: cloneLook(base), cat, tab, selected: null, confirm: false, leaving: false, compare: false } }); }
  setCat(cat: ShopCategory) { this.patch({ cat, tab: this.s.studio?.tab === 'trade' || this.s.studio?.tab === 'wallet' ? 'shop' : this.s.studio?.tab, selected: null }); }
  setTab(tab: StudioTab) { this.patch({ tab, selected: null }); }
  setCompare(on: boolean) { this.patch({ compare: on }); }
  switchBody(body: Body) {
    const st = this.s.studio; if (!st || st.body === body) return;
    if (this.cart().length) { this.patch({ leaving: true }); return; }
    this.open(body, st.cat === 'beard' && body === 'f' ? 'hair' : st.cat, st.tab);
  }
  /** tap on an item card: try it on (or take it off when it is an optional slot already worn) */
  tap(id: string) {
    const st = this.s.studio; const it = ITEMS[id]; if (!st || !it) return;
    if (!fitsBody(it, st.body)) return this.say('Réservé à l’avatar homme', 'err');
    const worn = st.draft.slots[it.slot] === id;
    const draft = worn && OPTIONAL_SLOTS.includes(it.slot) ? unequip(st.draft, it.slot) : equip(st.draft, id);
    this.patch({ draft, selected: id });
  }
  unequipSlot(slot: Slot) { const st = this.s.studio; if (st) this.patch({ draft: unequip(st.draft, slot) }); }
  removeFromCart(id: string) { const st = this.s.studio; const it = ITEMS[id]; if (!st || !it) return; const prev = st.base.slots[it.slot];
    this.patch({ draft: prev && prev !== id ? { ...st.draft, slots: { ...st.draft.slots, [it.slot]: prev } } : unequip(st.draft, it.slot) }); }
  clearCart() { const st = this.s.studio; if (st) this.patch({ draft: revertUnowned(st.draft, st.base, this.owns) }); }
  cart(): ItemDef[] { const st = this.s.studio; return st ? unownedItems(st.draft, this.owns) : []; }
  totals(items = this.cart()): Totals { const t = zeroTotals(); for (const i of items) if (i.price) t[i.price.currency] += i.price.amount; return t; }
  canAfford(t: Totals) { const a = this.eco.snapshot().account; return a.gold.balance >= t.gold && a.diamond.balance >= t.diamond; }
  askConfirm(on = true) { this.patch({ confirm: on }); }
  async buy(ids: string[]) {
    const st = this.s.studio; if (!st) return false;
    try { await this.eco.checkout(ids, newTxId('checkout')); const n = ids.length; this.say(n > 1 ? `🎉 ${n} articles achetés !` : `🎉 ${ITEMS[ids[0]].name} acheté !`, 'ok'); this.patch({ confirm: false }); await this.saveDraft(); return true; }
    catch (e) { this.say(errText(e), 'err'); return false; }
  }
  buyCart() { return this.buy(this.cart().map((i) => i.id)); }
  /** saves the draft as the avatar look (only owned/free items are kept) */
  async saveDraft() {
    const st = this.s.studio; if (!st) return; const look = revertUnowned(st.draft, st.base, this.owns);
    await this.eco.saveLook(look); this.store.set({ looks: { ...this.s.looks, [st.body]: look }, studio: { ...this.s.studio!, base: look, draft: unownedItems(st.draft, this.owns).length ? this.s.studio!.draft : look } });
  }
  /** close: if try-ons are not bought, ask (leaving=true) unless force */
  async close(force: 'keep-owned' | null = null) {
    const st = this.s.studio; if (!st) return;
    if (this.cart().length && !force) { this.patch({ leaving: true }); return; }
    await this.saveDraft(); this.store.set({ studio: null });
  }
  resetDraft() { const st = this.s.studio; if (st) this.patch({ draft: cloneLook(st.base) }); }
  dirty() { const st = this.s.studio; return !!st && !sameLook(st.draft, st.base); }
  itemsFor(cat: ShopCategory, body: Body) { return Object.values(ITEMS).filter((i) => i.category === cat && fitsBody(i, body)); }
  ownedItems(body: Body) { return Object.values(ITEMS).filter((i) => !isFree(i) && this.owns(i.id) && fitsBody(i, body)); }
  catOf(cat: ShopCategory) { return CATEGORIES.find((c) => c.id === cat)!; }
  // ---------- gold earning hooks ----------
  async activity(act: Activity, seconds: number) { try { const paid = await this.eco.reportActivity(act, seconds); if (paid > 0) this.say(`+${paid} 🪙 ${act === 'dance' ? 'pour la danse' : act === 'sit' ? 'pour la détente' : 'visite de Yoo Plage'}`, 'gold'); } catch { /* */ } }
  async daily() { try { const g = await this.eco.claimDaily(); this.say(`+${g} 🪙 récompense du jour !`, 'gold'); } catch (e) { this.say(errText(e), 'err'); } }
  notify(text: string, kind: 'ok' | 'err' | 'gold' = 'ok') { this.say(text, kind); }
}
