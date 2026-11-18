import * as THREE from 'three';
import { stepMoveWorld, type MoveConfig, type MoveState } from './MovementController';
import type { Collider } from './collision';
import { LOCO } from '../character/locomotion';

/**
 * Tap-to-move (touch, optional) / click-to-move (mouse) path follower for the player's avatar.
 * It steers along the A* path from the existing NavGrid, but integrates the motion with the SAME core as the
 * analog stick (stepMoveWorld: speed scale, exponential accel / decel, turning, collision sub-steps), so a
 * tapped walk feels exactly like pushing the stick at walking displacement. Pure + unit-tested.
 */
export const PATH_CFG = {
  /** natural walking speed of the clip (m/s) → speed factor of the controller's maxSpeed */
  walk: LOCO.walk,
  /** double-tap / double-click = run */
  run: LOCO.run,
  /** comfortable braking (m/s²) used for the arrival ramp: v ≤ √(2·a·remaining) */
  brake: 3.2,
  /** final arrival tolerance (m) */
  arrive: 0.04,
  /** intermediate waypoints are passed this early (corner smoothing) */
  corner: 0.14,
  /** sub-step of the follower (s): keeps the steering accurate at low frame rates */
  step: 1 / 60,
  /** progress check: if the avatar moved less than `stuckDist` during `stuckTime`, re-plan once, then give up */
  stuckTime: 0.7, stuckDist: 0.03,
};

export interface FollowState { stuckT: number; stuckFrom: [number, number]; replans: number }
export const newFollow = (x = 0, z = 0): FollowState => ({ stuckT: 0, stuckFrom: [x, z], replans: 0 });

function remaining(x: number, z: number, path: THREE.Vector3[]) {
  let d = 0, px = x, pz = z; for (const w of path) { d += Math.hypot(w.x - px, w.z - pz); px = w.x; pz = w.z; } return d;
}

export type FollowResult = { st: MoveState; arrived: boolean; stuck: boolean };

/** Advance the player along `path` (mutated: reached waypoints are removed). */
export function followPath(st0: MoveState, path: THREE.Vector3[], running: boolean, dtRaw: number, cfg: MoveConfig, collide?: Collider, fs?: FollowState): FollowResult {
  const dt = Math.min(Math.max(dtRaw, 0), cfg.maxDt);
  let st = st0; let t = dt;
  const vmax = Math.min(cfg.maxSpeed, running ? PATH_CFG.run : PATH_CFG.walk);
  while (t > 1e-6) {
    const h = Math.min(PATH_CFG.step, t); t -= h;
    // drop reached waypoints
    while (path.length) {
      const w = path[0], dist = Math.hypot(w.x - st.x, w.z - st.z);
      if (dist < (path.length > 1 ? PATH_CFG.corner : PATH_CFG.arrive)) {
        path.shift(); if (!path.length) { st = { ...st, x: w.x, z: w.z, vx: 0, vz: 0, speed: 0, factor: 0, d: 0 }; return { st, arrived: true, stuck: false }; }
      } else break;
    }
    if (!path.length) return { st: { ...st, vx: 0, vz: 0, speed: 0 }, arrived: true, stuck: false };
    const w = path[0]; const dx = w.x - st.x, dz = w.z - st.z, dist = Math.hypot(dx, dz);
    const rem = remaining(st.x, st.z, path);
    const v = Math.min(vmax, Math.sqrt(2 * PATH_CFG.brake * rem) + 0.15);
    const dir = { x: dx / dist, z: dz / dist };
    const prev = st;
    st = stepMoveWorld(st, dir, v / cfg.maxSpeed, h, cfg, collide, v / cfg.maxSpeed, path.length === 1 ? dist : Infinity);
    st.speed = Math.hypot(st.x - prev.x, st.z - prev.z) / h;
  }
  // speed over the whole frame (animation blend reads it)
  st = { ...st, speed: dt > 0 ? Math.hypot(st.x - st0.x, st.z - st0.z) / dt : 0 };
  if (fs) {
    fs.stuckT += dt;
    if (fs.stuckT >= PATH_CFG.stuckTime) {
      const moved = Math.hypot(st.x - fs.stuckFrom[0], st.z - fs.stuckFrom[1]);
      fs.stuckT = 0; fs.stuckFrom = [st.x, st.z];
      if (moved < PATH_CFG.stuckDist) return { st, arrived: false, stuck: true };
    }
  }
  return { st, arrived: false, stuck: false };
}
