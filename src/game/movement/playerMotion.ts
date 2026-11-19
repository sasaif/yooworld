import { MOVE_DEFAULTS, camBasisFromDir, newMoveState, stepMove, type MoveConfig, type MoveState } from './MovementController';
import { gridCollider, type Collider } from './collision';
import { DEAD_ZONE } from './speedCurve';
import { readInput } from '../../input/joystick/joystickState';
import type { NavGrid } from '../nav/NavGrid';
import { followPath, newFollow, type FollowState } from './pathFollow';
import { arriveMarker, marker } from './marker';
import type { CharState } from '../world';
import { readMoveProfile, stickConfig, WALK_ONLY_MAX_TS, RUN_SPEED } from './walkProfile';

const profile = readMoveProfile();

/**
 * Glue between the analog input (virtual joystick / keyboard), the MovementController and the active
 * character's runtime state. Called once per frame by the active <Character> before its own locomotion.
 * - pushing the stick past the dead zone takes over: it cancels any tap-to-move path / pending seat or dance,
 *   stands the avatar up if seated (the stand-up clip plays first), and stops a dance;
 * - while the stick owns the character, stepMover (tap-to-move) is skipped; once the character has stopped
 *   and the stick is centred, tap-to-move works again exactly as before.
 */
export const motion = {
  /** `?walk=a|b|c` / `?move=classic` (walkProfile.ts) */
  profile,
  /** run mode of the stick / keyboard (🏃 button, R key); classic profile: the stick reaches run speed anyway */
  run: false,
  cfg: stickConfig(profile, false) as MoveConfig,
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
  /** tap / click-to-move follower state (reset whenever a new path array is assigned) */
  follow: newFollow() as FollowState,
  followPath: null as unknown[] | null,
  /** debug counters: path frames driven by the controller, arrivals, re-plans, give-ups */
  pathStats: { frames: 0, arrived: 0, replans: 0, gaveUp: 0 },
};
let colNav: NavGrid | null = null, col: Collider | null = null, pathCol: Collider | null = null;
function collider(nav: NavGrid | null) { if (!nav) return undefined; if (nav !== colNav) { colNav = nav; col = gridCollider(nav, motion.radius); pathCol = gridCollider(nav, 0); } return col!; }
/** Path following collides as a POINT against the nav cells: the A* path lives on that grid (furniture is already padded by
 *  12 cm), and interaction targets (seat fronts, dance spots) may lie closer than the stick's 8 cm disc to a padded cell. */
function pathCollider(nav: NavGrid | null) { if (!nav) return undefined; collider(nav); return pathCol!; }
const dirV = { x: 0, y: 0, z: 0 };
const runListeners = new Set<() => void>();
/** Switch the stick between walk and run (keeps the current velocity: the filter eases into the new top speed). */
export function setRun(on: boolean) { if (motion.profile.classic || motion.run === on) return; motion.run = on; motion.cfg = stickConfig(motion.profile, on); runListeners.forEach((l) => l()); }
export function onRunChange(l: () => void) { runListeners.add(l); return () => { runListeners.delete(l); }; }
/** Tap / click-to-move keeps its own walk / run speeds (PATH_CFG) and the 1st-order integrator it was tuned with. */
let pathCfgFor: MoveConfig | null = null, pathCfgV: MoveConfig = MOVE_DEFAULTS;
function pathConfig() { if (pathCfgFor !== motion.cfg) { pathCfgFor = motion.cfg; const { smooth: _s, ...rest } = motion.cfg; pathCfgV = { ...rest, maxSpeed: Math.max(rest.maxSpeed, RUN_SPEED) }; } return pathCfgV; }
/** Walk clip only (rate cap) while the player drives in walk mode; 0 = normal walk → run blend. */
export function walkOnlyTS(c: CharState): number { return !motion.profile.classic && !motion.run && !(c.path.length && c.running) ? WALK_ONLY_MAX_TS : 0; }

/** The destination marker belongs to the player's current path: it fades as soon as the path ends (arrival),
 *  is cancelled (joystick) or is replaced by a path somewhere else (seat, dance spot, travel). */
function syncMarker(c: CharState) {
  if (marker.phase !== 'active') return;
  const end = c.path[c.path.length - 1];
  if (!end || Math.hypot(end.x - marker.x, end.z - marker.z) > 0.35) arriveMarker();
}

/** Tap / click-to-move: follow the nav path with the analog controller's integrator (same feel as the stick). */
function followTapPath(c: CharState, dt: number, nav: NavGrid | null): boolean {
  let st = motion.st;
  if (!motion.driving || Math.hypot(st.x - c.pos.x, st.z - c.pos.z) > 0.05) { st = motion.st = { ...st, x: c.pos.x, z: c.pos.z, yaw: c.yaw, vx: motion.driving ? st.vx : 0, vz: motion.driving ? st.vz : 0, ax: 0, az: 0 }; }
  if (motion.followPath !== c.path) { motion.followPath = c.path; motion.follow = newFollow(c.pos.x, c.pos.z); }
  const goal = c.path[c.path.length - 1];
  const r = followPath(st, c.path, c.running, dt, pathConfig(), pathCollider(nav), motion.follow);
  motion.st = r.st; motion.frames++; motion.simTime += Math.min(Math.max(dt, 0), motion.cfg.maxDt); motion.pathStats.frames++;
  c.pos.x = r.st.x; c.pos.z = r.st.z; c.yaw = r.st.yaw; c.speed = r.st.speed;
  if (r.arrived) {
    c.path = []; c.speed = 0; motion.st = { ...r.st, vx: 0, vz: 0, ax: 0, az: 0, speed: 0 }; motion.driving = false; motion.pathStats.arrived++; arriveMarker();
    return false; // <Character> now handles the pending seat / dance exactly as before
  }
  if (r.stuck) {
    if (nav && goal && motion.follow.replans < 1) {
      const p = nav.path(c.pos, goal); motion.follow.replans++; motion.pathStats.replans++;
      if (p.length) { c.path = p; motion.followPath = p; } else { c.path = []; }
    } else { c.path = []; motion.pathStats.gaveUp++; }
    if (!c.path.length) { motion.st = { ...motion.st, vx: 0, vz: 0, speed: 0 }; c.speed = 0; c.pendingSeat = undefined; c.pendingEmote = false; motion.driving = false; arriveMarker(); return false; }
  }
  motion.driving = true;
  return true;
}

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
  if (c.mode === 'sitting' || c.mode === 'standing') { motion.st.vx = motion.st.vz = 0; motion.st.ax = motion.st.az = 0; motion.st.speed = 0; motion.driving = false; return false; }
  if (engaged && c.path.length) c.path = [];
  syncMarker(c);
  const st = motion.st, rest = st.vx === 0 && st.vz === 0;
  if (!engaged && c.path.length) return followTapPath(c, dt, nav);
  if (!engaged && rest) { st.vx = st.vz = 0; st.ax = st.az = 0; st.speed = 0; st.d = inp.mag; st.factor = 0; motion.driving = false; return false; } // idle
  // keep in sync with anything else that moved the character (travel, seat, tap path)
  if (!motion.driving || Math.hypot(st.x - c.pos.x, st.z - c.pos.z) > 0.05) { st.x = c.pos.x; st.z = c.pos.z; st.yaw = c.yaw; } // teleported (travel) or moved by something else
  dirV.x = camDir.x; dirV.y = camDir.y; dirV.z = camDir.z;
  const next: MoveState = stepMove(st, inp, camBasisFromDir(dirV.x, dirV.y, dirV.z), dt, motion.cfg, collider(nav));
  motion.st = next; motion.frames++; motion.simTime += Math.min(Math.max(dt, 0), motion.cfg.maxDt);
  c.pos.x = next.x; c.pos.z = next.z; c.yaw = next.yaw; c.speed = next.speed;
  motion.driving = !(next.vx === 0 && next.vz === 0 && !engaged);
  return true;
}
