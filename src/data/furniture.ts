import bounds from './furnitureBounds.json';

/** Data-driven furniture catalogue. To add an item: drop the GLB in public/models/furniture,
 *  run `python3 tools/furniture_bounds.py`, then add one entry below. */
export type Layer = 'floor' | 'rug' | 'top';
export type Rarity = 'common' | 'rare' | 'epic';
export type Interaction = 'sit' | 'bed' | 'light' | 'tv' | 'music' | 'fridge' | 'look';
export type Category = 'seating' | 'tables' | 'storage' | 'lighting' | 'decor' | 'kitchen' | 'bedroom' | 'electronics' | 'rugs';
export interface FurnitureDef {
  id: string; name: string; model: string; category: Category; layer: Layer; price: number; rarity: Rarity;
  size: { w: number; d: number; h: number };          // metres, kit scale applied (from furnitureBounds.json)
  surface?: number;                                   // top height (m) if 'top' items can be placed on it
  seat?: { slots: number[]; depth?: number };         // local x offsets of sitting spots
  interaction?: Interaction;
  light?: { y: number; color: string; intensity: number; distance: number };
  tint?: Record<string, string>;                      // per-item material colour overrides
}
const B = bounds as Record<string, { w: number; d: number; h: number }>;
const def = (id: string, name: string, category: Category, price: number, extra: Partial<FurnitureDef> = {}): FurnitureDef =>
  ({ id, name, model: extra.model ?? id, category, layer: 'floor', price, rarity: 'common', size: B[extra.model ?? id], ...extra });

export const FURNITURE: Record<string, FurnitureDef> = Object.fromEntries([
  def('loungeSofa', 'Canapé rose', 'seating', 180, { seat: { slots: [-0.27, 0.27] }, interaction: 'sit', surface: undefined }),
  def('loungeDesignSofa', 'Canapé design', 'seating', 260, { seat: { slots: [-0.32, 0.32] }, interaction: 'sit', rarity: 'rare' }),
  def('loungeSofaCorner', 'Canapé d’angle', 'seating', 320, { seat: { slots: [-0.3, 0.25] }, interaction: 'sit', rarity: 'rare' }),
  def('loungeChair', 'Fauteuil', 'seating', 110, { seat: { slots: [0] }, interaction: 'sit' }),
  def('chair', 'Chaise en bois', 'seating', 35, { seat: { slots: [0], depth: 0.05 }, interaction: 'sit' }),
  def('chairDesk', 'Chaise de bureau', 'seating', 60, { seat: { slots: [0] }, interaction: 'sit' }),
  def('stoolBar', 'Tabouret de bar', 'seating', 40, { seat: { slots: [0] }, interaction: 'sit' }),
  def('tableCoffee', 'Table basse', 'tables', 70, { surface: 0.276 }),
  def('tableRound', 'Table ronde', 'tables', 90, { surface: 0.44 }),
  def('desk', 'Bureau', 'tables', 120, { surface: 0.461 }),
  def('sideTable', 'Console', 'tables', 55, { surface: 0.461 }),
  def('sideTableDrawers', 'Commode', 'storage', 75, { surface: 0.461 }),
  def('bookcaseOpen', 'Étagère', 'storage', 80, { interaction: 'look' }),
  def('bookcaseClosedWide', 'Bibliothèque', 'storage', 140, { interaction: 'look' }),
  def('cabinetTelevision', 'Meuble TV', 'storage', 85, { surface: 0.372 }),
  def('coatRackStanding', 'Porte-manteau', 'decor', 30),
  def('bedDouble', 'Lit double', 'bedroom', 240, { seat: { slots: [-0.25, 0.25], depth: 0.42 }, interaction: 'bed' }),
  def('lampRoundFloor', 'Lampadaire', 'lighting', 65, { interaction: 'light', light: { y: 0.95, color: '#ffb870', intensity: 2.2, distance: 4 } }),
  def('lampSquareTable', 'Lampe de chevet', 'lighting', 35, { layer: 'top', interaction: 'light', light: { y: 0.3, color: '#ffc48a', intensity: 1.4, distance: 3 } }),
  def('televisionModern', 'Télé écran plat', 'electronics', 210, { layer: 'top', interaction: 'tv', rarity: 'rare' }),
  def('radio', 'Radio rétro', 'electronics', 60, { layer: 'top', interaction: 'music' }),
  def('laptop', 'Ordinateur portable', 'electronics', 150, { layer: 'top', interaction: 'look' }),
  def('speaker', 'Enceinte', 'electronics', 90, { interaction: 'music' }),
  def('pottedPlant', 'Plante verte', 'decor', 25),
  def('plantSmall1', 'Petite plante', 'decor', 12, { layer: 'top' }),
  def('plantSmall2', 'Cactus', 'decor', 12, { layer: 'top' }),
  def('books', 'Livres', 'decor', 10, { layer: 'top' }),
  def('bear', 'Ours en peluche', 'decor', 45, { layer: 'top', rarity: 'epic', interaction: 'look' }),
  def('cardboardBoxClosed', 'Carton', 'decor', 5),
  def('rugRectangle', 'Tapis rose', 'rugs', 50, { layer: 'rug' }),
  def('rugRound', 'Tapis rond', 'rugs', 40, { layer: 'rug' }),
  def('kitchenFridge', 'Frigo', 'kitchen', 160, { interaction: 'fridge' }),
  def('kitchenCabinet', 'Meuble de cuisine', 'kitchen', 70, { surface: 0.54 }),
  def('kitchenCabinetDrawer', 'Tiroirs de cuisine', 'kitchen', 75, { surface: 0.54 }),
  def('kitchenStove', 'Cuisinière', 'kitchen', 130, { interaction: 'look' }),
  def('kitchenSink', 'Évier', 'kitchen', 110),
  def('kitchenCoffeeMachine', 'Machine à café', 'kitchen', 55, { layer: 'top', interaction: 'look' }),
].map((d) => [d.id, d]));

export const CATEGORY_LABEL: Record<Category, string> = {
  seating: 'Assises', tables: 'Tables', storage: 'Rangement', lighting: 'Lumières', decor: 'Déco', kitchen: 'Cuisine', bedroom: 'Chambre', electronics: 'High-tech', rugs: 'Tapis',
};
export const RARITY_COLOR: Record<Rarity, string> = { common: '#8c84a3', rare: '#4f8be0', epic: '#b04fe0' };
