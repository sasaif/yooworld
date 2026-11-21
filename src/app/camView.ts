import { Store } from '../core/store';
import type { KV } from '../persistence/LocalStorageRepository';
import { storage } from '../persistence/storage';
/** Optional camera framing chosen with the 🔍 HUD button. Pure parts are unit-tested.
 *  'room'   = Vue appartement: the whole room fitted to the screen (× variant zoom)
 *  'avatar' = Vue perso: closer, centred on and following the player's own avatar */
export type CamView = 'room' | 'avatar';
/** logical pref name (stored as yw.camView in prod, yw:e:<env>:camView elsewhere — see persistence/saveEnv.ts) */
export const CAM_VIEW_KEY = 'camView';
export const AVATAR_VIEW_MUL = 2.0;
export const CAM_VIEW_LABEL: Record<CamView, string> = { room: 'Vue appartement', avatar: 'Vue perso' };
export const nextCamView = (v: CamView): CamView => (v === 'room' ? 'avatar' : 'room');
export function loadCamView(kv: Pick<KV, 'getItem'> | null): CamView {
  try { return kv?.getItem(CAM_VIEW_KEY) === 'avatar' ? 'avatar' : 'room'; } catch { return 'room'; }
}
export function saveCamView(kv: Pick<KV, 'setItem'> | null, v: CamView) { try { kv?.setItem(CAM_VIEW_KEY, v); } catch { /* private mode */ } }
/** Zoom multiplier (on the fitted room zoom) and follow lean for a framing. */
export const camViewZoomMul = (v: CamView, variantMul: number) => (v === 'avatar' ? Math.max(AVATAR_VIEW_MUL, variantMul * 1.5) : variantMul);
export const camViewFollow = (v: CamView, variantFollow: number) => (v === 'avatar' ? 0 : variantFollow);

const ls = (): KV | null => storage.prefs;
/** Every launch opens in 'Vue appartement' (owner decision, Alessandro 21/11/2026: "quand j ouvre le jeux la camera s ouvre
 *  en mode perso et normalement sa doit ouvrir en vu appart"). The 🔍 toggle is still saved under the same key
 *  (yw.camView / yw:e:<env>:camView) but no longer restored at launch: no save-format change, no migration. */
export const LAUNCH_CAM_VIEW: CamView = 'room';
export const camStore = new Store<{ view: CamView }>({ view: LAUNCH_CAM_VIEW });
export function toggleCamView() {
  const view = nextCamView(camStore.get().view); camStore.set({ view }); saveCamView(ls(), view);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('yw:follow')); // re-centre on the avatar / room
  return view;
}
