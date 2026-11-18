import type { ItemDef } from '../fashion/types';
import { EconomyError, zeroTotals, type Totals } from './money';
import { post } from './ledger';
import type { Account, EconomyState } from './bank';
/** Purchase transactions (pure). A cart may mix Gold and Diamond items; checkout is ATOMIC:
 *  either every item is granted and both wallets are debited, or nothing changes. */
export interface Quote { items: ItemDef[]; totals: Totals; free: ItemDef[] }
export function quoteCart(ids: string[], catalogue: Record<string, ItemDef>): Quote {
  if (!ids.length) throw new EconomyError('empty_cart', 'Panier vide');
  const seen = new Set<string>(); const totals = zeroTotals(); const items: ItemDef[] = []; const free: ItemDef[] = [];
  for (const id of ids) {
    if (seen.has(id)) throw new EconomyError('duplicate_in_cart', `Article en double : ${id}`); seen.add(id);
    const it = catalogue[id]; if (!it) throw new EconomyError('unknown_item', `Article inconnu : ${id}`);
    if (!it.price) { free.push(it); continue; }
    totals[it.price.currency] += it.price.amount; items.push(it);
  }
  return { items, totals, free };
}
export interface CheckoutResult { state: EconomyState; granted: string[]; totals: Totals; txId: string }
export function checkout(state: EconomyState, accountId: string, ids: string[], catalogue: Record<string, ItemDef>, txId: string, at: number): CheckoutResult {
  const acc = state.accounts[accountId]; if (!acc) throw new EconomyError('unknown_account');
  // idempotency: the same checkout replayed (network retry) returns the already-applied result
  if (acc.gold.entries.some((e) => e.txId === txId) || acc.diamond.entries.some((e) => e.txId === txId) || Object.values(acc.owned).some((o) => o.txId === txId))
    return { state, granted: [], totals: zeroTotals(), txId };
  const q = quoteCart(ids, catalogue);
  for (const it of q.items) if (acc.owned[it.id]) throw new EconomyError('already_owned', `Déjà possédé : ${it.name}`);
  if (q.totals.gold > acc.gold.balance || q.totals.diamond > acc.diamond.balance) throw new EconomyError('insufficient_funds', 'Solde insuffisant');
  let next: Account = acc; // all-or-nothing: wallets are recomputed on copies, committed together
  const memo = q.items.map((i) => i.name).join(', ');
  if (q.totals.gold) next = { ...next, gold: post(next.gold, 'purchase', q.totals.gold, txId, at, memo) };
  if (q.totals.diamond) next = { ...next, diamond: post(next.diamond, 'purchase', q.totals.diamond, txId, at, memo) };
  const owned = { ...next.owned };
  for (const it of q.items) owned[it.id] = { itemId: it.id, acquiredAt: at, txId, currency: it.price!.currency, price: it.price!.amount, bound: it.price!.currency === 'diamond' };
  next = { ...next, owned };
  return { state: { ...state, accounts: { ...state.accounts, [accountId]: next } }, granted: q.items.map((i) => i.id), totals: q.totals, txId };
}
export const owns = (acc: Account, itemId: string, catalogue: Record<string, ItemDef>) => !catalogue[itemId]?.price || !!acc.owned[itemId];
