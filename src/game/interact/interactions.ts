import type { FurnitureDef } from '../../data/furniture';
/**
 * Furniture interaction registry (pure, unit-tested): which actions a tapped object offers, in menu order.
 * The menu (ui/InteractionMenu) only renders these and calls GameController.interact; adding an interaction to a new
 * piece of furniture = data in data/furniture.ts (interaction type + seat anchors), no UI code.
 */
export type ActionId = 'sit' | 'lie' | 'sitEdge' | 'light' | 'tv' | 'watch' | 'music' | 'dance' | 'snack' | 'wardrobe' | 'look' | 'move';
export interface ActionSpec { id: ActionId; label: string }
export function actionsFor(def: FurnitureDef, on = false): ActionSpec[] {
  const A: ActionSpec[] = [];
  if (def.interaction === 'sit') A.push({ id: 'sit', label: '🪑 S’asseoir' });
  if (def.interaction === 'bed') {
    if (def.seat?.lie) A.push({ id: 'lie', label: '😴 S’allonger' });
    A.push({ id: 'sitEdge', label: '🛏️ S’asseoir sur le lit' });
  }
  if (def.interaction === 'light') A.push({ id: 'light', label: on ? '🌙 Éteindre' : '💡 Allumer' });
  if (def.interaction === 'tv') { A.push({ id: 'watch', label: '🛋️ Regarder la télé' }); A.push({ id: 'tv', label: on ? '📴 Éteindre la télé' : '📺 Allumer la télé' }); }
  if (def.interaction === 'music') { A.push({ id: 'music', label: on ? '🔇 Couper la musique' : '🎵 Mettre de la musique' }); A.push({ id: 'dance', label: '💃 Danser' }); }
  if (def.interaction === 'fridge') A.push({ id: 'snack', label: '🍓 Prendre un snack' });
  if (def.id === 'coatRackStanding') A.push({ id: 'wardrobe', label: '👗 Garde-robe' });
  if (def.interaction === 'look' || !def.interaction) A.push({ id: 'look', label: '👀 Regarder' });
  A.push({ id: 'move', label: '✥ Déplacer' });
  return A;
}
