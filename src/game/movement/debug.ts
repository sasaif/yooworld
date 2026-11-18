import { motion } from './playerMotion';
import { stick } from '../../input/joystick/joystickState';
import { world } from '../world';
import { animDebug } from '../../render/Character';
import { marker } from './marker';
import { floorTapLog } from '../../app/floorTap';
import { moveSettings, lastPointerKind } from '../../input/moveSettings';
/** window.__move(): movement snapshot for e2e tests / tuning (read-only; no gameplay effect). */
export function installMoveDebug() {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>).__move = () => {
    const st = motion.st; const id = (window as unknown as { game?: { s: { activeChar: string } } }).game?.s.activeChar ?? 'f'; const c = world.chars[id];
    return {
      stick: { ...stick }, input: motion.last, engaged: motion.engaged, driving: motion.driving, frames: motion.frames, simTime: motion.simTime,
      vel: [st.vx, st.vz], speed: st.speed, d: st.d, factor: st.factor, blocked: st.blocked, maxSpeed: motion.cfg.maxSpeed,
      pos: c ? [c.pos.x, c.pos.z] : null, yaw: c?.yaw, mode: c?.mode, path: c?.path.length ?? 0, anim: animDebug[id] ?? null,
      location: world.location, t: performance.now(),
      marker: { phase: marker.phase, x: marker.x, z: marker.z, alpha: marker.alpha, seq: marker.seq }, tap: { ...floorTapLog }, settings: moveSettings.get(), pointerKind: lastPointerKind(),
      pathStats: { ...motion.pathStats }, pathPts: c ? c.path.map((p) => [p.x, p.z]) : [], running: c?.running,
    };
  };
}
