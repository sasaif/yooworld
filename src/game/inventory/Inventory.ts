import type { Rarity } from '../../data/furniture';
/** Pure inventory & soft-currency logic (no real money). */
export interface Inventory { version: 1; ownerId: string; coins: number; items: Record<string, number> }
export interface Priced { id: string; price: number; rarity?: Rarity }
export const emptyInventory = (ownerId: string, coins = 500): Inventory => ({ version: 1, ownerId, coins, items: {} });
export function addItem(inv: Inventory, id: string, n = 1): Inventory { return { ...inv, items: { ...inv.items, [id]: (inv.items[id] ?? 0) + n } }; }
export function takeItem(inv: Inventory, id: string, n = 1): Inventory | null {
  const have = inv.items[id] ?? 0; if (have < n) return null;
  const items = { ...inv.items, [id]: have - n }; if (!items[id]) delete items[id];
  return { ...inv, items };
}
export function buy(inv: Inventory, item: Priced, n = 1): { ok: true; inv: Inventory } | { ok: false; reason: 'funds' } {
  const cost = item.price * n; if (inv.coins < cost) return { ok: false, reason: 'funds' };
  return { ok: true, inv: addItem({ ...inv, coins: inv.coins - cost }, item.id, n) };
}
export function spend(inv: Inventory, amount: number): Inventory | null { return inv.coins >= amount ? { ...inv, coins: inv.coins - amount } : null; }
export const count = (inv: Inventory) => Object.values(inv.items).reduce((a, b) => a + b, 0);
