import type { ItemDef } from './types';
import { CATEGORIES } from './catalogue';
/** Catalogue validation (run in tests and at dev start): catches typos in data-only item additions. */
const SLOT_CATEGORY: Record<string, string[]> = {
  face: ['faceShape', 'skin', 'details.freckles', 'details.mole', 'details.blush', 'details.sticker', 'makeup.lips', 'makeup.eyes', 'makeup.liner'],
  eyes: ['eyes', 'eyeColor', 'makeup.eyes'], brows: ['brows'], nose: ['nose'], mouth: ['mouth'], hair: ['hair', 'hairColor'], beard: ['beard'], tshirt: ['top'], dress: ['top'], jacket: ['jacket'], pants: ['pants'], shoes: ['shoes'],
  accessory: ['acc.glasses', 'acc.earrings', 'acc.necklace', 'acc.hat', 'acc.bag', 'acc.wrist', 'acc.neck2', 'acc.head2'],
};
const HEX = /^#[0-9a-f]{6}$/i;
export function validateCatalogue(items: ItemDef[]): string[] {
  const errs: string[] = []; const ids = new Set<string>();
  for (const i of items) {
    const e = (m: string) => errs.push(`${i.id}: ${m}`);
    if (!/^[a-z0-9_]+$/.test(i.id)) e('id invalide');
    if (ids.has(i.id)) e('id en double'); ids.add(i.id);
    if (!i.name?.trim()) e('nom manquant');
    if (!CATEGORIES.some((c) => c.id === i.category)) e('catégorie inconnue');
    if (!SLOT_CATEGORY[i.category]?.includes(i.slot)) e(`slot ${i.slot} hors catégorie ${i.category}`);
    if (!['common', 'rare', 'epic', 'legendary'].includes(i.rarity)) e('rareté inconnue');
    if (i.price) {
      if (!['gold', 'diamond'].includes(i.price.currency)) e('devise inconnue');
      if (!Number.isSafeInteger(i.price.amount) || i.price.amount <= 0) e('prix invalide');
    }
    for (const k of ['color', 'color2', 'trim'] as const) { const c = i.render[k]; if (c !== undefined && !HEX.test(c)) e(`${k} invalide`); }
    if (i.slot === 'hair' && !i.render.hair) e('style de coiffure manquant');
    if (i.slot === 'beard' && !i.render.beard) e('style de barbe manquant');
    if (i.slot.startsWith('acc.') && !i.render.acc) e('modèle d’accessoire manquant');
    if (i.category === 'beard' && i.body !== 'm') e('barbe = homme uniquement');
    if (i.category === 'dress' && (!i.render.dress || i.body !== 'f')) e('robe = recette dress + corps femme');
    for (const k of ['lacing', 'gloves', 'legs', 'shoe', 'lens2'] as const) { const c = i.render[k]; if (c !== undefined && !HEX.test(c)) e(`${k} invalide`); }
  }
  return errs;
}
