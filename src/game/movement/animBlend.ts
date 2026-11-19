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
/** playback-rate window in which each clip still reads naturally; between the two the clips cross-fade */
export const GAIT = { walkMaxTS: 1.9, runMinTS: 0.55, maxRunTS: 1.2 };
/** Speed-synced gait (default profile): the walk clip at its real stride speed while it can keep up (≤ walkMaxTS), the
 *  run clip at its real stride speed from runMinTS up; both rates = actual speed / measured stride speed. */
export function gaitBlend(speed: number, scale: number): Blend {
  const v = Math.max(0, speed), sW = STRIDE.walk * scale, sR = STRIDE.run * scale;
  const moving = sstep(0, BLEND.idleTo * 0.85 * scale, v);
  const run = sstep(GAIT.walkMaxTS * sW, GAIT.runMinTS * sR, v);
  return { idle: 1 - moving, walk: moving * (1 - run), run: moving * run, walkTS: Math.min(v / sW, GAIT.walkMaxTS), runTS: Math.min(v / sR, GAIT.maxRunTS) };
}
