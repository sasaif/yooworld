import type { AccModel, DressId, ItemDef, Rarity } from './types';
/** Glam collection, approved by Alessandro on 2026-11-21 ("Je valide tous, met tous ça en diamond", prices 20–50 💎).
 *  DATA ONLY: new ids in existing slots (top / hair / hairColor / makeup.eyes / acc.glasses), so the saved
 *  Look {v:1, body, slots} format is unchanged and every existing look renders exactly as before.
 *  Sources: art/proposals/fashion (FASHION_PROPOSAL.md sections 3, 4, 11–15; proto/src/designs.js, goth2.js). */
const D = (amount: number) => ({ currency: 'diamond' as const, amount });
const TAG = ['glam'];
type W = { id: string; way: string; color: string; color2?: string; shoe: string; lacing?: string; gloves?: string; legs?: string };
const dress = (d: DressId, name: string, price: number, rarity: Rarity, pattern: ItemDef['render']['pattern'], desc: string, ways: W[]): ItemDef[] =>
  ways.map((w) => ({ id: `dress_${d}_${w.id}`, name: `${name} · ${w.way}`, category: 'dress', slot: 'top', body: 'f', rarity, price: D(price), desc, tags: TAG,
    render: { dress: d, pattern, color: w.color, color2: w.color2, shoe: w.shoe, lacing: w.lacing, gloves: w.gloves, legs: w.legs, sleeve: 'tank' } }));
/** 6 evening dresses (round 1, section 3) × 3 colourways */
export const GLAM_DRESSES: ItemDef[] = [
  ...dress('d1', 'Biba Sirène', 45, 'legendary', 'none', 'Bustier cœur, jupe sirène, traîne', [
    { id: 'cerise', way: 'Cerise', color: '#c4122f', color2: '#ff6a7a', shoe: '#c4122f' }, { id: 'noir', way: 'Noir velours', color: '#1f1a24', color2: '#e8c27a', shoe: '#1f1a24' },
    { id: 'champagne', way: 'Champagne', color: '#e3bf8a', color2: '#fff1cf', shoe: '#c99a5b' }]),
  ...dress('d2', 'Minuit Pailleté', 40, 'epic', 'sequin', 'Col bijou, dos ouvert, midi ajustée', [
    { id: 'nuit', way: 'Bleu nuit', color: '#2b3f94', color2: '#e4e9ff', shoe: '#c9d1f5' }, { id: 'orrose', way: 'Or rose', color: '#d69684', color2: '#ffe3d6', shoe: '#e2b19e' },
    { id: 'emeraude', way: 'Émeraude', color: '#0f6b57', color2: '#bff3df', shoe: '#0f6b57' }]),
  ...dress('d3', 'Velours Épaule', 35, 'epic', 'velvet', 'Asymétrique, broche dorée, crayon', [
    { id: 'rubis', way: 'Rubis', color: '#8c1232', color2: '#f0c36a', shoe: '#8c1232' }, { id: 'prune', way: 'Prune', color: '#4d1f55', color2: '#e7b9ff', shoe: '#2b1430' },
    { id: 'saphir', way: 'Saphir', color: '#183c80', color2: '#dfe8ff', shoe: '#183c80' }]),
  ...dress('d4', 'Satin Bretelles', 30, 'rare', 'none', 'Fines bretelles, col bénitier, ourlet asymétrique', [
    { id: 'champagne', way: 'Champagne', color: '#e8c69a', color2: '#fff3dd', shoe: '#d3a873' }, { id: 'lilas', way: 'Lilas', color: '#b59de6', color2: '#efe6ff', shoe: '#9b80d6' },
    { id: 'menthe', way: 'Menthe', color: '#93d8bf', color2: '#effff8', shoe: '#5fb79a' }]),
  ...dress('d5', 'Petit Nœud', 25, 'rare', 'none', 'Mini bustier, grand nœud au dos', [
    { id: 'noirrose', way: 'Noir & rose', color: '#1d1b24', color2: '#ff7fb6', shoe: '#ff7fb6' }, { id: 'blancnoir', way: 'Blanc & noir', color: '#f3eee8', color2: '#1d1b24', shoe: '#1d1b24' },
    { id: 'fuchsia', way: 'Fuchsia & or', color: '#d61f7a', color2: '#e8bd5b', shoe: '#e8bd5b' }]),
  ...dress('d6', 'Corset Candy', 40, 'epic', 'ombre', 'Bustier, taille très marquée, jupe évasée dégradée', [
    { id: 'rose', way: 'Rose candy', color: '#ff8cc6', color2: '#c9a6ff', shoe: '#ff8cc6' }, { id: 'ciel', way: 'Ciel', color: '#8fd0ff', color2: '#ffffff', shoe: '#8fd0ff' },
    { id: 'peche', way: 'Pêche', color: '#ffb48a', color2: '#ff6f86', shoe: '#ff6f86' }]),
  // ---- Gothic latex v2 (section 13) × 3 colourways (v2 look + the two v1 palettes) ----
  ...dress('gv1', 'Corset Corbeau', 45, 'legendary', 'latex', 'Latex, bustier cœur lacé, choker', [
    { id: 'cerise', way: 'Noir & cerise', color: '#0f0d14', color2: '#b0122c', lacing: '#b0122c', shoe: '#0f0d14' },
    { id: 'bordeaux', way: 'Bordeaux', color: '#4c0a1a', color2: '#0f0d14', lacing: '#0f0d14', shoe: '#0f0d14' },
    { id: 'violet', way: 'Violet nuit', color: '#2e1548', color2: '#c9ccd6', lacing: '#c9ccd6', shoe: '#0f0d14' }]),
  ...dress('gv2', 'Minuit Violet', 40, 'epic', 'latex', 'Latex, harnais, ceinture, ourlet en pointes, collants', [
    { id: 'violet', way: 'Violet & noir', color: '#4a1f86', color2: '#100d14', gloves: '#100d14', legs: '#1a1420', shoe: '#100d14' },
    { id: 'bordeaux', way: 'Bordeaux & noir', color: '#4c0a1a', color2: '#100d14', gloves: '#100d14', legs: '#1a1420', shoe: '#100d14' },
    { id: 'argent', way: 'Noir & argent', color: '#141118', color2: '#c9ccd6', gloves: '#141118', legs: '#1a1420', shoe: '#141118' }]),
  ...dress('gv3', 'Reine Vampire', 50, 'legendary', 'latex', 'Latex sirène, traîne, chaînes dorées, gants longs', [
    { id: 'noir', way: 'Noir & or', color: '#0d0b10', color2: '#c99a3a', gloves: '#0d0b10', shoe: '#0d0b10' },
    { id: 'sang', way: 'Sang', color: '#6e0a1c', color2: '#c99a3a', gloves: '#6e0a1c', shoe: '#0d0b10' },
    { id: 'amethyste', way: 'Améthyste', color: '#3d1a5e', color2: '#c9ccd6', gloves: '#3d1a5e', shoe: '#0d0b10' }]),
];
/** Gothic v2 hair (mobile LOD) + matching colour swatches; the streak / band colour is part of the hairstyle. */
export const GLAM_HAIR: ItemDef[] = [
  { id: 'hair_goth_long', name: 'Corbeau long', category: 'hair', slot: 'hair', body: 'f', rarity: 'epic', price: D(35), tags: TAG, desc: 'Longs et lisses, frange droite', render: { hair: 'goth_long' } },
  { id: 'hair_goth_bob', name: 'Carré Bettie', category: 'hair', slot: 'hair', body: 'f', rarity: 'epic', price: D(30), tags: TAG, desc: 'Carré à frange, mèche cerise', render: { hair: 'goth_bob', color2: '#d01838' } },
  { id: 'hair_goth_pony', name: 'Queue haute bouclée', category: 'hair', slot: 'hair', body: 'f', rarity: 'legendary', price: D(40), tags: TAG, desc: 'Queue haute bouclée, mèche blanche', render: { hair: 'goth_pony', color2: '#efe6e0', trim: '#100d14' } },
  { id: 'haircol_raven', name: 'Noir corbeau', category: 'hair', slot: 'hairColor', rarity: 'rare', price: D(20), swatch: true, tags: TAG, render: { color: '#16131d' } },
  { id: 'haircol_violet_noir', name: 'Violet noir', category: 'hair', slot: 'hairColor', rarity: 'rare', price: D(20), swatch: true, tags: TAG, render: { color: '#2a1540' } },
  { id: 'haircol_bordeaux', name: 'Bordeaux', category: 'hair', slot: 'hairColor', rarity: 'rare', price: D(20), swatch: true, tags: TAG, render: { color: '#6a0c22' } },
];
/** Gothic v2 eye looks (iris + smoky shadow + winged liner + lips + dark brows). */
export const GLAM_EYES: ItemDef[] = [
  { id: 'eyelook_smoky_prune', name: 'Smoky Prune', category: 'eyes', slot: 'makeup.eyes', rarity: 'rare', price: D(20), tags: TAG, desc: 'Smoky prune, liner étiré',
    render: { makeup: 'shadow', color: '#5a2a6a', eyeLook: { iris: '#3a3048', shadow: '#5a2a6a', liner: '#0c0810', wing: true, lips: '#6a2a44', brow: '#141018' } } },
  { id: 'eyelook_amethyste', name: 'Liner Améthyste', category: 'eyes', slot: 'makeup.eyes', rarity: 'epic', price: D(25), tags: TAG, desc: 'Iris améthyste, eye-liner ailé',
    render: { makeup: 'shadow', color: '#4a2a7a', eyeLook: { iris: '#7a4ad0', shadow: '#4a2a7a', liner: '#0c0810', wing: true, lips: '#5a1838', brow: '#141018' } } },
  { id: 'eyelook_rubis', name: 'Rubis Vampire', category: 'eyes', slot: 'makeup.eyes', rarity: 'epic', price: D(25), tags: TAG, desc: 'Iris rubis, liner noir, lèvres sang',
    render: { makeup: 'shadow', color: '#5a1a2a', eyeLook: { iris: '#c0142e', shadow: '#5a1a2a', liner: '#0c0810', wing: true, lips: '#8a0a1e', brow: '#3a0a18' } } },
];
type G = { id: string; way: string; frame: string; lens: string; lens2: string; opacity: number; accent?: string };
const glasses = (model: AccModel, key: string, name: string, price: number, rarity: Rarity, ways: G[]): ItemDef[] => ways.map((w) => ({
  id: `acc_${key}_${w.id}`, name: `${name} · ${w.way}`, category: 'accessory', slot: 'acc.glasses', rarity, price: D(price), tags: TAG,
  render: { acc: model, color: w.frame, color2: w.lens, lens2: w.lens2, opacity: w.opacity, trim: w.accent } }));
export const GLAM_GLASSES: ItemDef[] = [
  // P1 Biba Terrazzo (final: P1-B, large blue chips, plum marbling ~25 %, slight glow on the blue flecks only)
  { id: 'acc_yoville_p1', name: 'Biba Terrazzo', category: 'accessory', slot: 'acc.glasses', rarity: 'legendary', price: D(50), tags: TAG, desc: 'Monture rose épaisse à éclats bleus',
    render: { acc: 'glasses_yoville_p1', color: '#e27fb0', color2: '#57b6ea', lens2: '#c4ecff', opacity: 0.93, trim: '#1a6cff' } },
  // the same P1-B Terrazzo bleu colours / material in 3 more shapes (Alessandro 2026-11-21: "3 choix selon la forme"), original names only
  ...([['glasses_terrazzo_wayfarer', 'acc_terrazzo_wayfarer', 'Terrazzo Wayfarer', 45, 'Monture trapèze épaisse, éclats bleus'],
    ['glasses_terrazzo_pilote', 'acc_terrazzo_pilote', 'Terrazzo Pilote', 45, 'Goutte pilote en acétate, double pont, barre mouchetée'],
    ['glasses_terrazzo_demilune', 'acc_terrazzo_demilune', 'Terrazzo Demi-lune', 40, 'Demi-cercle : cerclage en haut, bas du verre nu']] as const).map(([acc, id, name, price, desc]): ItemDef => ({
    id, name, category: 'accessory', slot: 'acc.glasses', rarity: 'legendary', price: D(price), tags: TAG, desc,
    render: { acc, color: '#e27fb0', color2: '#57b6ea', lens2: '#c4ecff', opacity: 0.93, trim: '#1a6cff' } })),
  // YoVille-reference frame, 6 colour mixes (section 11), temples resting on the ears (section 12)
  ...glasses('glasses_yoville', 'yoville', 'Rétro Bonbon', 35, 'epic', [
    { id: 'mauve', way: 'Mauve / ciel', frame: '#ce98b3', lens: '#6fc0f0', lens2: '#c8efff', opacity: 0.95 },
    { id: 'blanc', way: 'Blanc / noir', frame: '#e3e7ea', lens: '#241b18', lens2: '#5a4a44', opacity: 0.94 },
    { id: 'noir', way: 'Noir / rose', frame: '#1e1a22', lens: '#ff7fb8', lens2: '#ffd6e8', opacity: 0.88 },
    { id: 'lilas', way: 'Lilas / menthe', frame: '#b48ee6', lens: '#4fc9a6', lens2: '#d6fff1', opacity: 0.88 },
    { id: 'cerise', way: 'Cerise / ambre', frame: '#c4122f', lens: '#d9832a', lens2: '#ffd89a', opacity: 0.9 },
    { id: 'ciel', way: 'Ciel / violet', frame: '#7cc6ef', lens: '#7a3fc2', lens2: '#dcbcff', opacity: 0.9 }]),
  // round 1 retro glasses G01–G06 × 4 colourways (section 4), fixed temples
  ...glasses('glasses_biba', 'biba', 'Biba Ronde', 25, 'rare', [
    { id: 'rose', way: 'Rose / bleu', frame: '#f27fb8', lens: '#4fb3ef', lens2: '#c9ecff', opacity: 0.72 }, { id: 'lilas', way: 'Lilas / menthe', frame: '#b892e8', lens: '#5fcfae', lens2: '#d8fff2', opacity: 0.7 },
    { id: 'blanc', way: 'Blanc / rose', frame: '#f8f4f0', lens: '#ff8fc0', lens2: '#ffe0ee', opacity: 0.7 }, { id: 'ecaille', way: 'Écaille / ambre', frame: '#8a4f2c', lens: '#c9822d', lens2: '#ffd79a', opacity: 0.75 }]),
  ...glasses('glasses_cateye', 'cateye', 'Riviera Cat-Eye', 30, 'epic', [
    { id: 'noir', way: 'Noir / fumé', frame: '#1e1a22', lens: '#3c3a48', lens2: '#a7a4b8', accent: '#f4e7c8', opacity: 0.8 }, { id: 'cerise', way: 'Cerise / rose', frame: '#c4122f', lens: '#ff6f9c', lens2: '#ffd0de', accent: '#ffe08a', opacity: 0.72 },
    { id: 'perle', way: 'Perle / lilas', frame: '#f3ece6', lens: '#a98ee8', lens2: '#efe6ff', accent: '#ffd0e6', opacity: 0.68 }, { id: 'caramel', way: 'Caramel / bronze', frame: '#b5783f', lens: '#6d4a32', lens2: '#d9b48c', accent: '#ffe2a8', opacity: 0.78 }]),
  ...glasses('glasses_70s', 'studio70', 'Studio 70 Oversize', 25, 'rare', [
    { id: 'miel', way: 'Miel / ambre', frame: '#d9913d', lens: '#8b4a2b', lens2: '#ffc98a', opacity: 0.78 }, { id: 'blanc', way: 'Blanc / orange', frame: '#fbf6ef', lens: '#ff7a3d', lens2: '#ffd2a6', opacity: 0.74 },
    { id: 'fuchsia', way: 'Fuchsia / violet', frame: '#e0368a', lens: '#7a3fc2', lens2: '#e2b8ff', opacity: 0.75 }, { id: 'eau', way: 'Vert d’eau / bleu', frame: '#7fcab5', lens: '#2f6fb0', lens2: '#b6dcff', opacity: 0.74 }]),
  ...glasses('glasses_aviator', 'aviator', 'Pilote Riviera', 25, 'rare', [
    { id: 'or', way: 'Or / vert', frame: '#d8b56a', lens: '#2b6e4f', lens2: '#9fd6b8', opacity: 0.78 }, { id: 'argent', way: 'Argent / bleu miroir', frame: '#d6dae4', lens: '#2c64c8', lens2: '#a8d6ff', opacity: 0.8 },
    { id: 'orrose', way: 'Or rose / rose', frame: '#e3a493', lens: '#ff6fa8', lens2: '#ffd6e6', opacity: 0.72 }, { id: 'noir', way: 'Noir / gris', frame: '#2a2630', lens: '#3a3a40', lens2: '#9a9aa4', opacity: 0.82 }]),
  ...glasses('glasses_hexa', 'hexa', 'Hexa Disco', 20, 'rare', [
    { id: 'or', way: 'Or / jaune', frame: '#d8b56a', lens: '#ffcf3f', lens2: '#fff1b0', opacity: 0.62 }, { id: 'argent', way: 'Argent / lavande', frame: '#d6dae4', lens: '#9c86e8', lens2: '#e6deff', opacity: 0.62 },
    { id: 'cuivre', way: 'Cuivre / pêche', frame: '#c07a4f', lens: '#ff9a6f', lens2: '#ffe0cc', opacity: 0.62 }, { id: 'rose', way: 'Rose / bleu', frame: '#f27fb8', lens: '#4fb3ef', lens2: '#c9ecff', opacity: 0.66 }]),
  ...glasses('glasses_heart2', 'coeur', 'Cœur Candy', 30, 'epic', [
    { id: 'rose', way: 'Rose / rose', frame: '#ff4f9a', lens: '#ff8fc0', lens2: '#ffe0ee', opacity: 0.7 }, { id: 'rouge', way: 'Rouge / noir', frame: '#c4122f', lens: '#2a2028', lens2: '#7a5a66', opacity: 0.82 },
    { id: 'lilas', way: 'Lilas / bleu', frame: '#b892e8', lens: '#4fb3ef', lens2: '#c9ecff', opacity: 0.7 }, { id: 'blanc', way: 'Blanc / pêche', frame: '#f8f4f0', lens: '#ff9a6f', lens2: '#ffe0cc', opacity: 0.68 }]),
];
export const GLAM_ITEMS: ItemDef[] = [...GLAM_DRESSES, ...GLAM_HAIR, ...GLAM_EYES, ...GLAM_GLASSES];
