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
