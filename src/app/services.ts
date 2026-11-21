import * as THREE from 'three';
import { LIVE_AVATARS } from '../render/avatar/custom/CustomAvatar';
import { TEMPLE_FITS } from '../render/avatar/custom/glamGlasses';
import { equip } from '../fashion/look';
import { world } from '../game/world';
import { GameController } from '../game/GameController';
import { LocalStorageRepository } from '../persistence/LocalStorageRepository';
import { OfflineTransport } from '../net/NetworkTransport';
import { simTransportFromSearch } from '../net/SimTransport';
import { installChatSim } from '../dev/chatSim';
import { liveNetConfig } from '../net/live/netFlag';
import { LiveTransport } from '../net/live/LiveTransport';
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
/** QA trial-merge resolution (local only): `?net=1` LiveTransport wins; otherwise ?chatSim=1 | bc LOCAL SIMULATION; default offline. */
const NET_CFG = liveNetConfig(location.search, import.meta.env.VITE_YW_API_URL as string | undefined);
export const live = NET_CFG ? new LiveTransport(NET_CFG) : null;
const simNet = !live && typeof location !== 'undefined' ? simTransportFromSearch(location.search) : null;
export const game = new GameController(new LocalStorageRepository(storage.data, '', backups, { env: storage.env.id, buildId: storage.env.buildId }), live ?? simNet ?? new OfflineTransport(),
  { balance: () => economy.goldBalance(), spend: (amount, memo) => { try { economy.spendGoldSync(amount, memo, newTxId('furniture')); return true; } catch { return false; } } },
  { beforeReset: (reason) => backups.snapshot(reason) });
if (simNet) installChatSim(game, simNet);
if (live) {
  live.attach({ location: () => game.s.location, changed: () => game.store.set({}),
    local: () => { const c = world.chars[game.s.activeChar]; return c ? { x: c.pos.x, z: c.pos.z } : null; } });
  (window as unknown as Record<string, unknown>).__live = live; // e2e handle (flag on only)
}
/** P0.B: after a clean boot, keep a restore point of this env (deduplicated, ring of 3). */
let bootSnap = false;
game.store.subscribe(() => { if (game.s.ready && !game.s.temporary && !bootSnap) { bootSnap = true; if (!economy.problem) backups.snapshot('boot'); } });
Object.assign(window as unknown as Record<string, unknown>, { game, __world: world, economy, fashion, __saveEnv: storage.env, __backups: backups }); // debug / e2e handles

/** PERF probes only: per live avatar, meshes (= draw calls in the main pass) and triangles (outline hulls included). */
(window as unknown as Record<string, unknown>).__avatarStats = () => [...LIVE_AVATARS].map((a) => { let calls = 0, tris = 0; const names: string[] = [];
  a.holder.traverse((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.visible) return; calls++; const g = m.geometry; tris += (g.index ? g.index.count : g.getAttribute('position').count) / 3; if (m.name) names.push(m.name); });
  const bb = new THREE.Box3().setFromObject(a.holder); return { body: a.spec()?.body, top: a.spec()?.dress?.id ?? null, hair: a.spec()?.hair, calls, tris: Math.round(tris), names, min: bb.min.toArray(), max: bb.max.toArray() }; });
(window as unknown as Record<string, unknown>).__glam = { TEMPLE_FITS };
/** PERF / screenshots only: renders both avatars fully dressed (not saved, ignores ownership). */
(window as unknown as Record<string, unknown>).__dressAll = () => {
  const dress = (b: 'f' | 'm', ids: string[]) => ids.reduce((l, id) => equip(l, id), fashion.s.looks[b]);
  fashion.store.set({ looks: {
    f: dress('f', ['hair_long', 'jacket_hoodie', 'tee_stripes', 'pants_check', 'shoes_boots', 'acc_sunglasses', 'acc_earrings_hoops', 'acc_necklace_heart', 'acc_tote', 'acc_watch', 'acc_strawhat', 'det_freckles', 'mk_lip_red']),
    m: dress('m', ['beard_full', 'hair_manbun', 'jacket_leather', 'tee_white', 'pants_cargo', 'shoes_high', 'acc_glasses_round', 'acc_necklace_chain', 'acc_backpack', 'acc_watch', 'acc_cap', 'acc_scarf', 'acc_earrings_diamond']),
  } });
};
