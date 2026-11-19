import { MOVE_DEFAULTS, type MoveConfig } from './MovementController';

/**
 * Gameplay movement profile (owner, Nov 2026: "walking is too fast", progressive acceleration, feet in sync, optional run).
 *
 * - Walk (default): full stick = a walking pace 15 / 22 / 30 % below the former full-stick speed (1.9 m/s), selectable
 *   with `?walk=a|b|c` for side-by-side testing. The gait follows the actual speed with the clips' MEASURED stride
 *   speeds (animBlend.gaitBlend): feet planted at every speed the clips can render.
 * - Run (🏃 button next to the joystick, or R on a keyboard): full stick = the former 1.9 m/s with the run clip.
 * - Velocity follows the stick through a critically damped 2nd-order filter (`smooth`): the acceleration itself ramps
 *   up, so starts and stops ease in / out instead of the former near-instant exponential jump; no overshoot, exact
 *   at any frame rate.
 * - `?move=classic` keeps the former controller exactly (MOVE_DEFAULTS, 1st-order accel 14 / decel 32 1/s): the
 *   reference the e2e-joystick suite was written against.
 * All constants are here, tunable.
 */
export type WalkKey = 'a' | 'b' | 'c';
export const OLD_FULL_SPEED = MOVE_DEFAULTS.maxSpeed; // 1.9 m/s
export const WALK_PROFILES: Record<WalkKey, { speed: number; label: string }> = {
  a: { speed: +(OLD_FULL_SPEED * 0.85).toFixed(3), label: '−15 %' }, // 1.615 m/s
  b: { speed: +(OLD_FULL_SPEED * 0.78).toFixed(3), label: '−22 %' }, // 1.482 m/s
  c: { speed: +(OLD_FULL_SPEED * 0.70).toFixed(3), label: '−30 %' }, // 1.33 m/s
};
export const DEFAULT_WALK: WalkKey = 'b';
export const RUN_SPEED = OLD_FULL_SPEED;
/** natural frequencies (rad/s) of the critically damped velocity filter: 95 % of a start in ≈ 4.74/ω (0.47 s),
 *  95 % of a stop in ≈ 0.26 s (full stop ≈ 0.31 s); half of a start in ≈ 1.68/ω (0.17 s) so the stick still answers at once */
export const SMOOTH = { accel: 10, decel: 18 };

export interface MoveProfile { classic: boolean; walk: WalkKey }
export function readMoveProfile(search = typeof location !== 'undefined' ? location.search : ''): MoveProfile {
  const q = new URLSearchParams(search);
  const w = (q.get('walk') ?? '').toLowerCase();
  return { classic: q.get('move') === 'classic', walk: w === 'a' || w === 'b' || w === 'c' ? w : DEFAULT_WALK };
}
/** Controller config for the stick / keyboard. */
export function stickConfig(p: MoveProfile, running: boolean): MoveConfig {
  if (p.classic) return { ...MOVE_DEFAULTS };
  return { ...MOVE_DEFAULTS, maxSpeed: running ? RUN_SPEED : WALK_PROFILES[p.walk].speed, smooth: { ...SMOOTH } };
}
