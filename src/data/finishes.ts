/** Floor and wall finishes (data-driven, procedural textures generated in render/finishTextures.ts). */
export interface FloorFinish { id: string; name: string; kind: 'planks' | 'tiles' | 'carpet'; a: string; b: string; price: number }
export interface WallFinish { id: string; name: string; kind: 'paint' | 'stripes' | 'dots'; a: string; b: string; price: number }
export const FLOORS: FloorFinish[] = [
  { id: 'oak', name: 'Parquet chêne', kind: 'planks', a: '#d9a273', b: '#b9845a', price: 0 },
  { id: 'walnut', name: 'Parquet noyer', kind: 'planks', a: '#9c6a48', b: '#7f5236', price: 60 },
  { id: 'mint', name: 'Carreaux menthe', kind: 'tiles', a: '#cdeee0', b: '#a8dcc8', price: 80 },
  { id: 'candy', name: 'Damier bonbon', kind: 'tiles', a: '#ffe0ec', b: '#f6b8cf', price: 80 },
  { id: 'lilac', name: 'Moquette lilas', kind: 'carpet', a: '#c9b5e8', b: '#b9a2dc', price: 50 },
];
export const WALLS: WallFinish[] = [
  { id: 'peach', name: 'Pêche', kind: 'paint', a: '#f6d6cf', b: '#e7d8f3', price: 0 },
  { id: 'sky', name: 'Bleu ciel', kind: 'paint', a: '#d4e6fb', b: '#c3d9f6', price: 30 },
  { id: 'stripes', name: 'Rayures rose', kind: 'stripes', a: '#fbe3ea', b: '#f3c5d4', price: 60 },
  { id: 'mintdots', name: 'Pois menthe', kind: 'dots', a: '#e3f6ee', b: '#b9e6d3', price: 60 },
  { id: 'night', name: 'Nuit', kind: 'paint', a: '#5b5486', b: '#4c4677', price: 40 },
];
export const floorById = (id: string) => FLOORS.find((f) => f.id === id) ?? FLOORS[0];
export const wallById = (id: string) => WALLS.find((f) => f.id === id) ?? WALLS[0];
