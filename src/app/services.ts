import { equip } from '../fashion/look';
import { world } from '../game/world';
import { GameController } from '../game/GameController';
import { LocalStorageRepository } from '../persistence/LocalStorageRepository';
import { OfflineTransport } from '../net/NetworkTransport';
import { LocalDevEconomy } from '../economy/LocalDevEconomy';
import { FashionController } from '../fashion/FashionController';
import { newTxId } from '../economy/EconomyService';
import { storage } from '../persistence/storage';
import { SaveBackups } from '../persistence/backup';
/** Composition root: pick implementations here (server repo / real transport / RemoteEconomy later).
 *  All persistence goes through storage.data = this build's save env only (P0.A; ?fresh = in memory). */
export const backups = new SaveBackups(storage.data, storage.env.id, storage.env.buildId);
/** DEV economy: local TEST balances only (5 000 Or / 100 Diamants), never real money. */
export const economy = new LocalDevEconomy(storage.data, 'eco:dev', Date.now, backups);
export const fashion = new FashionController(economy);
export const game = new GameController(new LocalStorageRepository(storage.data, '', backups, { env: storage.env.id, buildId: storage.env.buildId }), new OfflineTransport(),
  { balance: () => economy.goldBalance(), spend: (amount, memo) => { try { economy.spendGoldSync(amount, memo, newTxId('furniture')); return true; } catch { return false; } } },
  { beforeReset: (reason) => backups.snapshot(reason) });
/** P0.B: after a clean boot, keep a restore point of this env (deduplicated, ring of 3). */
let bootSnap = false;
game.store.subscribe(() => { if (game.s.ready && !game.s.temporary && !bootSnap) { bootSnap = true; if (!economy.problem) backups.snapshot('boot'); } });
Object.assign(window as unknown as Record<string, unknown>, { game, __world: world, economy, fashion, __saveEnv: storage.env, __backups: backups }); // debug / e2e handles

/** PERF / screenshots only: renders both avatars fully dressed (not saved, ignores ownership). */
(window as unknown as Record<string, unknown>).__dressAll = () => {
  const dress = (b: 'f' | 'm', ids: string[]) => ids.reduce((l, id) => equip(l, id), fashion.s.looks[b]);
  fashion.store.set({ looks: {
    f: dress('f', ['hair_long', 'jacket_hoodie', 'tee_stripes', 'pants_check', 'shoes_boots', 'acc_sunglasses', 'acc_earrings_hoops', 'acc_necklace_heart', 'acc_tote', 'acc_watch', 'acc_strawhat', 'det_freckles', 'mk_lip_red']),
    m: dress('m', ['beard_full', 'hair_manbun', 'jacket_leather', 'tee_white', 'pants_cargo', 'shoes_high', 'acc_glasses_round', 'acc_necklace_chain', 'acc_backpack', 'acc_watch', 'acc_cap', 'acc_scarf', 'acc_earrings_diamond']),
  } });
};
