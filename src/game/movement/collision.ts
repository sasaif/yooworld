import type { NavGrid } from '../nav/NavGrid';

/**
 * Free-movement collision against the existing navigation grid (the same occupancy data tap-to-move uses:
 * walls, furniture footprints, beach water / props, room / world bounds). Pure + unit-tested.
 * The avatar is a small disc (radius r, sampled at 8 points). Blocked moves slide along the obstacle
 * (per-axis resolution = projection of the motion onto the obstacle tangent for the grid's axis-aligned
 * edges), and a blocked head-on push near an obstacle corner nudges sideways around it instead of sticking.
 */
export interface Hit { x: number; z: number; hitX: boolean; hitZ: boolean }
export type Collider = (x: number, z: number, dx: number, dz: number) => Hit;

const SAMPLES = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]] as const;

export function cellBlocked(nav: NavGrid, x: number, z: number) {
  if (!(x >= 0 && z >= 0)) return true;
  const i = Math.floor(x / nav.cell), j = Math.floor(z / nav.cell);
  return !nav.free(i, j); // out of the grid = outside the playable area
}
export function discBlocked(nav: NavGrid, x: number, z: number, r: number) {
  if (r <= 0) return cellBlocked(nav, x, z);
  for (const [a, b] of SAMPLES) if (cellBlocked(nav, x + a * r, z + b * r)) return true;
  return false;
}

export function gridCollider(nav: NavGrid, radius = 0.08, slip = 0.22): Collider {
  return (x, z, dx, dz) => {
    // already overlapping (spawned / stood up against furniture): only the centre point has to stay free,
    // so the player can always walk out; if even the centre is blocked, only moves towards the nearest free cell are allowed (never through a wall).
    const r = discBlocked(nav, x, z, radius) ? 0 : radius;
    const stuck = r === 0 && cellBlocked(nav, x, z);
    const outside = (px: number, pz: number) => !(px >= 0 && pz >= 0 && px < nav.nx * nav.cell && pz < nav.nz * nav.cell);
    // stuck inside an obstacle cell: only moves that get closer to the nearest free cell are allowed
    let exit: [number, number] | null = null;
    if (stuck) { const [fi, fj] = nav.nearestFree(Math.min(nav.nx - 1, Math.max(0, Math.floor(x / nav.cell))), Math.min(nav.nz - 1, Math.max(0, Math.floor(z / nav.cell)))); exit = [(fi + 0.5) * nav.cell, (fj + 0.5) * nav.cell]; }
    const d0 = exit ? Math.hypot(exit[0] - x, exit[1] - z) : 0;
    const blocked = (px: number, pz: number) => (stuck ? outside(px, pz) || (cellBlocked(nav, px, pz) && Math.hypot(exit![0] - px, exit![1] - pz) >= d0) : discBlocked(nav, px, pz, r));
    if (!blocked(x + dx, z + dz)) return { x: x + dx, z: z + dz, hitX: false, hitZ: false };
    const okX = dx !== 0 && !blocked(x + dx, z), okZ = dz !== 0 && !blocked(x, z + dz);
    if (okX && (!okZ || Math.abs(dx) >= Math.abs(dz))) return { x: x + dx, z, hitX: false, hitZ: true };
    if (okZ) return { x, z: z + dz, hitX: true, hitZ: false };
    // head-on into an edge: if the way is clear a little to one side (we are at a corner), slide that way
    const len = Math.hypot(dx, dz); if (len === 0) return { x, z, hitX: true, hitZ: true };
    const ux = dx / len, uz = dz / len, px = -uz, pz = ux; // perpendicular
    const look = Math.max(len, radius + 0.05);
    for (let k = 1; k <= 4; k++) {
      const off = (slip * k) / 4;
      for (const sgn of [1, -1]) {
        const sx = x + px * off * sgn, sz = z + pz * off * sgn;
        if (!blocked(sx, sz) && !blocked(sx + ux * look, sz + uz * look)) {
          const step = len * 0.7, nx = x + px * step * sgn, nz = z + pz * step * sgn;
          if (!blocked(nx, nz)) return { x: nx, z: nz, hitX: true, hitZ: true };
        }
      }
    }
    return { x, z, hitX: true, hitZ: true };
  };
}
