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
/** Zoom at which the WHOLE room (floor + walls) fits on screen, with a small margin for the HUD. */
export function fullRoomZoom(viewW: number, viewH: number, room: Room, dir: THREE.Vector3, margin = 0.93) {
  const s = projectedRoomSize(room, dir); return Math.min(viewW / s.w, viewH / s.h) * margin;
}
/** Allowed pinch / wheel range around the fitted zoom. Pinch-out always reaches the whole-room view (`full`), even on a
 *  wide phone in landscape where it is well below the default framing (iPhone 15: ~59 vs default ~104). */
export const zoomLimits = (fit: number, full = Infinity) => ({ min: Math.min(fit * 0.7, full), max: fit * 3.2 });

/** World-space area the camera must stay on (apartment = the room box, Yoo Plage = the beach). */
export interface Bounds { x0: number; z0: number; x1: number; z1: number; h: number }
export const roomBounds = (room: Room): Bounds => ({ x0: 0, z0: 0, x1: room.w, z1: room.d, h: room.wallH });

const _r = new THREE.Vector3(), _u = new THREE.Vector3(), _b = new THREE.Vector3(), _p = new THREE.Vector3(), _Y = new THREE.Vector3(0, 1, 0);
const PX = new Float64Array(7), PY = new Float64Array(7), HX = new Float64Array(8), HY = new Float64Array(8); const USED = new Uint8Array(7);
/** Convex hull (gift wrapping, counter-clockwise) of the 7 projected room points into HX/HY; returns the vertex count. */
function hull7(): number {
  let start = 0; for (let i = 1; i < 7; i++) if (PX[i] < PX[start] || (PX[i] === PX[start] && PY[i] < PY[start])) start = i;
  USED.fill(0); let n = 0, cur = start;
  do {
    HX[n] = PX[cur]; HY[n] = PY[cur]; n++; let next = -1;
    for (let i = 0; i < 7; i++) {
      if (i === cur) continue; if (next < 0) { next = i; continue; }
      const cr = (PX[next] - PX[cur]) * (PY[i] - PY[cur]) - (PY[next] - PY[cur]) * (PX[i] - PX[cur]);
      const far = (PX[i] - PX[cur]) ** 2 + (PY[i] - PY[cur]) ** 2 > (PX[next] - PX[cur]) ** 2 + (PY[next] - PY[cur]) ** 2;
      if (cr < -1e-12 || (Math.abs(cr) <= 1e-12 && far)) next = i;
    }
    cur = next;
  } while (cur !== start && n < 8);
  return n;
}
let QX = 0, QY = 0; // results of intoHull / intoRect (module scratch: no per-frame allocation)
/** Closest point to (x, y) inside the convex polygon HX/HY (n vertices) shrunk by `k` towards (cx, cy) -> QX/QY; false if moved. */
function intoHull(n: number, x: number, y: number, cx: number, cy: number, k: number): boolean {
  let inside = true, bx = x, by = y, best = Infinity;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n; const ax = cx + (HX[i] - cx) * k, ay = cy + (HY[i] - cy) * k, ex = cx + (HX[j] - cx) * k, ey = cy + (HY[j] - cy) * k;
    const dx = ex - ax, dy = ey - ay; const cr = dx * (y - ay) - dy * (x - ax);
    if (cr < 0) inside = false;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); const qx = ax + dx * t, qy = ay + dy * t; const d = (qx - x) ** 2 + (qy - y) ** 2;
    if (d < best) { best = d; bx = qx; by = qy; }
  }
  if (inside) { QX = x; QY = y; } else { QX = bx; QY = by; } return inside;
}
/**
 * Keep an orthographic camera on the play area (allocation-free, called every frame).
 * `target` = OrbitControls target, `back` = direction from the target to the camera. The target is first slid along the
 * view axis to the reference height `refY` (this does not change the picture), then its screen position is clamped:
 *  1. the visible rectangle (viewW × viewH CSS px at `zoom` px/m) stays inside the screen bounding box of the area
 *     (floor corners + top of the back/left walls); an axis smaller than the screen is centred;
 *  2. the screen centre stays over the area's silhouette, inset by 60 % of the half view (so a zoomed-in view parked in a
 *     corner of the bounding box cannot show mostly empty background).
 * Writes the corrected target into `out` and returns it; `out` - `target` is the shift to apply to camera + target.
 * The followed avatar stands inside the area, so a clamped follow keeps it on screen.
 */
export function clampTarget(target: THREE.Vector3, back: THREE.Vector3, refY: number, b: Bounds, viewW: number, viewH: number, zoom: number, out: THREE.Vector3) {
  _b.copy(back).normalize(); _r.crossVectors(_Y, _b).normalize(); _u.crossVectors(_b, _r).normalize();
  out.copy(target); if (Math.abs(_b.y) > 1e-4) out.addScaledVector(_b, (refY - out.y) / _b.y);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let k = 0; k < 7; k++) {
    // floor corners (k 0-3), then the top of the back wall (z0) and of the left wall (x0)
    const x = k === 0 || k === 2 || k === 4 || k === 6 ? b.x0 : b.x1, z = k < 2 || k === 4 || k === 5 ? b.z0 : b.z1, y = k < 4 ? 0 : b.h;
    _p.set(x, y, z); const sx = _p.dot(_r), sy = _p.dot(_u); PX[k] = sx; PY[k] = sy;
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx; if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  const hw = viewW / 2 / zoom, hh = viewH / 2 / zoom; const tx = out.dot(_r), ty = out.dot(_u);
  const n = hull7(); let cx = 0, cy = 0; for (let i = 0; i < n; i++) { cx += HX[i]; cy += HY[i]; } cx /= n; cy /= n;
  let rMin = Infinity; for (let i = 0; i < n; i++) { const j = (i + 1) % n; const dx = HX[j] - HX[i], dy = HY[j] - HY[i]; const d = Math.abs(dx * (cy - HY[i]) - dy * (cx - HX[i])) / (Math.hypot(dx, dy) || 1); if (d < rMin) rMin = d; }
  const shrink = Math.min(1, Math.max(0.3, 1 - (0.6 * Math.min(hw, hh)) / rMin));
  const rx = maxX - minX >= 2 * hw, ry = maxY - minY >= 2 * hh;
  let qx = rx ? Math.min(Math.max(tx, minX + hw), maxX - hw) : (minX + maxX) / 2, qy = ry ? Math.min(Math.max(ty, minY + hh), maxY - hh) : (minY + maxY) / 2;
  for (let it = 0; it < 4; it++) {
    if (intoHull(n, qx, qy, cx, cy, shrink)) break;
    qx = rx ? Math.min(Math.max(QX, minX + hw), maxX - hw) : (minX + maxX) / 2; qy = ry ? Math.min(Math.max(QY, minY + hh), maxY - hh) : (minY + maxY) / 2;
  }
  out.addScaledVector(_r, qx - tx).addScaledVector(_u, qy - ty);
  if (Math.abs(_b.y) > 1e-4) out.addScaledVector(_b, (refY - out.y) / _b.y);
  return out;
}
