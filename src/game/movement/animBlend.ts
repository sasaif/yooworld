/**
 * Locomotion animation blend driven by the ACTUAL ground speed (m/s). Pure + unit-tested.
 * idle → walk below `vWalk`, walk → run between `vWalk` and the run threshold. Each clip's playback rate is
 * actualSpeed / clip's natural speed, so the feet never move faster than the body (capped at 1 below, and a
 * soft cap above where the next gait takes over).
 */
export interface Blend { idle: number; walk: number; run: number; walkTS: number; runTS: number }
export const BLEND = { idleTo: 0.3, runFrom: 1.3, runTo: 1.6, maxWalkTS: 1.6, maxRunTS: 1.2 };
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function locoBlend(speed: number, vWalk: number, vRun: number): Blend {
  const v = Math.max(0, speed);
  const moving = sstep(0, BLEND.idleTo * vWalk, v);
  const run = sstep(BLEND.runFrom * vWalk, Math.min(BLEND.runTo * vWalk, vRun), v);
  return {
    idle: 1 - moving, walk: moving * (1 - run), run: moving * run,
    walkTS: Math.min(v / vWalk, BLEND.maxWalkTS), runTS: Math.min(v / vRun, BLEND.maxRunTS),
  };
}

/**
 * Ground speed of each clip at playback rate 1, per unit of avatar scale (m/s), MEASURED in the live game
 * (tools/e2e-gameplay.mjs: backward speed of the planted foot relative to the hips). The walk clip's real stride is
 * ≈ 0.43 m/s at the avatars' scale, i.e. about half of LOCO.walk (0.85 × 1.14 = 0.97) that the classic blend assumes:
 * with it, every walk (tap-to-move, NPCs, stick) slid its feet forward by ≈ 50 % of the body speed. The run clip's
 * measurement (flight phases, fewer planted frames) agrees with LOCO.run within its noise, so it is kept.
 */
export const STRIDE = { walk: 0.377, run: 1.9 };
/**
 * playback-rate window in which the Walk and Run clips cross-fade (run mode only).
 * walkMaxSpeed: 1.2 m/s, the single walk (must match walkProfile.WALK_SPEED). In walk mode the Walk clip plays at
 *   speed / STRIDE.walk (≈ 2.79× at 1.2 m/s, feet planted — the "slow walk" of the first comparison video) and never
 *   faster, including the 0.3 s ease-down from 2.8 to 1.2, so a faster walk playback (the old 4.2× at 1.8 m/s) never
 *   plays while Run is off.
 * walkMaxTS / maxRunTS: run-mode caps. 2.8 m/s needs ≈ 1.29, ceiling 1.4; walkMaxTS keeps headroom if a low-speed
 *   run-mode walk clip must keep up.
 */
export const GAIT = { walkMaxTS: 4.6, runFrom: 1.9 * STRIDE.walk, runMinTS: 0.55, maxRunTS: 1.4, walkMaxSpeed: 1.2 };
export type GaitMode = 'walk' | 'run';
/**
 * Mode-aware gait (default profile). 041d39a walk-mode clip selection, with the walk rate capped at the 1.2 m/s look:
 * - 'walk' (default, Run toggle off): idle ↔ Walk clip only — the run clip weight is always 0, whatever the speed or
 *   the joystick intensity; walk rate = actual speed / measured walk stride, capped at the planted 1.2 m/s rate (≈ 2.79×).
 * - 'run' (Run toggle on): Walk clip at low speed, cross-fading into the Run clip as the speed rises; at 2.8 m/s the
 *   Run clip plays at ≈ 1.29× (cap maxRunTS 1.4).
 */
export function modeBlend(speed: number, scale: number, mode: GaitMode): Blend {
  const v = Math.max(0, speed), sW = STRIDE.walk * scale, sR = STRIDE.run * scale;
  const moving = sstep(0, BLEND.idleTo * 0.85 * scale, v);
  const run = mode === 'run' ? sstep(GAIT.runFrom * scale, GAIT.runMinTS * sR, v) : 0;
  if (mode === 'walk') {
    return {
      idle: 1 - moving, walk: moving, run: 0,
      walkTS: Math.min(v / sW, GAIT.walkMaxSpeed / sW), runTS: Math.min(v / sR, GAIT.maxRunTS),
    };
  }
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkTS: Math.min(v / sW, GAIT.walkMaxTS), runTS: Math.min(v / sR, GAIT.maxRunTS) };
}
/** Former speed-only gait (before 19 Nov 2026): kept for reference / tests. Its run weight rose with the speed alone, so
 *  any walk faster than ≈ 0.82 m/s played the RUN clip even with the Run toggle off (the "auto-run at full joystick" bug). */
export function gaitBlend(speed: number, scale: number): Blend {
  const v = Math.max(0, speed), sW = STRIDE.walk * scale, sR = STRIDE.run * scale;
  const moving = sstep(0, BLEND.idleTo * 0.85 * scale, v);
  const run = sstep(1.9 * sW, GAIT.runMinTS * sR, v);
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkTS: Math.min(v / sW, 1.9), runTS: Math.min(v / sR, 1.2) };
}
