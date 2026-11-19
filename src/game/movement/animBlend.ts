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
/** playback-rate window in which each clip still reads naturally; between the two the clips cross-fade (run mode only).
 *  walkMaxTS: highest walk-clip rate. The walk clip's stride is short (≈ 0.43 m/s at rate 1 at the avatars' scale), so a
 *  1.8 m/s fast walk needs rate ≈ 4.2 to keep the feet planted; 4.6 leaves room for the ≤ 0.3 s run → walk slow-down.
 *  maxRunTS: the 2.8 m/s run needs ≈ 1.29 (run clip stride ≈ 2.17 m/s at rate 1). */
export const GAIT = { walkMaxTS: 4.6, runFrom: 1.9 * STRIDE.walk, runMinTS: 0.55, maxRunTS: 1.4 };
export type GaitMode = 'walk' | 'run';
/**
 * Mode-aware gait (default profile). The MODE decides which clips are allowed, the actual SPEED decides the weights and rates:
 * - 'walk' (default, Run toggle off): idle ↔ walk clip only — the run clip weight is always 0, whatever the speed or the
 *   joystick intensity; walk rate = actual speed / measured walk stride speed (feet planted).
 * - 'run' (Run toggle on): walk clip at low speed, cross-fading into the run clip as the speed rises (same window as
 *   before: from walk rate 1.9 to run rate 0.55); run rate = actual speed / measured run stride speed.
 */
export function modeBlend(speed: number, scale: number, mode: GaitMode): Blend {
  const v = Math.max(0, speed), sW = STRIDE.walk * scale, sR = STRIDE.run * scale;
  const moving = sstep(0, BLEND.idleTo * 0.85 * scale, v);
  const run = mode === 'run' ? sstep(GAIT.runFrom * scale, GAIT.runMinTS * sR, v) : 0;
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkTS: Math.min(v / sW, GAIT.walkMaxTS), runTS: Math.min(v / sR, GAIT.maxRunTS) };
}
/** Former speed-only gait (before 19 Nov 2026): kept for reference / tests. Its run weight rose with the speed alone, so
 *  any walk faster than ≈ 0.82 m/s (≈ 45 % stick in walk mode) played the RUN clip: the "auto-run at full joystick" bug. */
export function gaitBlend(speed: number, scale: number): Blend {
  const v = Math.max(0, speed), sW = STRIDE.walk * scale, sR = STRIDE.run * scale;
  const moving = sstep(0, BLEND.idleTo * 0.85 * scale, v);
  const run = sstep(1.9 * sW, GAIT.runMinTS * sR, v);
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkTS: Math.min(v / sW, 1.9), runTS: Math.min(v / sR, 1.2) };
}
