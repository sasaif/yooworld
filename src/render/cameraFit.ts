import * as THREE from 'three';
/** Pure camera framing maths (unit-tested): fit the apartment to the screen for an orthographic iso camera. */
export interface Room { w: number; d: number; wallH: number }

/** Size (world units) of the room's bounding box as seen through an orthographic camera looking along -dir. */
export function projectedRoomSize(room: Room, dir: THREE.Vector3) {
  const back = dir.clone().normalize();
  const right = new THREE.Vector3(0, 1, 0).cross(back).normalize();
  const up = back.clone().cross(right).normalize();
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity; const p = new THREE.Vector3();
  // floor corners + top of the two visible walls (back wall z=0, left wall x=0); there is no front wall
  const pts = [[0, 0, 0], [room.w, 0, 0], [0, 0, room.d], [room.w, 0, room.d], [0, room.wallH, 0], [room.w, room.wallH, 0], [0, room.wallH, room.d]];
  for (const [x, y, z] of pts) {
    p.set(x, y, z); const sx = p.dot(right), sy = p.dot(up);
    minX = Math.min(minX, sx); maxX = Math.max(maxX, sx); minY = Math.min(minY, sy); maxY = Math.max(maxY, sy);
  }
  return { w: maxX - minX, h: maxY - minY };
}

/**
 * Zoom (CSS px per world unit) that frames the room so it fills the screen (no empty "frame" around it).
 *  - landscape: the room spans the screen width; the empty apex of the back walls and the empty front
 *    floor corner may be cropped vertically (the camera follows the player). Wide-but-short screens
 *    (tablets) are bounded by the height instead.
 *  - portrait: crop the sides so characters stay readable.
 * `hud` = CSS px of the screen height covered by the HUD bars (not counted as usable height).
 */
export function fitZoom(viewW: number, viewH: number, room: Room, dir: THREE.Vector3, hud = 0) {
  const s = projectedRoomSize(room, dir); const h = Math.max(1, viewH - hud);
  const wFit = viewW / s.w, hFit = h / s.h;
  if (viewW >= viewH) return Math.max(wFit * 0.95, hFit * 1.05);
  return Math.min(Math.max(wFit, hFit), wFit * 1.8);
}
/** Allowed pinch / wheel range around the fitted zoom. */
export const zoomLimits = (fit: number) => ({ min: fit * 0.7, max: fit * 3.2 });

/** World-space area the camera must stay on (apartment = the room box, Yoo Plage = the beach). */
export interface Bounds { x0: number; z0: number; x1: number; z1: number; h: number }
export const roomBounds = (room: Room): Bounds => ({ x0: 0, z0: 0, x1: room.w, z1: room.d, h: room.wallH });

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
/**
 * Keep an orthographic camera on the play area (allocation-free, called every frame).
 * `target` = OrbitControls target, `back` = direction from the target to the camera. The target is first slid along the
 * view axis to the reference height `refY` (this does not change the picture), then its screen position is clamped so
 * the visible rectangle (viewW × viewH CSS px at `zoom` px/m) stays inside the screen bounding box of the area
 * (floor corners + top of the back/left walls). If the area is smaller than the screen on an axis, it is centred.
 * Writes the corrected target into `out` and returns it; `out` - `target` is the shift to apply to camera + target.
 * Since the followed avatar is inside the area, a clamped follow never pushes the avatar off screen.
 */
export function clampTarget(target: THREE.Vector3, back: THREE.Vector3, refY: number, b: Bounds, viewW: number, viewH: number, zoom: number, out: THREE.Vector3) {
  _b.copy(back).normalize(); _r.crossVectors(_Y, _b).normalize(); _u.crossVectors(_b, _r).normalize();
  out.copy(target); if (Math.abs(_b.y) > 1e-4) out.addScaledVector(_b, (refY - out.y) / _b.y);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < 7; k++) {
    // floor corners (k 0-3), then the top of the back wall (z0) and of the left wall (x0)
    const x = k === 0 || k === 2 || k === 4 || k === 6 ? b.x0 : b.x1, z = k < 2 || k === 4 || k === 5 ? b.z0 : b.z1, y = k < 4 ? 0 : b.h;
    _p.set(x, y, z); const sx = _p.dot(_r), sy = _p.dot(_u);
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  const hw = viewW / 2 / zoom, hh = viewH / 2 / zoom; const tx = out.dot(_r), ty = out.dot(_u);
  const cx = maxX - minX >= 2 * hw ? Math.min(Math.max(tx, minX + hw), maxX - hw) : (minX + maxX) / 2;
  const cy = maxY - minY >= 2 * hh ? Math.min(Math.max(ty, minY + hh), maxY - hh) : (minY + maxY) / 2;
  out.addScaledVector(_r, cx - tx).addScaledVector(_u, cy - ty);
  if (Math.abs(_b.y) > 1e-4) out.addScaledVector(_b, (refY - out.y) / _b.y);
  return out;
}
