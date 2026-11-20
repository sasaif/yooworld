import { EnvKV, memoryStorage, type RawStorage } from './prefixedKV';
import { SAVE_ENV } from './saveEnv';
/** Composition root for Web Storage (P0.A). Every module gets its KV from here; nothing else in src/ may
 *  reference localStorage / sessionStorage directly (enforced by tests/save-env.test.ts).
 *  ?fresh / ?shot / ?thumbs: saves + economy live in memory (no persistent write); UI prefs stay persistent
 *  (namespaced) so capture tools can still preset the camera/controls. */
const safe = (get: () => Storage): RawStorage => { try { const s = get(); if (s) return s; } catch { /* private mode / node */ } return memoryStorage(); };
const search = typeof location !== 'undefined' ? location.search : '';
const q = new URLSearchParams(search);
export const FRESH = q.has('shot') || q.has('fresh') || q.has('thumbs');
const local = safe(() => localStorage); const session = safe(() => sessionStorage);
export const storage = {
  env: SAVE_ENV,
  /** saves, economy, looks, backups */
  data: new EnvKV(SAVE_ENV, FRESH ? memoryStorage() : local, 'data'),
  /** persistent UI preferences (camera view, controls, chat, places badge, hair sheen …) */
  prefs: new EnvKV(SAVE_ENV, local, 'pref'),
  /** per-tab UI flags (rotate prompt skipped, default lieu used) */
  session: new EnvKV(SAVE_ENV, session, 'pref'),
};
/** Chat panel layout only (position / size of the movable chat panel). Its own namespace `ywchatui.<env>.<name>`,
 *  outside every save keyspace (yooworld:*, yw.*, yw:e:*): never read by saves, backups or the economy. */
export const CHAT_UI_PREFIX = 'ywchatui.';
export const chatUiKey = (name: string) => `${CHAT_UI_PREFIX}${SAVE_ENV.tag}.${name}`;
export const chatUi = {
  getItem: (name: string) => { try { return local.getItem(chatUiKey(name)); } catch { return null; } },
  setItem: (name: string, v: string) => { try { local.setItem(chatUiKey(name), v); } catch { /* private mode */ } },
  removeItem: (name: string) => { try { local.removeItem(chatUiKey(name)); } catch { /* */ } },
};
