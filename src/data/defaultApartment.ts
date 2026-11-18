import { CELL, footprintSize, type ApartmentLayout, type PlacedItem, type Rot } from '../game/apartment/ApartmentModel';
import { FURNITURE } from './furniture';

/** Starter apartment (same furniture arrangement as the original prototype), expressed in cells. */
export const APT_COLS = 24, APT_ROWS = 20; // 7.2 m x 6 m
let n = 0;
/** Place by centre in metres (as authored in the first prototype) -> min cell. */
function at(defId: string, cx: number, cz: number, rot: Rot = 0, on?: boolean): PlacedItem {
  const s = footprintSize(FURNITURE[defId], rot);
  return { uid: `start_${n++}`, defId, x: Math.round(cx / CELL - s.w / 2), z: Math.round(cz / CELL - s.d / 2), rot, ...(on ? { on } : {}) };
}
export function defaultApartment(ownerId: string): ApartmentLayout {
  n = 0;
  return {
    version: 1, id: `home_${ownerId}`, ownerId, name: 'Mon appart', cols: APT_COLS, rows: APT_ROWS, floor: 'oak', wall: 'peach',
    doorCells: [[16, 0], [17, 0], [18, 0], [19, 0], [17, 1], [18, 1]],
    items: [
      at('rugRectangle', 2.55, 1.55), at('loungeSofa', 2.55, 0.3), at('tableCoffee', 2.55, 1.5),
      at('loungeChair', 3.95, 1.35, 3), at('lampRoundFloor', 1.55, 0.3, 0, true), at('pottedPlant', 3.45, 0.3),
      at('cabinetTelevision', 0.3, 1.65, 1), at('televisionModern', 0.3, 1.65, 1), at('speaker', 0.3, 0.6, 1),
      at('bedDouble', 1.05, 4.6, 1), at('sideTableDrawers', 0.3, 3.15, 1), at('lampSquareTable', 0.3, 3.15, 1, true),
      at('kitchenFridge', 6.85, 0.3), at('kitchenCabinetDrawer', 6.2, 0.3), at('kitchenStove', 6.9, 1.2, 3), at('kitchenCabinet', 6.9, 1.85, 3),
      at('kitchenCoffeeMachine', 6.2, 0.3), at('rugRound', 5.7, 1.65),
      at('tableRound', 5.4, 3.9), at('chair', 4.75, 3.9, 1), at('chair', 6.05, 3.9, 3), at('plantSmall2', 5.4, 3.9),
      at('bookcaseOpen', 4.25, 0.3), at('pottedPlant', 0.35, 5.65), at('cardboardBoxClosed', 6.85, 5.65, 3), at('radio', 2.7, 1.5),
    ],
  };
}
/** What a new player owns in storage on day one. */
export const STARTER_INVENTORY: Record<string, number> = { plantSmall1: 2, books: 2, bear: 1, chair: 1, lampSquareTable: 1 };
