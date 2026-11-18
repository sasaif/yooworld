import * as THREE from 'three';
import { NavGrid } from '../nav/NavGrid';
import { blockingFootprints, CELL, itemTransform, type ApartmentLayout, type Catalog } from './ApartmentModel';
import { world, type Seat } from '../world';

/** Rebuild navigation + seats after any layout change, and keep characters in valid spots. */
export function syncWorld(layout: ApartmentLayout, cat: Catalog) {
  const W = layout.cols * CELL, D = layout.rows * CELL;
  const nav = new NavGrid(W, D, 0.2);
  nav.blockBox(0, 0, W, 0.12, 0); nav.blockBox(0, 0, 0.12, D, 0);
  for (const f of blockingFootprints(layout, cat)) nav.blockBox(f.x * CELL, f.z * CELL, (f.x + f.w) * CELL, (f.z + f.d) * CELL, 0.06);
  world.nav = nav; world.seats = computeSeats(layout, cat);
  for (const c of Object.values(world.chars)) {
    if (c.sitOn && !world.seats.some((s) => s.id === c.sitOn!.id)) { c.mode = 'idle'; c.sitOn = undefined; c.pos.y = 0; }
    if (c.mode === 'sitting') continue;
    const [i, j] = nav.toCell(c.pos.x, c.pos.z);
    if (!nav.free(i, j)) { const [a, b] = nav.nearestFree(i, j); c.pos.copy(nav.center(a, b)); c.path = []; }
    else if (c.path.length) { const end = c.path[c.path.length - 1]; c.path = nav.path(c.pos, end); }
  }
}
export function computeSeats(layout: ApartmentLayout, cat: Catalog): Seat[] {
  const out: Seat[] = [];
  for (const it of layout.items) {
    const def = cat[it.defId]; if (!def.seat) continue;
    const t = itemTransform(it, cat); const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw)); const right = new THREE.Vector3(fwd.z, 0, -fwd.x);
    const depth = it.rot % 2 ? def.size.d : def.size.d; // model depth along its own forward axis
    def.seat.slots.forEach((sx, k) => {
      const pos = new THREE.Vector3(t.x, 0, t.z).addScaledVector(right, sx).addScaledVector(fwd, def.seat!.depth ?? 0.04);
      out.push({ id: `${it.uid}:${k}`, pos, yaw: t.yaw, front: pos.clone().addScaledVector(fwd, depth / 2 + 0.22 - (def.seat!.depth ?? 0)) });
    });
  }
  return out;
}
/** Nearest seat slot of an item that nobody uses. */
export function freeSeat(uid: string, from: THREE.Vector3, selfId: string) {
  const taken = new Set(Object.values(world.chars).filter((c) => c.id !== selfId).map((c) => (c.sitOn ?? c.pendingSeat)?.id));
  return world.seats.filter((s) => s.id.startsWith(uid + ':') && !taken.has(s.id)).sort((a, b) => a.front.distanceTo(from) - b.front.distanceTo(from))[0];
}
