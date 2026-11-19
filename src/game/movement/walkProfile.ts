import { MOVE_DEFAULTS, type MoveConfig } from './MovementController';
import { DEAD_ZONE, type Anchor } from './speedCurve';

/**
 * Gameplay movement profile: walk / run separation (owner, 19 Nov 2026; walk speed simplified the same evening).
 *
 * Two independent inputs:
 * - joystick INTENSITY: dead zone 10 %, then a short ramp that reaches full speed at 25 % stick and holds. Above the
 *   ramp, intensity no longer changes the speed — there is one walk and one run.
 * - movement MODE (walk | run) comes ONLY from the explicit 🏃 Run toggle (button, or R on a keyboard). Walk is the
 *   default and is never persisted.
 * Run off: that single walk is 1.2 m/s (the "slow walk" of the first comparison video: the Walk clip at ~2.79×, feet planted, run weight 0).
 * Run on: 2.8 m/s (the run from the comparison video). The same ramp/hold curve is used in both modes.
 *
 * Tunable on the iPhone with `?speeds=walk,run` (m/s). Velocity follows the target through the critically damped
 * 2nd-order filter (`SMOOTH`): starts, stops and the 2.8 → 1.2 Run-off slow-down ease in / out in ≈ 0.3 s, no
 * overshoot, exact at any frame rate.
 * `?move=classic` keeps the former controller exactly (MOVE_DEFAULTS): the reference the e2e-joystick suite was written against.
 */
export interface GaitSpeeds { walk: number; run: number }
export const GAIT_SPEEDS: GaitSpeeds = { walk: 1.2, run: 2.8 };
export const WALK_SPEED = GAIT_SPEEDS.walk;
export const RUN_SPEED = GAIT_SPEEDS.run;
/** stick displacement at which the short post-dead-zone ramp reaches full speed and holds */
export const FULL_FROM = 0.25;
/** Intensity → fraction of the top speed of the current mode (walk 1.2, or run 2.8). Monotone cubic (speedCurve.ts). */
export function gaitAnchors(): Anchor[] {
  return [[DEAD_ZONE, 0], [FULL_FROM, 1], [1, 1]];
}
export const GAIT_ANCHORS: readonly Anchor[] = gaitAnchors();
/** @deprecated alias kept so older tests/tools that imported WALK_ANCHORS still typecheck if any remain */
export const WALK_ANCHORS = GAIT_ANCHORS;
/** natural frequencies (rad/s) of the critically damped velocity filter: 95 % of a start in ≈ 4.74/ω (0.47 s),
 *  95 % of a stop / of a run → walk slow-down in ≈ 0.26 s; half of a start in ≈ 1.68/ω (0.17 s) so the stick still answers at once */
export const SMOOTH = { accel: 10, decel: 18 };

export interface MoveProfile { classic: boolean; speeds: GaitSpeeds }
/** `?speeds=1.2,2.8` (walk, run in m/s; walk < run, 0.3–5 m/s) for tuning; anything else = defaults */
export function parseSpeeds(v: string | null): GaitSpeeds {
  const n = (v ?? '').split(',').map(Number);
  if (n.length !== 2 || n.some((x) => !Number.isFinite(x) || x < 0.3 || x > 5) || !(n[0] < n[1])) return { ...GAIT_SPEEDS };
  return { walk: n[0], run: n[1] };
}
export function readMoveProfile(search = typeof location !== 'undefined' ? location.search : ''): MoveProfile {
  const q = new URLSearchParams(search);
  return { classic: q.get('move') === 'classic', speeds: parseSpeeds(q.get('speeds')) };
}
/** Controller config for the stick / keyboard: same ramp-then-hold curve in both modes, top speed = walk or run. */
export function stickConfig(p: MoveProfile, running: boolean): MoveConfig {
  if (p.classic) return { ...MOVE_DEFAULTS };
  return { ...MOVE_DEFAULTS, maxSpeed: running ? p.speeds.run : p.speeds.walk, anchors: GAIT_ANCHORS, smooth: { ...SMOOTH } };
}
