import * as THREE from 'three';

/** Pure, render-independent locomotion (unit-tested). Units: metres, seconds, radians. */
export const LOCO = {
  walk: 0.85,      // m/s – matches the retargeted Walk stride at avatar scale
  run: 1.9,        // m/s – Run clip
  accel: 3.5,      // m/s²
  decel: 5.0,      // m/s² (used for the arrival ramp)
  turnRate: 9,     // 1/s exponential yaw smoothing
  arrive: 0.04,    // m
  corner: 0.12,    // m – start turning towards the next waypoint early
};

export interface Mover {
  pos: THREE.Vector3; yaw: number; speed: number; path: THREE.Vector3[]; running: boolean;
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function remaining(m: Mover) {
  let d = 0, p = m.pos;
  for (const w of m.path) { d += p.distanceTo(w); p = w; }
  return d;
}

/** Advance one tick. Returns true while moving. */
export function stepMover(m: Mover, dt: number): boolean {
  if (!m.path.length) { m.speed = Math.max(0, m.speed - LOCO.decel * dt); return false; }
  // skip reached waypoints (with corner cutting on intermediate ones)
  while (m.path.length) {
    const d = m.pos.distanceTo(m.path[0]);
    if (d < (m.path.length > 1 ? LOCO.corner : LOCO.arrive)) {
      const last = m.path.shift()!; if (!m.path.length) { m.pos.copy(last); m.speed = 0; return false; }
    } else break;
  }
  const tgt = m.path[0];
  const dir = tgt.clone().sub(m.pos).setY(0); const dist = dir.length(); dir.divideScalar(dist || 1);
  const want = Math.atan2(dir.x, dir.z);
  const dy = wrapAngle(want - m.yaw);
  m.yaw = wrapAngle(m.yaw + dy * Math.min(1, dt * LOCO.turnRate));
  const vmax = m.running ? LOCO.run : LOCO.walk;
  const ramp = Math.sqrt(2 * LOCO.decel * remaining(m));          // slow down before the final point
  const turnK = Math.max(0.25, Math.cos(Math.min(Math.PI / 2, Math.abs(dy)))); // slow down in sharp turns
  const target = Math.min(vmax * turnK, ramp);
  m.speed = m.speed < target ? Math.min(target, m.speed + LOCO.accel * dt) : Math.max(target, m.speed - LOCO.decel * dt);
  m.pos.addScaledVector(dir, Math.min(dist, m.speed * dt));
  return true;
}
