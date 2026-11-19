import { motion } from './playerMotion';
import { stick } from '../../input/joystick/joystickState';
import { world } from '../world';
import { animDebug, seatDebug } from '../../render/Character';
import { marker } from './marker';
import { floorTapLog } from '../../app/floorTap';
import { moveSettings, lastPointerKind } from '../../input/moveSettings';
import { FURNITURE } from '../../data/furniture';
import { itemTransform } from '../apartment/ApartmentModel';
/** window.__move(): movement snapshot for e2e tests / tuning (read-only; no gameplay effect). */
export function installMoveDebug() {
  if (typeof window === 'undefined') return;
  /** e2e: centre of each placed furniture item (x, mid-height y, z) to tap it on screen */
  (window as unknown as Record<string, unknown>).__itemPoints = () => {
    const g = (window as unknown as { game?: { s: { apartment: { items: { uid: string; defId: string; parent?: string }[] } | null } } }).game;
    return (g?.s.apartment?.items ?? []).filter((it) => !it.parent).map((it) => { const d = FURNITURE[it.defId]; const t = itemTransform(it as never, FURNITURE); return { uid: it.uid, defId: it.defId, name: d?.name, interaction: d?.interaction ?? null, x: t.x, y: (d?.size.h ?? 0.5) * 0.6, z: t.z, w: d?.size.w, d: d?.size.d }; });
  };
  (window as unknown as Record<string, unknown>).__move = () => {
    const st = motion.st; const id = (window as unknown as { game?: { s: { activeChar: string } } }).game?.s.activeChar ?? 'f'; const c = world.chars[id];
    return {
      stick: { ...stick }, input: motion.last, engaged: motion.engaged, driving: motion.driving, frames: motion.frames, simTime: motion.simTime,
      vel: [st.vx, st.vz], speed: st.speed, d: st.d, factor: st.factor, blocked: st.blocked, maxSpeed: motion.cfg.maxSpeed,
      pos: c ? [c.pos.x, c.pos.z] : null, yaw: c?.yaw, mode: c?.mode, path: c?.path.length ?? 0, anim: animDebug[id] ?? null,
      location: world.location, t: performance.now(),
      marker: { phase: marker.phase, x: marker.x, z: marker.z, alpha: marker.alpha, seq: marker.seq }, tap: { ...floorTapLog }, settings: moveSettings.get(), pointerKind: lastPointerKind(),
      seat: seatDebug[id] ? { ...seatDebug[id] } : null,
      profile: { ...motion.profile }, run: motion.run, smooth: motion.cfg.smooth ?? null, acc: [st.ax ?? 0, st.az ?? 0],
      pathStats: { ...motion.pathStats }, pathPts: c ? c.path.map((p) => [p.x, p.z]) : [], running: c?.running,
    };
  };
}
