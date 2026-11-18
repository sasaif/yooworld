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
}
export const MOVE_DEFAULTS: MoveConfig = { maxSpeed: 1.9, accel: 14, decel: 32, turnRate: 12, anchors: DEFAULT_ANCHORS, stopEps: 0.03, maxDt: 0.25, subStep: 0.04 };

export interface MoveState { x: number; z: number; vx: number; vz: number; yaw: number; speed: number; d: number; factor: number; blocked: boolean }
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
  const tx = dir ? dir.x * f * cfg.maxSpeed : 0, tz = dir ? dir.z * f * cfg.maxSpeed : 0;
  const cur = Math.hypot(st.vx, st.vz), want = Math.hypot(tx, tz);
  const rate = want < 1e-6 || want < cur - 1e-6 ? cfg.decel : cfg.accel;
  // v(t) = t + (v0 - t)e^{-kt}  →  exact displacement over dt
  const e = Math.exp(-rate * dt), g = (1 - e) / rate;
  const dx = tx * dt + (st.vx - tx) * g, dz = tz * dt + (st.vz - tz) * g;
  let vx = tx + (st.vx - tx) * e, vz = tz + (st.vz - tz) * e;
  if (!dir && Math.hypot(vx, vz) < cfg.stopEps) { vx = 0; vz = 0; }
  // move through the collider in small sub-steps; cancel the velocity component pushing into an obstacle
  let x = st.x, z = st.z, blocked = false;
  const len = Math.hypot(dx, dz);
  if (len > 0) {
    if (collide) {
      const n = Math.max(1, Math.ceil(len / cfg.subStep)); const sx = dx / n, sz = dz / n;
      for (let k = 0; k < n; k++) { const h = collide(x, z, sx, sz); x = h.x; z = h.z; if (h.hitX) { vx = 0; blocked = true; } if (h.hitZ) { vz = 0; blocked = true; } }
    } else { x += dx; z += dz; }
  }
  const moved = Math.hypot(x - st.x, z - st.z);
  let yaw = st.yaw;
  if (want > 0) { const ty = Math.atan2(tx, tz); yaw = wrap(yaw + wrap(ty - yaw) * (1 - Math.exp(-cfg.turnRate * dt))); }
  return { x, z, vx, vz, yaw, speed: moved / dt, d, factor: f, blocked };
}
