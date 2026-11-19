/**
 * Floor double-tap detection (touch double-tap = run). Pure + unit-tested (tests/double-tap.test.ts).
 * Bug fixed Nov 2026: in ApartmentView / BeachView the `lastTap.current = …` update sat inside a trailing line comment,
 * so the previous tap was never recorded and the timing test could never succeed (only a mouse's own click count did).
 */
export const DOUBLE_TAP = { ms: 380, dist: 0.6 } as const;
export interface TapMemo { t: number; x: number; z: number }
export const newTapMemo = (): TapMemo => ({ t: -1e9, x: 0, z: 0 });
/** Record a tap at (x, z) at time `now` (ms) and tell whether it completes a double tap. `clicks` = browser click count. */
export function registerTap(m: TapMemo, now: number, x: number, z: number, clicks = 0): boolean {
  const dbl = (now - m.t < DOUBLE_TAP.ms && Math.hypot(x - m.x, z - m.z) < DOUBLE_TAP.dist) || clicks >= 2;
  // a completed double tap is consumed: a third quick tap starts a new pair
  if (dbl) { m.t = -1e9; } else { m.t = now; m.x = x; m.z = z; }
  return dbl;
}
