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
