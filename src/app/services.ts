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
