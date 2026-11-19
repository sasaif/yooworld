import type { ItemDef } from '../../fashion/types';
/** Face v2 catalogue additions. ADDITIVE ONLY: new ids, free (owned by everyone), existing ids and DEFAULT_LOOK untouched,
 *  so every saved look (`yooworld:look:<acct>:<f|m>` = {v:1, body, slots}) renders exactly as before.
 *  - mouth_smile : new smiling mouth (same slot as mouth_base; no lip-shape morph)
 *  - eyes_sparkle: round eyes with iris ×1.18 + catchlights (same slot as eyes_round; no eye-shape morph) */
export const FACE_V2_IDS = { smile: 'mouth_smile', sparkle: 'eyes_sparkle' } as const;
export const FACE_V2_ITEMS: ItemDef[] = [
  { id: FACE_V2_IDS.sparkle, name: 'Yeux pétillants', category: 'eyes', slot: 'eyes', rarity: 'common', desc: 'Iris plus grand et reflets brillants', tags: ['v2'],
    render: { morph: {}, face: { sparkle: true } } },
  { id: FACE_V2_IDS.smile, name: 'Sourire', category: 'mouth', slot: 'mouth', rarity: 'common', desc: 'Un sourire naturel et joyeux', tags: ['v2'],
    render: { morph: {}, lips: { w: 1, h: 1, bow: 0.5 }, face: { smile: true } } },
];
