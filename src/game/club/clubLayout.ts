import * as THREE from 'three';
import { FURNITURE } from '../../data/furniture';
import { CELL, footprintSize, itemTransform, type ApartmentLayout, type PlacedItem, type Rot } from '../apartment/ApartmentModel';

/**
 * Yoo Games Club — pure layout (no rendering; unit-tested). The club is a fixed, NON-saved room built from Kenney kit
 * furniture already in the repo, laid out with the apartment's cell model so that navigation, seats, sit/stand
 * transitions and the approach logic (game/apartment/worldSync.ts) are reused unchanged.
 * Same footprint as the apartment (24 × 20 cells = 7.2 × 6 m, same wall kit) → identical camera framing (avatars ~93 px).
 */
export const CLUB_COLS = 24, CLUB_ROWS = 20;
let n = 0;
function at(defId: string, cx: number, cz: number, rot: Rot = 0, uid?: string): PlacedItem {
  const s = footprintSize(FURNITURE[defId], rot);
  return { uid: uid ?? `club_${n++}`, defId, x: Math.round(cx / CELL - s.w / 2), z: Math.round(cz / CELL - s.d / 2), rot };
}
/** A game table: the table item and its chairs in clockwise order starting at the north chair (back-wall side). */
export interface ClubTable { id: string; gameId: string; name: string; table: string; chairs: string[] }

/** chairs around a coffee table (0.9 × 0.6 m footprint): N faces the camera (+z), then E, S, W (clockwise from above) */
function tableSet(id: string, cx: number, cz: number, chairs: ('N' | 'E' | 'S' | 'W')[]): PlacedItem[] {
  const out = [at('tableCoffee', cx, cz, 0, `${id}`)];
  const P = { N: [cx, cz - 0.5, 0], E: [cx + 0.75, cz, 3], S: [cx, cz + 0.5, 2], W: [cx - 0.75, cz, 1] } as const;
  for (const c of chairs) { const [x, z, r] = P[c]; out.push(at('chair', x, z, r as Rot, `${id}_${c}`)); }
  return out;
}
export function clubLayout(): ApartmentLayout {
  n = 0;
  return {
    version: 1, id: 'public:club', ownerId: 'club', name: 'Yoo Games Club', cols: CLUB_COLS, rows: CLUB_ROWS, floor: 'walnut', wall: 'night',
    doorCells: [[16, 0], [17, 0], [18, 0], [19, 0]],
    items: [
      at('rugRectangle', 3.3, 3.0),
      ...tableSet('t_dominoes', 3.3, 3.0, ['N', 'E', 'S', 'W']),
      ...tableSet('t_belote', 1.35, 4.95, ['N', 'E', 'S', 'W']),
      ...tableSet('t_checkers', 5.85, 4.65, ['E', 'W']),
      at('bookcaseOpen', 0.3, 0.3), at('bookcaseClosedWide', 0.3, 2.1, 1), at('pottedPlant', 4.45, 0.3), at('pottedPlant', 6.85, 0.3),
      at('loungeChair', 6.65, 1.25, 3), at('pottedPlant', 0.35, 5.7), at('pottedPlant', 6.9, 5.7),
    ],
  };
}
export const CLUB = clubLayout();
export const CLUB_TABLES: ClubTable[] = [
  { id: 't_dominoes', gameId: 'dominoes', name: 'Table de dominos', table: 't_dominoes', chairs: ['N', 'E', 'S', 'W'].map((c) => `t_dominoes_${c}`) },
  { id: 't_belote', gameId: 'belote', name: 'Table de belote', table: 't_belote', chairs: ['N', 'E', 'S', 'W'].map((c) => `t_belote_${c}`) },
  { id: 't_checkers', gameId: 'checkers', name: 'Table de dames', table: 't_checkers', chairs: ['E', 'W'].map((c) => `t_checkers_${c}`) },
];
export const tableOf = (uid: string) => CLUB_TABLES.find((t) => t.table === uid || t.chairs.includes(uid));
/**
 * Chairs used for `count` players, clockwise from the human's chair (seat 0 = the human):
 * 2 players sit face to face, 3 players leave the chair opposite... the human's left free, 4 use every chair.
 */
export function chairsFor(t: ClubTable, humanChair: string, count: number): string[] {
  const k = Math.max(0, t.chairs.indexOf(humanChair)); const ring = [...t.chairs.slice(k), ...t.chairs.slice(0, k)];
  if (ring.length !== 4) return ring.slice(0, count);
  if (count === 2) return [ring[0], ring[2]];
  if (count === 3) return [ring[0], ring[1], ring[3]];
  return ring;
}
export const CLUB_SPAWN = { player: new THREE.Vector3(5.25, 0, 0.95), buddy: new THREE.Vector3(5.85, 0, 1.3), yaw: 0.2 };
/** centre of an item (metres) */
export const clubItemPos = (uid: string) => { const it = CLUB.items.find((i) => i.uid === uid)!; return itemTransform(it, FURNITURE); };
