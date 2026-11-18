import type { FurnitureDef } from '../../data/furniture';

/** Pure apartment logic (no three.js / React): placement, collision, layout edits. Unit-tested. */
export const CELL = 0.3; // metres per placement cell
export type Rot = 0 | 1 | 2 | 3; // quarter turns; 0 = front faces +z (towards camera), 1 = +x, 2 = -z, 3 = -x

export interface PlacedItem { uid: string; defId: string; x: number; z: number; rot: Rot; on?: boolean }
export interface ApartmentLayout {
  version: 1; id: string; ownerId: string; name: string;
  cols: number; rows: number;            // interior size in cells
  floor: string; wall: string;           // finish ids
  doorCells: [number, number][];         // kept free so the entrance stays reachable
  items: PlacedItem[];
}
export type Catalog = Record<string, FurnitureDef>;
export interface Footprint { x: number; z: number; w: number; d: number }

export function footprintSize(def: FurnitureDef, rot: Rot) {
  const w = Math.max(1, Math.ceil(def.size.w / CELL - 0.15)), d = Math.max(1, Math.ceil(def.size.d / CELL - 0.15));
  return rot % 2 ? { w: d, d: w } : { w, d };
}
export function footprint(it: Pick<PlacedItem, 'x' | 'z' | 'rot' | 'defId'>, cat: Catalog): Footprint {
  const s = footprintSize(cat[it.defId], it.rot); return { x: it.x, z: it.z, w: s.w, d: s.d };
}
const overlap = (a: Footprint, b: Footprint) => a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d;
const inside = (a: Footprint, b: Footprint) => a.x >= b.x && a.z >= b.z && a.x + a.w <= b.x + b.w && a.z + a.d <= b.z + b.d;
/** Centre of an item in metres + yaw (radians). */
export function itemTransform(it: PlacedItem, cat: Catalog) {
  const f = footprint(it, cat); return { x: (f.x + f.w / 2) * CELL, z: (f.z + f.d / 2) * CELL, yaw: (it.rot * Math.PI) / 2 };
}

export type PlaceResult = { ok: true; parent?: string } | { ok: false; reason: 'bounds' | 'collision' | 'door' | 'noSurface' | 'unknown' };
/** Can `cand` be placed (ignoring the item with uid `ignore`, e.g. the one being moved)? */
export function canPlace(layout: ApartmentLayout, cat: Catalog, cand: Omit<PlacedItem, 'uid'>, ignore?: string): PlaceResult {
  const def = cat[cand.defId]; if (!def) return { ok: false, reason: 'unknown' };
  const f = footprint(cand, cat);
  if (f.x < 0 || f.z < 0 || f.x + f.w > layout.cols || f.z + f.d > layout.rows) return { ok: false, reason: 'bounds' };
  const others = layout.items.filter((o) => o.uid !== ignore && o.uid !== undefined);
  if (def.layer === 'floor') {
    if (layout.doorCells.some(([x, z]) => overlap(f, { x, z, w: 1, d: 1 }))) return { ok: false, reason: 'door' };
    for (const o of others) if (cat[o.defId].layer === 'floor' && overlap(f, footprint(o, cat))) return { ok: false, reason: 'collision' };
    return { ok: true };
  }
  if (def.layer === 'rug') {
    for (const o of others) if (cat[o.defId].layer === 'rug' && overlap(f, footprint(o, cat))) return { ok: false, reason: 'collision' };
    return { ok: true };
  }
  // 'top': must sit entirely on one surface, and not overlap other tops on it
  const parent = others.find((o) => cat[o.defId].surface !== undefined && inside(f, footprint(o, cat)));
  if (!parent) return { ok: false, reason: 'noSurface' };
  for (const o of others) if (cat[o.defId].layer === 'top' && overlap(f, footprint(o, cat))) return { ok: false, reason: 'collision' };
  return { ok: true, parent: parent.uid };
}

/** Surface height under a 'top' item (0 for floor/rug items). */
export function baseHeight(layout: ApartmentLayout, cat: Catalog, it: PlacedItem) {
  if (cat[it.defId].layer !== 'top') return 0;
  const f = footprint(it, cat);
  const p = layout.items.find((o) => o.uid !== it.uid && cat[o.defId].surface !== undefined && inside(f, footprint(o, cat)));
  return p ? cat[p.defId].surface! : 0;
}
/** Items resting on `uid`. */
export function childrenOf(layout: ApartmentLayout, cat: Catalog, uid: string) {
  const p = layout.items.find((o) => o.uid === uid); if (!p || cat[p.defId].surface === undefined) return [];
  const pf = footprint(p, cat);
  return layout.items.filter((o) => o.uid !== uid && cat[o.defId].layer === 'top' && inside(footprint(o, cat), pf));
}

let seq = 0;
export const newUid = () => `it_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export type EditResult = { ok: true; layout: ApartmentLayout; stored?: string[] } | { ok: false; reason: string };
export function placeItem(layout: ApartmentLayout, cat: Catalog, it: Omit<PlacedItem, 'uid'> & { uid?: string }): EditResult {
  const r = canPlace(layout, cat, it); if (!r.ok) return r;
  return { ok: true, layout: { ...layout, items: [...layout.items, { ...it, uid: it.uid ?? newUid() }] } };
}
/** Move/rotate an item; its 'top' children travel with it (rotated around the parent if needed). */
export function moveItem(layout: ApartmentLayout, cat: Catalog, uid: string, x: number, z: number, rot: Rot): EditResult {
  const it = layout.items.find((o) => o.uid === uid); if (!it) return { ok: false, reason: 'unknown' };
  const kids = childrenOf(layout, cat, uid);
  const without = { ...layout, items: layout.items.filter((o) => o.uid !== uid && !kids.includes(o)) };
  const moved = { ...it, x, z, rot };
  const r = canPlace(without, cat, moved); if (!r.ok) return r;
  const of = footprint(it, cat), nf = footprint(moved, cat);
  const turns = ((rot - it.rot + 4) % 4) as Rot;
  const movedKids: PlacedItem[] = [];
  for (const k of kids) {
    const kf = footprint(k, cat);
    // child offset (in cells) relative to the parent's min corner, rotated by `turns` quarter turns (+90° yaw maps local +z to +x)
    let ox = kf.x - of.x, oz = kf.z - of.z, w = kf.w, d = kf.d, W = of.w, D = of.d;
    for (let t = 0; t < turns; t++) { const nx = oz; const nz = W - ox - w; ox = nx; oz = nz; [w, d] = [d, w]; [W, D] = [D, W]; }
    movedKids.push({ ...k, x: nf.x + ox, z: nf.z + oz, rot: ((k.rot + turns) % 4) as Rot });
  }
  const next = { ...without, items: [...without.items, moved, ...movedKids] };
  return { ok: true, layout: next };
}
export function rotateItem(layout: ApartmentLayout, cat: Catalog, uid: string): EditResult {
  const it = layout.items.find((o) => o.uid === uid); if (!it) return { ok: false, reason: 'unknown' };
  const rot = ((it.rot + 1) % 4) as Rot; const a = footprint(it, cat), b = footprintSize(cat[it.defId], rot);
  // rotate around the footprint centre (snapped to the grid)
  const x = Math.round(a.x + a.w / 2 - b.w / 2), z = Math.round(a.z + a.d / 2 - b.d / 2);
  return moveItem(layout, cat, uid, x, z, rot);
}
/** Remove an item (and what stands on it). Returned `stored` def ids go back to the inventory. */
export function removeItem(layout: ApartmentLayout, cat: Catalog, uid: string): EditResult {
  const it = layout.items.find((o) => o.uid === uid); if (!it) return { ok: false, reason: 'unknown' };
  const kids = childrenOf(layout, cat, uid); const gone = new Set([uid, ...kids.map((k) => k.uid)]);
  return { ok: true, layout: { ...layout, items: layout.items.filter((o) => !gone.has(o.uid)) }, stored: [it.defId, ...kids.map((k) => k.defId)] };
}
export function toggleItem(layout: ApartmentLayout, uid: string): ApartmentLayout {
  return { ...layout, items: layout.items.map((o) => (o.uid === uid ? { ...o, on: !o.on } : o)) };
}
/** First valid spot for a new item, scanning from a preferred cell outwards. */
export function findSpot(layout: ApartmentLayout, cat: Catalog, defId: string, prefX: number, prefZ: number, rot: Rot = 0) {
  for (let r = 0; r < Math.max(layout.cols, layout.rows); r++)
    for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const c = { defId, x: prefX + dx, z: prefZ + dz, rot };
      if (canPlace(layout, cat, c).ok) return c;
    }
  return null;
}
/** Cells (x,z) that block walking: floor-layer items. */
export function blockingFootprints(layout: ApartmentLayout, cat: Catalog) {
  return layout.items.filter((o) => cat[o.defId].layer === 'floor').map((o) => footprint(o, cat));
}
