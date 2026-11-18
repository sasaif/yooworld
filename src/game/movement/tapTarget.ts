import * as THREE from 'three';
import type { NavGrid } from '../nav/NavGrid';
import { discBlocked } from './collision';

/**
 * Validation of a tapped / clicked floor point before walking there. Pure + unit-tested.
 * - inside the walkable area and free → walk to the exact point;
 * - on a solid (furniture footprint, wall band, beach prop, sea edge) but a free spot exists within `snapMax`
 *   → walk to the nearest free point instead ("snapped");
 * - outside the world / deep in the sea / no free spot nearby / no path → rejected (subtle "invalid" feedback, no move).
 */
export type TapReason = 'outside' | 'blocked' | 'unreachable';
export type TapTarget = { ok: true; point: THREE.Vector3; snapped: boolean } | { ok: false; reason: TapReason; point: THREE.Vector3 };
export const TAP_CFG = { snapMax: 0.9, radius: 0.08 };

const inside = (nav: NavGrid, x: number, z: number) => x >= 0 && z >= 0 && x < nav.nx * nav.cell && z < nav.nz * nav.cell;

/** Nearest point (cell centre, or the tap itself when free) whose avatar disc is free, within `max` metres. */
export function nearestFreePoint(nav: NavGrid, x: number, z: number, max: number, r = TAP_CFG.radius): THREE.Vector3 | null {
  if (inside(nav, x, z) && !discBlocked(nav, x, z, r)) return new THREE.Vector3(x, 0, z);
  const c = nav.cell, ci = Math.floor(x / c), cj = Math.floor(z / c), R = Math.ceil(max / c) + 1;
  let best: THREE.Vector3 | null = null, bd = Infinity;
  for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
    const i = ci + di, j = cj + dj; if (!nav.free(i, j)) continue;
    const px = (i + 0.5) * c, pz = (j + 0.5) * c; const d = Math.hypot(px - x, pz - z);
    if (d < bd && d <= max && !discBlocked(nav, px, pz, r)) { bd = d; best = new THREE.Vector3(px, 0, pz); }
  }
  return best;
}

export function resolveTapTarget(nav: NavGrid | null, from: THREE.Vector3, p: { x: number; z: number }, cfg = TAP_CFG): TapTarget {
  const raw = new THREE.Vector3(p.x, 0, p.z);
  if (!nav) return { ok: false, reason: 'outside', point: raw };
  // far outside the world grid (beyond the snap distance) → not a floor location
  const W = nav.nx * nav.cell, D = nav.nz * nav.cell;
  const ox = Math.max(0, -p.x, p.x - W), oz = Math.max(0, -p.z, p.z - D);
  if (Math.hypot(ox, oz) > cfg.snapMax) return { ok: false, reason: 'outside', point: raw };
  const free = inside(nav, p.x, p.z) && !discBlocked(nav, p.x, p.z, cfg.radius);
  const point = free ? raw : nearestFreePoint(nav, p.x, p.z, cfg.snapMax, cfg.radius);
  if (!point) return { ok: false, reason: inside(nav, p.x, p.z) ? 'blocked' : 'outside', point: raw };
  // reachable from where the avatar stands?
  const path = nav.path(from, point);
  if (!path.length && from.distanceTo(point) > 0.05) return { ok: false, reason: 'unreachable', point: raw };
  const end = path[path.length - 1];
  if (end && end.distanceTo(point) > nav.cell * 1.5) return { ok: false, reason: 'unreachable', point: raw };
  return { ok: true, point, snapped: !free };
}
