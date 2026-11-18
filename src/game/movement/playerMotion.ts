import { MOVE_DEFAULTS, camBasisFromDir, newMoveState, stepMove, type MoveConfig, type MoveState } from './MovementController';
import { gridCollider, type Collider } from './collision';
import { DEAD_ZONE } from './speedCurve';
import { readInput } from '../../input/joystick/joystickState';
import type { NavGrid } from '../nav/NavGrid';
import type { CharState } from '../world';

/**
 * Glue between the analog input (virtual joystick / keyboard), the MovementController and the active
 * character's runtime state. Called once per frame by the active <Character> before its own locomotion.
 * - pushing the stick past the dead zone takes over: it cancels any tap-to-move path / pending seat or dance,
 *   stands the avatar up if seated (the stand-up clip plays first), and stops a dance;
 * - while the stick owns the character, stepMover (tap-to-move) is skipped; once the character has stopped
 *   and the stick is centred, tap-to-move works again exactly as before.
 */
export const motion = {
  cfg: { ...MOVE_DEFAULTS } as MoveConfig,
  radius: 0.08,
  st: newMoveState(),
  engaged: false,
  driving: false,
  /** hooks set by the app: called once when the stick engages (close menus, camera follow, stop dance) */
  onEngage: null as null | ((c: CharState) => void),
  last: { inputX: 0, inputY: 0, d: 0, source: 'none' as string },
  frames: 0,
  /** sum of the frame times seen by the controller (debug: compare with wall-clock time) */
  simTime: 0,
};
let colNav: NavGrid | null = null, col: Collider | null = null;
function collider(nav: NavGrid | null) { if (!nav) return undefined; if (nav !== colNav) { colNav = nav; col = gridCollider(nav, motion.radius); } return col!; }
const dirV = { x: 0, y: 0, z: 0 };

/** Returns true when the analog controller moved / owns the character this frame (skip tap-to-move). */
export function driveCharacter(c: CharState, dt: number, camDir: { x: number; y: number; z: number }, nav: NavGrid | null): boolean {
  const inp = readInput(); motion.last = { inputX: inp.x, inputY: inp.y, d: inp.mag, source: inp.source };
  const engaged = inp.mag > DEAD_ZONE;
  if (engaged && !motion.engaged) {
    c.path = []; c.pendingSeat = undefined; c.pendingEmote = false;
    motion.onEngage?.(c);
    if (c.mode === 'sitting') c.mode = 'standing';
    if (!motion.driving) motion.st = newMoveState(c.pos.x, c.pos.z, c.yaw);
  }
  motion.engaged = engaged;
  if (c.mode === 'sitting' || c.mode === 'standing') { motion.st.vx = motion.st.vz = 0; motion.st.speed = 0; motion.driving = false; return false; }
  if (engaged && c.path.length) c.path = [];
  const st = motion.st, rest = st.vx === 0 && st.vz === 0;
  if (!engaged && (rest || c.path.length)) { st.vx = st.vz = 0; st.speed = 0; st.d = inp.mag; st.factor = 0; motion.driving = false; return false; } // tap-to-move / idle
  // keep in sync with anything else that moved the character (travel, seat, tap path)
  if (!motion.driving || Math.hypot(st.x - c.pos.x, st.z - c.pos.z) > 0.05) { st.x = c.pos.x; st.z = c.pos.z; st.yaw = c.yaw; } // teleported (travel) or moved by something else
  dirV.x = camDir.x; dirV.y = camDir.y; dirV.z = camDir.z;
  const next: MoveState = stepMove(st, inp, camBasisFromDir(dirV.x, dirV.y, dirV.z), dt, motion.cfg, collider(nav));
  motion.st = next; motion.frames++; motion.simTime += dt;
  c.pos.x = next.x; c.pos.z = next.z; c.yaw = next.yaw; c.speed = next.speed;
  motion.driving = !(next.vx === 0 && next.vz === 0 && !engaged);
  return true;
}
