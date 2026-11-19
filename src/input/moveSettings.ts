import { Store } from '../core/store';
import { storage } from '../persistence/storage';

/**
 * Movement-control settings (persisted on the device, separate from the game save so old saves load unchanged).
 *  - touchTapToMove: touch screens — false = "Joystick seul" (default), true = "Joystick + toucher pour aller".
 * Mouse / pen clicks on the floor always walk there (desktop click-to-move), whatever this setting.
 */
export interface MoveSettings { touchTapToMove: boolean }
/** logical pref name (yw.controls.v1 in prod, yw:e:<env>:controls.v1 elsewhere) */
export const MOVE_SETTINGS_KEY = 'controls.v1';
export const DEFAULT_MOVE_SETTINGS: MoveSettings = { touchTapToMove: false };

type KV = Pick<Storage, 'getItem' | 'setItem'>;
const ls = (): KV | null => storage.prefs;

export function loadMoveSettings(kv: KV | null = ls()): MoveSettings {
  try {
    const raw = kv?.getItem(MOVE_SETTINGS_KEY); if (!raw) return { ...DEFAULT_MOVE_SETTINGS };
    const o = JSON.parse(raw) as Partial<MoveSettings>;
    return { touchTapToMove: typeof o.touchTapToMove === 'boolean' ? o.touchTapToMove : DEFAULT_MOVE_SETTINGS.touchTapToMove };
  } catch { return { ...DEFAULT_MOVE_SETTINGS }; }
}
export function saveMoveSettings(s: MoveSettings, kv: KV | null = ls()) { try { kv?.setItem(MOVE_SETTINGS_KEY, JSON.stringify(s)); } catch { /* private mode: keep in memory */ } }

export const moveSettings = new Store<MoveSettings>(loadMoveSettings());
export function setTouchTapToMove(on: boolean) { moveSettings.set({ touchTapToMove: on }); saveMoveSettings(moveSettings.get()); }

// ---- input-mode detection ----
export type PointerKind = 'mouse' | 'pen' | 'touch';
/** Pointer type of the last pointerdown anywhere in the page (capture phase): a floor "click" is attributed to it. */
let lastKind: PointerKind | null = null;
export function trackPointerKind(target: Pick<Window, 'addEventListener'> = window) {
  target.addEventListener('pointerdown', (e: Event) => { const t = (e as PointerEvent).pointerType; lastKind = t === 'touch' ? 'touch' : t === 'pen' ? 'pen' : 'mouse'; }, { capture: true, passive: true });
  target.addEventListener('touchstart', () => { lastKind = 'touch'; }, { capture: true, passive: true });
}
export const lastPointerKind = () => lastKind;
export function _setLastPointerKind(k: PointerKind | null) { lastKind = k; }

/** Primary input of the device (for defaults and labels): coarse pointer or touch screen without a fine hovering pointer = touch. */
export function primaryInput(coarse: boolean, touchPoints: number, fineHover: boolean): 'touch' | 'mouse' {
  return coarse || (touchPoints > 0 && !fineHover) ? 'touch' : 'mouse';
}

/**
 * Should a tap / click on a free floor location walk the avatar there?
 * Mouse and pen → always (click-to-move). Touch → only with the "toucher pour aller" setting.
 * Unknown pointer (no pointerdown seen, e.g. synthetic) → decided by the device's primary input.
 */
export function floorTapMoves(kind: PointerKind | null, s: MoveSettings, primary: 'touch' | 'mouse'): boolean {
  const k = kind ?? (primary === 'touch' ? 'touch' : 'mouse');
  return k === 'touch' ? s.touchTapToMove : true;
}
