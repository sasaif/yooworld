import { equip } from '../fashion/look';
import { world } from '../game/world';
import { GameController } from '../game/GameController';
import { LocalStorageRepository, MemoryRepository, type KV } from '../persistence/LocalStorageRepository';
import { OfflineTransport } from '../net/NetworkTransport';
import { LocalDevEconomy } from '../economy/LocalDevEconomy';
import { FashionController } from '../fashion/FashionController';
import { newTxId } from '../economy/EconomyService';
/** Composition root: pick implementations here (server repo / real transport / RemoteEconomy later). */
const q = new URLSearchParams(location.search);
const fresh = q.has('shot') || q.has('fresh') || q.has('thumbs');
const memKV = (): KV => { const m = new Map<string, string>(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }; };
/** DEV economy: local TEST balances only (5 000 Or / 100 Diamants), never real money. */
export const economy = new LocalDevEconomy(fresh ? memKV() : localStorage);
export const fashion = new FashionController(economy);
export const game = new GameController(fresh ? new MemoryRepository() : new LocalStorageRepository(localStorage), new OfflineTransport(),
  { balance: () => economy.goldBalance(), spend: (amount, memo) => { try { economy.spendGoldSync(amount, memo, newTxId('furniture')); return true; } catch { return false; } } });
Object.assign(window as unknown as Record<string, unknown>, { game, __world: world, economy, fashion }); // debug / e2e handles

/** PERF / screenshots only: renders both avatars fully dressed (not saved, ignores ownership). */
(window as unknown as Record<string, unknown>).__dressAll = () => {
  const dress = (b: 'f' | 'm', ids: string[]) => ids.reduce((l, id) => equip(l, id), fashion.s.looks[b]);
  fashion.store.set({ looks: {
    f: dress('f', ['hair_long', 'jacket_hoodie', 'tee_stripes', 'pants_check', 'shoes_boots', 'acc_sunglasses', 'acc_earrings_hoops', 'acc_necklace_heart', 'acc_tote', 'acc_watch', 'acc_strawhat', 'det_freckles', 'mk_lip_red']),
    m: dress('m', ['beard_full', 'hair_manbun', 'jacket_leather', 'tee_white', 'pants_cargo', 'shoes_high', 'acc_glasses_round', 'acc_necklace_chain', 'acc_backpack', 'acc_watch', 'acc_cap', 'acc_scarf', 'acc_earrings_diamond']),
  } });
};
