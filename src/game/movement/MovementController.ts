import { DEFAULT_ANCHORS, speedFactor, type Anchor } from './speedCurve';
import type { Collider } from './collision';

/**
 * Analog (joystick / keyboard) character movement. Pure, render-independent and unit-tested.
 * Units: metres, seconds, radians. World floor = XZ plane; yaw = atan2(dirX, dirZ) like the tap-to-move mover.
 *
 * - Input: screen-space stick vector (x right, y DOWN, |v| ≤ 1), mapped onto the floor through the camera so
 *   pushing "up" walks away from the camera and every on-screen direction is followed (full 360°).
 * - Speed: |v| → progressive speed curve (dead zone + levels) × maxSpeed; direction is normalised first, so
 *   diagonals are never faster than straight lines.
 * - Velocity follows the target with exponential smoothing (accel / decel rates in 1/s), integrated
 *   analytically → identical motion at 30, 60 or 120 fps; dt is clamped and the move is sub-stepped
 *   through the collider so a long frame can never tunnel through a wall.
 */
export interface MoveConfig {
  maxSpeed: number;   // m/s at full displacement
  accel: number;      // 1/s – rate towards a faster / new-direction target (≈95 % in 3/accel s)
  decel: number;      // 1/s – rate towards a slower target / stop (≈95 % in 3/decel s)
  turnRate: number;   // 1/s – exponential yaw smoothing
  anchors: readonly Anchor[];
  stopEps: number;    // m/s – below this with no input, snap to a full stop
  maxDt: number;      // s – frame time clamp (slow devices keep full speed; a long hitch never teleports)
  subStep: number;    // m – max displacement per collision sub-step
  /** optional critically damped 2nd-order velocity filter (natural frequencies in rad/s, accelerating / braking);
   *  absent = the 1st-order exponential smoothing above (accel / decel) */
  smooth?: { accel: number; decel: number };
}
export const MOVE_DEFAULTS: MoveConfig = { maxSpeed: 1.9, accel: 14, decel: 32, turnRate: 12, anchors: DEFAULT_ANCHORS, stopEps: 0.03, maxDt: 0.25, subStep: 0.04 };

export interface MoveState { x: number; z: number; vx: number; vz: number; yaw: number; speed: number; d: number; factor: number; blocked: boolean; ax?: number; az?: number }
export const newMoveState = (x = 0, z = 0, yaw = 0): MoveState => ({ x, z, vx: 0, vz: 0, yaw, speed: 0, d: 0, factor: 0, blocked: false });

/** Camera basis on the floor: horizontal forward (fx, fz) and how much floor depth is foreshortened on screen
 *  (sin of the view's elevation; 1 = top-down). */
export interface CamBasis { fx: number; fz: number; sinEl: number }
export function camBasisFromDir(dx: number, dy: number, dz: number): CamBasis {
  const h = Math.hypot(dx, dz) || 1, l = Math.hypot(dx, dy, dz) || 1;
  return { fx: dx / h, fz: dz / h, sinEl: Math.max(0.2, Math.abs(dy) / l) };
}
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Unit floor direction for a screen direction (x right, y down). Returns null for a zero vector. */
export function screenToWorldDir(x: number, y: number, cam: CamBasis): { x: number; z: number } | null {
  if (x === 0 && y === 0) return null;
  // screen right = forward × up = (-fz, fx); screen up = forward, foreshortened by sinEl on screen
  const up = -y / cam.sinEl;
  const wx = -cam.fz * x + cam.fx * up, wz = cam.fx * x + cam.fz * up; const l = Math.hypot(wx, wz);
  return l ? { x: wx / l, z: wz / l } : null;
}

export function stepMove(st: MoveState, input: { x: number; y: number }, cam: CamBasis, dtRaw: number, cfg: MoveConfig = MOVE_DEFAULTS, collide?: Collider): MoveState {
  const dt = Math.min(Math.max(dtRaw, 0), cfg.maxDt); if (dt === 0) return st;
  const d = Math.min(1, Math.hypot(input.x, input.y)); const f = speedFactor(d, cfg.anchors);
  const dir = f > 0 ? screenToWorldDir(input.x, input.y, cam) : null;
  return stepMoveWorld(st, dir, f, dt, cfg, collide, d);
}

/**
 * Core integrator shared by the analog stick and the tap / click-to-move path follower (same speed scale,
 * acceleration, deceleration, collision sub-steps and turning → identical feel whatever the input).
 * `dir` = unit floor direction (null = no input → decelerate), `f` = speed factor 0..1 of maxSpeed.
 * `maxStep` optionally caps the displacement of this step (path follower: never overshoot the destination).
 */
export function stepMoveWorld(st: MoveState, dir: { x: number; z: number } | null, f: number, dtRaw: number, cfg: MoveConfig = MOVE_DEFAULTS, collide?: Collider, d = f, maxStep = Infinity): MoveState {
  const dt = Math.min(Math.max(dtRaw, 0), cfg.maxDt); if (dt === 0) return st;
  if (!(f > 0)) dir = null;
  const tx = dir ? dir.x * f * cfg.maxSpeed : 0, tz = dir ? dir.z * f * cfg.maxSpeed : 0;
  const cur = Math.hypot(st.vx, st.vz), want = Math.hypot(tx, tz);
  const braking = want < 1e-6 || want < cur - 1e-6;
  let dx: number, dz: number, vx: number, vz: number, ax = 0, az = 0;
  if (cfg.smooth) {
    // critically damped: x = v − target, x(t) = (x0 + c t)e^{−ωt}, c = a0 + ω x0  →  exact v, a and displacement over dt
    const w = braking ? cfg.smooth.decel : cfg.smooth.accel, e = Math.exp(-w * dt);
    const ax0 = st.ax ?? 0, az0 = st.az ?? 0, x0 = st.vx - tx, z0 = st.vz - tz, cx = ax0 + w * x0, cz = az0 + w * z0;
    const g1 = (1 - e) / w, g2 = (1 - e * (1 + w * dt)) / (w * w);
    dx = tx * dt + x0 * g1 + cx * g2; dz = tz * dt + z0 * g1 + cz * g2;
    vx = tx + (x0 + cx * dt) * e; vz = tz + (z0 + cz * dt) * e;
    ax = (ax0 - cx * w * dt) * e; az = (az0 - cz * w * dt) * e;
    const vm = Math.hypot(vx, vz), cap = cfg.maxSpeed * 1.001; if (vm > cap) { vx *= cap / vm; vz *= cap / vm; }
  } else {
    const rate = braking ? cfg.decel : cfg.accel;
    // v(t) = t + (v0 - t)e^{-kt}  →  exact displacement over dt
    const e = Math.exp(-rate * dt), g = (1 - e) / rate;
    dx = tx * dt + (st.vx - tx) * g; dz = tz * dt + (st.vz - tz) * g;
    vx = tx + (st.vx - tx) * e; vz = tz + (st.vz - tz) * e;
  }
  if (!dir && Math.hypot(vx, vz) < cfg.stopEps) { vx = 0; vz = 0; ax = 0; az = 0; }
  const len0 = Math.hypot(dx, dz); if (len0 > maxStep) { const k = maxStep / len0; dx *= k; dz *= k; }
  // move through the collider in small sub-steps; cancel the velocity component pushing into an obstacle
  let x = st.x, z = st.z, blocked = false;
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    if (collide) {
      const n = Math.max(1, Math.ceil(len / cfg.subStep)); const sx = dx / n, sz = dz / n;
      for (let k = 0; k < n; k++) { const h = collide(x, z, sx, sz); x = h.x; z = h.z; if (h.hitX) { vx = 0; ax = 0; blocked = true; } if (h.hitZ) { vz = 0; az = 0; blocked = true; } }
    } else { x += dx; z += dz; }
  }
  const moved = Math.hypot(x - st.x, z - st.z);
  let yaw = st.yaw;
  if (want > 0) { const ty = Math.atan2(tx, tz); yaw = wrap(yaw + wrap(ty - yaw) * (1 - Math.exp(-cfg.turnRate * dt))); }
  const out: MoveState = { x, z, vx, vz, yaw, speed: moved / dt, d, factor: f, blocked };
  if (cfg.smooth) { out.ax = ax; out.az = az; }
  return out;
}
