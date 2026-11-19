import { MOVE_DEFAULTS, type MoveConfig } from './MovementController';
import { DEAD_ZONE, type Anchor } from './speedCurve';

/**
 * Gameplay movement profile: walk / run separation (owner, 19 Nov 2026).
 *
 * Two independent inputs:
 * - joystick INTENSITY (0..1, dead zone 10 %) → walking speed through a monotone curve (WALK_ANCHORS):
 *   slight push = slow walk, half push = normal walk, full push = fast walk. Never a run.
 * - movement MODE (walk | run) comes ONLY from the explicit 🏃 Run toggle (button, or R on a keyboard). Walk is the
 *   default and is never persisted. In run mode the same intensity curve scales up to the run speed.
 * The animation depends on mode + actual speed (animBlend.modeBlend): the run clip can only play in run mode.
 *
 * Initial targets (tunable on the real iPhone, `?speeds=slow,normal,fast,run` overrides them for testing):
 *   slow walk 1.2 m/s at 25 % · normal walk 1.5 m/s at 60 % · fast walk 1.8 m/s from 95 % · run 2.8 m/s.
 * Velocity follows the target through the critically damped 2nd-order filter (`SMOOTH`): starts, stops and walk ↔ run
 * changes ease in / out, with no overshoot, exact at any frame rate.
 * `?move=classic` keeps the former controller exactly (MOVE_DEFAULTS): the reference the e2e-joystick suite was written against.
 */
export interface GaitSpeeds { slow: number; normal: number; fast: number; run: number }
export const GAIT_SPEEDS: GaitSpeeds = { slow: 1.2, normal: 1.5, fast: 1.8, run: 2.8 };
/** stick displacement of each walking level (slight / half / full push) */
export const GAIT_POINTS = { slow: 0.25, normal: 0.60, fast: 0.95 } as const;
/** Intensity → fraction of the top speed of the current mode (fast walk, or run). Monotone cubic (speedCurve.ts). */
export function walkAnchors(s: GaitSpeeds = GAIT_SPEEDS): Anchor[] {
  return [[DEAD_ZONE, 0], [GAIT_POINTS.slow, s.slow / s.fast], [GAIT_POINTS.normal, s.normal / s.fast], [GAIT_POINTS.fast, 1], [1, 1]];
}
export const WALK_ANCHORS: readonly Anchor[] = walkAnchors();
export const RUN_SPEED = GAIT_SPEEDS.run;
/** natural frequencies (rad/s) of the critically damped velocity filter: 95 % of a start in ≈ 4.74/ω (0.47 s),
 *  95 % of a stop / of a run → walk slow-down in ≈ 0.26 s; half of a start in ≈ 1.68/ω (0.17 s) so the stick still answers at once */
export const SMOOTH = { accel: 10, decel: 18 };

export interface MoveProfile { classic: boolean; speeds: GaitSpeeds; anchors?: readonly Anchor[] }
/** `?speeds=1.2,1.5,1.8,2.8` (slow, normal, fast walk, run in m/s; must be increasing, 0.3–5 m/s) for tuning; anything else = defaults */
export function parseSpeeds(v: string | null): GaitSpeeds {
  const n = (v ?? '').split(',').map(Number);
  if (n.length !== 4 || n.some((x) => !Number.isFinite(x) || x < 0.3 || x > 5) || !(n[0] < n[1] && n[1] < n[2] && n[2] < n[3])) return { ...GAIT_SPEEDS };
  return { slow: n[0], normal: n[1], fast: n[2], run: n[3] };
}
export function readMoveProfile(search = typeof location !== 'undefined' ? location.search : ''): MoveProfile {
  const q = new URLSearchParams(search);
  const speeds = parseSpeeds(q.get('speeds'));
  return { classic: q.get('move') === 'classic', speeds, anchors: q.has('speeds') ? walkAnchors(speeds) : WALK_ANCHORS };
}
/** Controller config for the stick / keyboard: same intensity curve in both modes, top speed = fast walk or run. */
export function stickConfig(p: MoveProfile, running: boolean): MoveConfig {
  if (p.classic) return { ...MOVE_DEFAULTS };
  const anchors = p.anchors ?? walkAnchors(p.speeds);
  return { ...MOVE_DEFAULTS, maxSpeed: running ? p.speeds.run : p.speeds.fast, anchors, smooth: { ...SMOOTH } };
}
