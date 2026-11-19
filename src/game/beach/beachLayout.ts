import * as THREE from 'three';
import { NavGrid } from '../nav/NavGrid';
import type { Seat } from '../world';
import { LOUNGER_ANCHOR as LA, PRESETS } from '../../data/interactionRegistry';

/**
 * Yoo Plage — pure layout of the public beach location (no three.js rendering, no React; unit-tested).
 * Units: metres. The sea lies on the low-x side (top-left of the iso view), a boardwalk/pier runs
 * along the low-z edge (top-right), the café sits behind the boardwalk, sand fills the rest.
 * Everything rendered in BeachView is generated from these numbers, so nav, seats and visuals agree.
 */
export const BEACH = { w: 16, d: 11 } as const;
/** Boardwalk strip (walkable), extending into the sea as a pier down to x = pierEnd. */
export const BOARDWALK = { z0: 0.6, z1: 2.0, pierEnd: 1.4, top: 0.025 } as const;
/** Water edge (x of the shoreline) as a function of z. Mirrored in the water shader (render/beach/water.ts). */
export const shoreX = (z: number) => 3.4 + 0.45 * Math.sin(0.55 * z + 0.6) + 0.2 * Math.sin(1.3 * z);
export const onBoardwalk = (x: number, z: number) => z >= BOARDWALK.z0 && z <= BOARDWALK.z1 && x >= BOARDWALK.pierEnd && x <= BEACH.w;
export const inWater = (x: number, z: number) => x < shoreX(z) + 0.15 && !onBoardwalk(x, z);

export type PropKind = 'bench' | 'lounger' | 'towel' | 'parasol' | 'palm' | 'kiosk' | 'cafeTable' | 'cafeChair' | 'djBooth' | 'danceFloor' | 'rock' | 'sign' | 'lantern' | 'surfboards' | 'cooler' | 'castle';
export type PropAction = 'sit' | 'dance' | 'music' | 'order' | 'look';
export interface BeachProp {
  id: string; kind: PropKind; name: string; x: number; z: number; yaw: number;
  /** blocking footprint half-sizes in the prop's local frame (w along local x, d along local z); none = walkable */
  block?: { w: number; d: number };
  /** sitting slots: local x offsets; depth = forward offset of the hips from the prop centre */
  seat?: { slots: number[]; depth?: number; width: number };
  actions?: PropAction[];
  color?: string;
}

const P = (p: BeachProp) => p;
/** yaw convention = apartment/avatars: 0 faces +z (towards the camera), π/2 faces +x. */
const FACE_SEA = -Math.PI / 4; // diagonal towards the water and the camera
export const DANCE_FLOOR = { x: 13.5, z: 3.9, size: 2.4, tiles: 6 } as const;
export const CAFE = { x: 8.9, z: -0.15, w: 2.4, d: 1.3 } as const;

export const BEACH_PROPS: BeachProp[] = [
  // café kiosk behind the boardwalk + its terrace on the sand
  P({ id: 'cafe', kind: 'kiosk', name: 'Café Yoo', x: CAFE.x, z: CAFE.z, yaw: 0, block: { w: CAFE.w / 2, d: CAFE.d / 2 }, actions: ['order', 'look'] }),
  P({ id: 'table1', kind: 'cafeTable', name: 'Table de terrasse', x: 7.9, z: 3.3, yaw: 0, block: { w: 0.28, d: 0.28 }, actions: ['look'] }),
  P({ id: 'chair1a', kind: 'cafeChair', name: 'Chaise de terrasse', x: 7.35, z: 3.3, yaw: Math.PI / 2, block: { w: 0.2, d: 0.2 }, seat: { slots: [0], depth: 0.02, width: 0.42 }, actions: ['sit'] }),
  P({ id: 'chair1b', kind: 'cafeChair', name: 'Chaise de terrasse', x: 8.45, z: 3.3, yaw: -Math.PI / 2, block: { w: 0.2, d: 0.2 }, seat: { slots: [0], depth: 0.02, width: 0.42 }, actions: ['sit'] }),
  P({ id: 'table2', kind: 'cafeTable', name: 'Table de terrasse', x: 9.9, z: 3.6, yaw: 0, block: { w: 0.28, d: 0.28 }, actions: ['look'] }),
  P({ id: 'chair2a', kind: 'cafeChair', name: 'Chaise de terrasse', x: 9.35, z: 3.6, yaw: Math.PI / 2, block: { w: 0.2, d: 0.2 }, seat: { slots: [0], depth: 0.02, width: 0.42 }, actions: ['sit'] }),
  P({ id: 'chair2b', kind: 'cafeChair', name: 'Chaise de terrasse', x: 10.45, z: 3.6, yaw: -Math.PI / 2, block: { w: 0.2, d: 0.2 }, seat: { slots: [0], depth: 0.02, width: 0.42 }, actions: ['sit'] }),
  P({ id: 'surf', kind: 'surfboards', name: 'Planches de surf', x: 10.55, z: 0.25, yaw: 0, actions: ['look'] }),
  // benches on the boardwalk, backs to the café, facing the beach
  P({ id: 'bench1', kind: 'bench', name: 'Banc du ponton', x: 4.9, z: 0.86, yaw: 0, block: { w: 0.62, d: 0.2 }, seat: { slots: [-0.3, 0.3], depth: 0.02, width: 1.3 }, actions: ['sit'] }),
  P({ id: 'bench2', kind: 'bench', name: 'Banc du ponton', x: 6.6, z: 0.86, yaw: 0, block: { w: 0.62, d: 0.2 }, seat: { slots: [-0.3, 0.3], depth: 0.02, width: 1.3 }, actions: ['sit'] }),
  P({ id: 'bench3', kind: 'bench', name: 'Banc du ponton', x: 14.0, z: 0.86, yaw: 0, block: { w: 0.62, d: 0.2 }, seat: { slots: [-0.3, 0.3], depth: 0.02, width: 1.3 }, actions: ['sit'] }),
  // beach towels with low loungers (transats), parasols in between
  P({ id: 'towel1', kind: 'towel', name: 'Serviette rayée', x: 5.6, z: 5.3, yaw: FACE_SEA, actions: ['sit'], color: '#e2569b' }),
  P({ id: 'lounger1', kind: 'lounger', name: 'Transat', x: 5.6, z: 5.3, yaw: FACE_SEA, block: { w: 0.26, d: 0.42 }, seat: { slots: [0], depth: 0.12, width: 0.5 }, actions: ['sit'], color: '#ffc857' }),
  P({ id: 'towel2', kind: 'towel', name: 'Serviette rayée', x: 6.55, z: 6.3, yaw: FACE_SEA, actions: ['sit'], color: '#4f8be0' }),
  P({ id: 'lounger2', kind: 'lounger', name: 'Transat', x: 6.55, z: 6.3, yaw: FACE_SEA, block: { w: 0.26, d: 0.42 }, seat: { slots: [0], depth: 0.12, width: 0.5 }, actions: ['sit'], color: '#5cc2c9' }),
  P({ id: 'parasol1', kind: 'parasol', name: 'Parasol', x: 5.55, z: 4.55, yaw: 0, block: { w: 0.06, d: 0.06 }, color: '#e2569b' }),
  P({ id: 'towel3', kind: 'towel', name: 'Serviette rayée', x: 5.75, z: 8.3, yaw: FACE_SEA, actions: ['sit'], color: '#ff8a5c' }),
  P({ id: 'lounger3', kind: 'lounger', name: 'Transat', x: 5.75, z: 8.3, yaw: FACE_SEA, block: { w: 0.26, d: 0.42 }, seat: { slots: [0], depth: 0.12, width: 0.5 }, actions: ['sit'], color: '#e2569b' }),
  P({ id: 'towel4', kind: 'towel', name: 'Serviette rayée', x: 6.8, z: 9.2, yaw: FACE_SEA, actions: ['sit'], color: '#9b6be0' }),
  P({ id: 'lounger4', kind: 'lounger', name: 'Transat', x: 6.8, z: 9.2, yaw: FACE_SEA, block: { w: 0.26, d: 0.42 }, seat: { slots: [0], depth: 0.12, width: 0.5 }, actions: ['sit'], color: '#ffc857' }),
  P({ id: 'parasol2', kind: 'parasol', name: 'Parasol', x: 5.75, z: 7.5, yaw: 0, block: { w: 0.06, d: 0.06 }, color: '#4f8be0' }),
  P({ id: 'cooler', kind: 'cooler', name: 'Glacière', x: 7.25, z: 5.75, yaw: 0.4, block: { w: 0.2, d: 0.14 }, actions: ['look'] }),
  // DJ spot: booth at the back of a light-up dance floor
  P({ id: 'dj', kind: 'djBooth', name: 'Cabine DJ', x: DANCE_FLOOR.x - DANCE_FLOOR.size / 2 - 0.4, z: DANCE_FLOOR.z, yaw: Math.PI / 2, block: { w: 0.7, d: 0.28 }, actions: ['music', 'dance'] }),
  P({ id: 'floor', kind: 'danceFloor', name: 'Piste de danse', x: DANCE_FLOOR.x, z: DANCE_FLOOR.z, yaw: 0, actions: ['dance', 'music'] }),
  // palms (sand + behind the boardwalk), rocks by the water, welcome sign
  P({ id: 'palm1', kind: 'palm', name: 'Palmier', x: 4.5, z: 4.7, yaw: 0.4, block: { w: 0.16, d: 0.16 } }),
  P({ id: 'palm2', kind: 'palm', name: 'Palmier', x: 14.7, z: 9.4, yaw: 2.1, block: { w: 0.16, d: 0.16 } }),
  P({ id: 'palm3', kind: 'palm', name: 'Palmier', x: 12.2, z: 10.6, yaw: 4.0, block: { w: 0.16, d: 0.16 } }),
  P({ id: 'palm4', kind: 'palm', name: 'Palmier', x: 4.3, z: 10.6, yaw: 1.1, block: { w: 0.16, d: 0.16 } }),
  P({ id: 'palm5', kind: 'palm', name: 'Palmier', x: 3.6, z: 0.1, yaw: 5.2 }),
  P({ id: 'palm6', kind: 'palm', name: 'Palmier', x: 6.4, z: -0.35, yaw: 0.9 }),
  P({ id: 'palm7', kind: 'palm', name: 'Palmier', x: 11.8, z: -0.3, yaw: 3.0 }),
  P({ id: 'palm8', kind: 'palm', name: 'Palmier', x: 15.6, z: 0.05, yaw: 1.7 }),
  P({ id: 'rock1', kind: 'rock', name: 'Rochers', x: 3.9, z: 3.4, yaw: 0.5, block: { w: 0.3, d: 0.25 } }),
  P({ id: 'rock2', kind: 'rock', name: 'Rochers', x: 3.3, z: 10.0, yaw: 2.2, block: { w: 0.3, d: 0.25 } }),
  P({ id: 'castle', kind: 'castle', name: 'Château de sable', x: 4.7, z: 7.05, yaw: 0, block: { w: 0.3, d: 0.25 }, actions: ['look'] }),
  P({ id: 'sign', kind: 'sign', name: 'Panneau Yoo Plage', x: 4.6, z: 2.3, yaw: 0.25, block: { w: 0.5, d: 0.08 }, actions: ['look'] }),
];
/** Lantern posts along the front edge of the boardwalk and around the dance floor (string lights between them). */
export const LANTERN_POSTS: [number, number][] = [
  [2.2, 2.05], [4.0, 2.05], [5.8, 2.05], [7.4, 2.05], [10.4, 2.05], [12.2, 2.05], [15.2, 2.05],
  [DANCE_FLOOR.x - 1.35, DANCE_FLOOR.z + 1.35], [DANCE_FLOOR.x + 1.35, DANCE_FLOOR.z + 1.35],
];
export const BEACH_SPAWN = { player: new THREE.Vector3(7.2, 0, 1.3), buddy: new THREE.Vector3(7.95, 0, 1.75), yaw: 0.25 };
export const DANCE_SPOTS = [new THREE.Vector3(DANCE_FLOOR.x - 0.35, 0, DANCE_FLOOR.z + 0.1), new THREE.Vector3(DANCE_FLOOR.x + 0.4, 0, DANCE_FLOOR.z - 0.05)];
/** Camera framing box (same scale as the apartment so avatars read the same size on screen). */
export const BEACH_FRAME = { w: 7.2, d: 6, wallH: 1.55 };
export const BEACH_CENTER = new THREE.Vector3(8.8, 0.3, 4.2);

const fwdOf = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const rightOf = (yaw: number) => { const f = fwdOf(yaw); return new THREE.Vector3(f.z, 0, -f.x); };
export const propById = (id: string) => BEACH_PROPS.find((p) => p.id === id);

/** Walkable grid: sand + boardwalk/pier, minus the sea, the dunes behind the boardwalk and blocking props. */
export function beachNav(cell = 0.2) {
  const nav = new NavGrid(BEACH.w, BEACH.d, cell);
  for (let j = 0; j < nav.nz; j++) for (let i = 0; i < nav.nx; i++) {
    const c = nav.center(i, j);
    if (inWater(c.x, c.z) || c.z < BOARDWALK.z0 || c.x > BEACH.w - 0.3 || c.z > BEACH.d - 0.3) nav.blocked[nav.idx(i, j)] = 1;
  }
  // blocking props: oriented rectangles (+ a small pad), tested per cell centre
  for (const p of BEACH_PROPS) {
    if (!p.block) continue;
    const r = rightOf(p.yaw), f = fwdOf(p.yaw), pad = 0.08, R = Math.hypot(p.block.w, p.block.d) + pad;
    const [i0, j0] = nav.toCell(p.x - R, p.z - R), [i1, j1] = nav.toCell(p.x + R, p.z + R);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const c = nav.center(i, j); const dx = c.x - p.x, dz = c.z - p.z;
      if (Math.abs(dx * r.x + dz * r.z) <= p.block.w + pad && Math.abs(dx * f.x + dz * f.z) <= p.block.d + pad) nav.blocked[nav.idx(i, j)] = 1;
    }
  }
  return nav;
}
/** Seat registry for the beach: ids are `<propId>:<slot>` so freeSeat(propId, ...) works as for furniture. */
export function beachSeats(): Seat[] {
  const out: Seat[] = [];
  for (const p of BEACH_PROPS) {
    if (!p.seat) continue; const f = fwdOf(p.yaw), r = rightOf(p.yaw);
    if (p.kind === 'lounger') {
      const at = (x: number, z: number) => new THREE.Vector3(p.x, 0, p.z).addScaledVector(r, x).addScaledVector(f, z);
      const hip = at(0, LA.hipZ), edgeHip = at(0, LA.entryZ);
      const front = at(0, LA.front), approach = at(0, LA.entryZ + PRESETS.lounger.approach);
      out.push({ id: `${p.id}:0`, pos: hip.clone(), yaw: p.yaw, front, approach,
        hip, h: LA.h, edgeHip, edgeH: LA.h, pose: 'lie', kind: 'bed', preset: 'lounger' });
      continue;
    }
    p.seat.slots.forEach((sx, k) => {
      const pos = new THREE.Vector3(p.x, 0, p.z).addScaledVector(r, sx).addScaledVector(f, p.seat!.depth ?? 0);
      // café chairs face their table: step in from the camera side instead of from the front
      const front = p.kind === 'cafeChair' ? pos.clone().add(new THREE.Vector3(0, 0, 0.45)) : pos.clone().addScaledVector(f, p.kind === 'lounger' ? 0.62 : 0.42);
      out.push({ id: `${p.id}:${k}`, pos, yaw: p.yaw, front });
    });
  }
  return out;
}
export function beachWorld() { return { nav: beachNav(), seats: beachSeats() }; }
