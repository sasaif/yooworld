/**
 * Shared analog-stick state, written by the VirtualJoystick DOM component (pointer events) and by the
 * keyboard (desktop WASD / arrows), read once per frame by the game loop. Plain mutable object: no React
 * state, no re-render per pointer move. Pure helpers are unit-tested.
 */
export interface StickState { active: boolean; pointerId: number | null; x: number; y: number; mag: number }
export const stick: StickState = { active: false, pointerId: null, x: 0, y: 0, mag: 0 };

/** Finger offset (CSS px from the base centre) → normalised stick vector clamped to the unit disc. */
export function stickFromOffset(dx: number, dy: number, radius: number) {
  const len = Math.hypot(dx, dy); if (!len || radius <= 0) return { x: 0, y: 0, mag: 0 };
  const mag = Math.min(1, len / radius), k = mag / len;
  return { x: dx * k, y: dy * k, mag };
}
export function setStick(pointerId: number, x: number, y: number, mag: number) { stick.active = true; stick.pointerId = pointerId; stick.x = x; stick.y = y; stick.mag = mag; }
const resetListeners = new Set<() => void>();
/** Release / cancel / blur: back to centre, movement stops (the controller decelerates to 0 in ~0.1 s). */
export function resetStick() { stick.active = false; stick.pointerId = null; stick.x = 0; stick.y = 0; stick.mag = 0; keys.clear(); resetListeners.forEach((l) => l()); }
export function onStickReset(l: () => void) { resetListeners.add(l); return () => { resetListeners.delete(l); }; }

// ---- keyboard (desktop): WASD / ZQSD / arrows, Shift = walk slowly ----
const keys = new Set<string>();
const KEYMAP: Record<string, [number, number]> = {
  KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
export function keyboardVector(pressed: Iterable<string>, slow: boolean) {
  let x = 0, y = 0; for (const k of pressed) { const v = KEYMAP[k]; if (v) { x += v[0]; y += v[1]; } }
  const l = Math.hypot(x, y); if (!l) return { x: 0, y: 0, mag: 0 };
  const m = slow ? 0.5 : 1; return { x: (x / l) * m, y: (y / l) * m, mag: m };
}
let shift = false;
let enabled = true;
/** Off while a full-screen UI (style studio, decorate mode) is shown: keys go back to the page, stick resets. */
export function setInputEnabled(on: boolean) { if (enabled && !on) resetStick(); enabled = on; }
export const inputEnabled = () => enabled;
const typing = (t: EventTarget | null) => { const el = t as HTMLElement | null; return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable); };
let installed = false;
/** Window listeners: keyboard + "app lost focus" safety resets. Idempotent. */
export function installGlobalInput(opts: { keyboard: boolean }) {
  if (installed || typeof window === 'undefined') return; installed = true;
  if (opts.keyboard) {
    window.addEventListener('keydown', (e) => { if (!enabled || typing(e.target) || e.metaKey || e.ctrlKey || e.altKey) return; shift = e.shiftKey; if (KEYMAP[e.code]) { keys.add(e.code); e.preventDefault(); } });
    window.addEventListener('keyup', (e) => { shift = e.shiftKey; keys.delete(e.code); });
  }
  window.addEventListener('blur', resetStick);
  window.addEventListener('pagehide', resetStick);
  document.addEventListener('visibilitychange', () => { if (document.hidden) resetStick(); });
}
/** Current analog input for the game loop: the touch stick wins over the keyboard. */
export function readInput() {
  if (stick.active) return { x: stick.x, y: stick.y, mag: stick.mag, source: 'stick' as const };
  if (keys.size) { const k = keyboardVector(keys, shift); if (k.mag) return { ...k, source: 'keys' as const }; }
  return { x: 0, y: 0, mag: 0, source: 'none' as const };
}
