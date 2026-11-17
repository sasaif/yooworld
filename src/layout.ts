// Apartment layout (metres). Room interior: x in [0, ROOM_W], z in [0, ROOM_D].
// Walls on the back (z = 0) and left (x = 0) sides, open towards the camera (YoWorld-style cutaway).
export const S = 1.2;            // Kenney Furniture Kit scale (kit wall = 1.29 u -> 1.55 m)
export const TILE = 1 * S;
export const NX = 6, NZ = 5;     // wall tiles
export const ROOM_W = NX * TILE, ROOM_D = NZ * TILE;

export type Dir = 'N' | 'S' | 'E' | 'W'; // direction the FRONT of the item faces (+z = S, towards camera)
export interface Item { m: string; x: number; z: number; face?: Dir; y?: number; walk?: boolean; sx?: number; seat?: boolean; id?: string }

export const BACK_WALL = ['wall', 'wallWindow', 'wallWindow', 'wall', 'wallDoorway', 'wall'];
export const LEFT_WALL = ['wall', 'wallWindow', 'wall', 'wall', 'wall'];

export const ITEMS: Item[] = [
  // living corner
  { m: 'rugRectangle', x: 2.55, z: 1.55, walk: true },
  { m: 'loungeSofa', x: 2.55, z: 0.33, face: 'S', seat: true, id: 'sofa' },
  { m: 'tableCoffee', x: 2.55, z: 1.55 },
  { m: 'loungeChair', x: 3.95, z: 1.35, face: 'W', seat: true, id: 'chair' },
  { m: 'lampRoundFloor', x: 1.55, z: 0.28 },
  { m: 'pottedPlant', x: 3.55, z: 0.3 },
  { m: 'cabinetTelevision', x: 0.32, z: 1.6, face: 'E' },
  { m: 'televisionModern', x: 0.3, z: 1.6, y: 0.37, face: 'E', walk: true },
  { m: 'speaker', x: 0.3, z: 0.6, face: 'E' },
  // bedroom corner (left / front)
  { m: 'bedDouble', x: 1.2, z: 4.55, face: 'E', id: 'bed' },
  { m: 'sideTableDrawers', x: 0.3, z: 3.2, face: 'E' },
  { m: 'lampSquareTable', x: 0.3, z: 3.2, y: 0.52, walk: true },
  { m: 'bear', x: 0.6, z: 4.0, y: 0.45, face: 'E', walk: true },
  // kitchen (back / right)
  { m: 'kitchenFridge', x: 6.85, z: 0.38, face: 'S' },
  { m: 'kitchenCabinetDrawer', x: 6.18, z: 0.33, face: 'S' },
  { m: 'kitchenStove', x: 6.85, z: 1.2, face: 'W' },
  { m: 'kitchenCabinet', x: 6.85, z: 1.95, face: 'W' },
  { m: 'kitchenCoffeeMachine', x: 6.18, z: 0.3, y: 0.52, face: 'S', walk: true },
  { m: 'rugRound', x: 5.7, z: 1.6, walk: true },
  // dining
  { m: 'tableRound', x: 5.4, z: 3.9 },
  { m: 'chair', x: 4.75, z: 3.9, face: 'E' },
  { m: 'chair', x: 6.05, z: 3.9, face: 'W' },
  { m: 'bookcaseOpen', x: 4.25, z: 0.3, face: 'S' },
  { m: 'books', x: 4.25, z: 0.28, y: 0.62, walk: true },
  { m: 'plantSmall2', x: 4.25, z: 0.28, y: 0.95, walk: true },
  { m: 'coatRackStanding', x: 5.05, z: 0.3 },
  { m: 'pottedPlant', x: 0.35, z: 5.65 },
  { m: 'cardboardBoxClosed', x: 6.8, z: 5.6, face: 'W' },
];

// Material palette override (Kenney kit shares material names) – warm YoWorld-ish pastels
export const PALETTE: Record<string, string> = {
  carpet: '#e58fb0', carpetDarker: '#b9658a', carpetWhite: '#fff6f0', wood: '#d9a273', woodDark: '#9c6a48',
  _defaultMat: '#f7e7d6', metal: '#cfd6e6', metalLight: '#f4f1ee', metalDark: '#53506a', plant: '#5cc28f',
};
