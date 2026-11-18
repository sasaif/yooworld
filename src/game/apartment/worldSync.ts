import * as THREE from 'three';
import { NavGrid } from '../nav/NavGrid';
import { blockingFootprints, CELL, itemTransform, type ApartmentLayout, type Catalog } from './ApartmentModel';
import { world, type Seat } from '../world';
import { INTERACTIONS, PRESETS } from '../../data/interactionRegistry';

/** Rebuild navigation + seats after any layout change, and keep characters in valid spots. */
export function syncWorld(layout: ApartmentLayout, cat: Catalog) {
  const W = layout.cols * CELL, D = layout.rows * CELL;
  const nav = new NavGrid(W, D, 0.2);
  nav.blockBox(0, 0, W, 0.12, 0); nav.blockBox(0, 0, 0.12, D, 0);
  for (const f of blockingFootprints(layout, cat)) nav.blockBox(f.x * CELL, f.z * CELL, (f.x + f.w) * CELL, (f.z + f.d) * CELL, 0.06);
  world.nav = nav; world.seats = computeSeats(layout, cat); resolveApproaches(world.seats, nav);
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
    const depth = def.size.d; // model depth along its own forward axis
    const at = (x: number, z: number) => new THREE.Vector3(t.x, 0, t.z).addScaledVector(right, x).addScaledVector(fwd, z);
    const reg = INTERACTIONS[def.id];
    if (reg) {
      // data-driven slots (data/interactionRegistry.ts): per-slot cushion height, hips point, preset, approach point
      const sits = reg.sit.map((s, k): Seat => {
        const pos = at(s.x, reg.depth ?? 0.04); const front = at(s.x, depth / 2 + 0.22); const hip = at(s.x, s.hipZ);
        const P = PRESETS[s.preset]; const ap = Math.min(s.hipZ + P.approach, depth / 2 + 0.22);
        return { id: `${it.uid}:${k}`, pos, yaw: t.yaw, front, pose: 'sit', h: s.h, hip, kind: P.kind, preset: s.preset, approach: at(s.x, ap) };
      });
      out.push(...sits);
      reg.lie?.forEach((l, k) => {
        const e = sits[l.edge]; const hip = at(l.x, l.footZ);
        out.push({ id: `${it.uid}:L${k}`, pos: hip.clone(), yaw: t.yaw, front: e.front.clone(), pose: 'lie', h: l.h, hip, kind: 'bed', preset: 'lie', approach: e.approach!.clone(), edgeHip: e.hip!.clone(), edgeH: e.h });
      });
      continue;
    }
    const st = def.seat; // catalogue items without a registry entry (none in the starter flat): legacy single-height seats
    st.slots.forEach((sx, k) => {
      const pos = at(sx, st.depth ?? 0.04);
      const hip = st.hipZ !== undefined ? at(sx, st.hipZ) : undefined;
      out.push({ id: `${it.uid}:${k}`, pos, yaw: t.yaw, front: pos.clone().addScaledVector(fwd, depth / 2 + 0.22 - (st.depth ?? 0)), pose: 'sit', h: st.h, hip, kind: st.kind });
    });
  }
  return out;
}
/**
 * A seat whose front is blocked (dining chair pushed under the table, sofa against a bed…): get on it from the side
 * instead (walk-to point and approach point beside the seat, the avatar then slides sideways onto it), so the last
 * metres are walked, never slid through furniture. Sides are tried nearest-free first.
 */
export function resolveApproaches(seats: Seat[], nav: NavGrid) {
  const freeAt = (p: THREE.Vector3) => { const [i, j] = nav.toCell(p.x, p.z); return nav.free(i, j); };
  const R = new THREE.Vector3(), q = new THREE.Vector3();
  for (const s of seats) {
    if (!s.hip || !s.approach || freeAt(s.front)) continue;
    // walk-to point just inside the furniture padding: step a little further out first
    const F = new THREE.Vector3(Math.sin(s.yaw), 0, Math.cos(s.yaw)); let moved = false;
    for (const d of [0.1, 0.2]) { q.copy(s.front).addScaledVector(F, d); if (freeAt(q)) { s.front = q.clone(); moved = true; break; } }
    if (moved) continue;
    const hip = s.edgeHip ?? s.hip; R.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    found: for (const [lat, fw] of [[0.45, 0], [0.45, 0.15], [0.6, 0], [0.6, 0.2], [0.45, -0.1]]) for (const side of [1, -1]) {
      q.copy(hip).addScaledVector(R, side * lat).addScaledVector(F, fw).setY(0);
      if (!freeAt(q)) continue;
      s.front = q.clone(); s.approach = hip.clone().addScaledVector(R, side * 0.32).setY(0); break found;
    }
  }
}
/** Nearest seat slot of an item that nobody uses. */
export function freeSeat(uid: string, from: THREE.Vector3, selfId: string, pose: 'sit' | 'lie' = 'sit') {
  const others = Object.values(world.chars).filter((c) => c.id !== selfId).map((c) => c.sitOn ?? c.pendingSeat).filter((s): s is Seat => !!s);
  // a bed slot is one place whether you sit on its edge or lie on it: 'uid:1' and 'uid:L1' exclude each other
  const taken = new Set(others.flatMap((s) => [s.id, s.id.replace(':L', ':'), s.id.replace(/:(\d+)$/, ':L$1')]));
  return world.seats.filter((s) => s.id.startsWith(uid + ':') && (s.pose ?? 'sit') === pose && !taken.has(s.id)).sort((a, b) => a.front.distanceTo(from) - b.front.distanceTo(from))[0];
}
/** Nearest free sitting spot (any furniture) whose front faces `target` (e.g. a TV) within `maxDist` metres. */
export function seatFacing(target: THREE.Vector3, from: THREE.Vector3, selfId: string, maxDist = 5, minDot = 0.6) {
  const taken = new Set(Object.values(world.chars).filter((c) => c.id !== selfId).map((c) => (c.sitOn ?? c.pendingSeat)?.id.replace(':L', ':')));
  const to = new THREE.Vector3();
  return world.seats.filter((s) => {
    if ((s.pose ?? 'sit') !== 'sit' || taken.has(s.id)) return false;
    to.subVectors(target, s.pos).setY(0); const d = to.length(); if (d > maxDist || d < 0.5) return false;
    return (Math.sin(s.yaw) * to.x + Math.cos(s.yaw) * to.z) / d >= minDot;
  }).sort((a, b) => a.pos.distanceTo(target) + 0.3 * a.front.distanceTo(from) - (b.pos.distanceTo(target) + 0.3 * b.front.distanceTo(from)))[0];
}
