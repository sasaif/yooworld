import type { Body, ItemDef, Rarity, ShopCategory, Slot } from './types';
import { FACE_V2_ITEMS } from '../avatar/face/items';
/** Initial YooWorld fashion catalogue (data only). Prices: Gold 80–650, Diamonds 10–60.
 *  Rule of thumb: every category has free basics + several Gold items; Diamonds are reserved for a few
 *  premium/legendary pieces — a player can build an attractive look with Gold only. */
const G = (amount: number) => ({ currency: 'gold' as const, amount });
const D = (amount: number) => ({ currency: 'diamond' as const, amount });
type I = ItemDef;
const it = (id: string, name: string, category: ShopCategory, slot: Slot, render: I['render'], price?: I['price'], rarity: Rarity = 'common', extra: Partial<I> = {}): I =>
  ({ id, name, category, slot, render, price, rarity, ...extra });

export const SKIN_TONES: I[] = [
  ['skin_porcelain', 'Porcelaine', '#f6d6c6'], ['skin_peach', 'Pêche', '#efc3a5'], ['skin_honey', 'Miel', '#d9a37c'], ['skin_caramel', 'Caramel', '#b97c55'],
  ['skin_cocoa', 'Cacao', '#8d5a3b'], ['skin_ebony', 'Ébène', '#5e3a27'], ['skin_rose', 'Rosé', '#f0b9a8'], ['skin_olive', 'Olive', '#c99a6b'],
].map(([id, name, color]) => it(id, name, 'face', 'skin', { color }, undefined, 'common', { swatch: true }));

export const CATALOGUE: I[] = [
  ...SKIN_TONES,
  // ---------- Visage : formes, détails, maquillage ----------
  it('face_round', 'Visage rond', 'face', 'faceShape', { morph: {} }),
  it('face_oval', 'Visage ovale', 'face', 'faceShape', { morph: { faceOval: 1 } }),
  it('face_soft', 'Joues potelées', 'face', 'faceShape', { morph: { faceSoft: 1 } }),
  it('face_heart', 'Visage cœur', 'face', 'faceShape', { morph: { faceHeart: 1 } }, G(150)),
  it('face_square', 'Mâchoire carrée', 'face', 'faceShape', { morph: { faceSquare: 1 } }, G(150)),
  it('det_blush', 'Joues rosées', 'face', 'details.blush', { decal: 'blush', color: '#ff7f8f' }),
  it('det_freckles', 'Taches de rousseur', 'face', 'details.freckles', { decal: 'freckles', color: '#a0573a' }, G(120)),
  it('det_mole', 'Grain de beauté', 'face', 'details.mole', { decal: 'mole', color: '#4a2a22' }, G(80)),
  it('det_glow', 'Pommettes dorées', 'face', 'details.blush', { decal: 'glow', color: '#ffd27a' }, D(15), 'epic'),
  it('det_star', 'Étoile pailletée', 'face', 'details.sticker', { decal: 'star', color: '#ffcf3f' }, D(20), 'legendary'),
  it('mk_lip_rose', 'Rouge à lèvres rose', 'face', 'makeup.lips', { makeup: 'lips', color: '#e8578f' }, G(90)),
  it('mk_lip_red', 'Rouge baiser', 'face', 'makeup.lips', { makeup: 'lips', color: '#c8102e' }, G(140), 'rare'),
  it('mk_gloss_holo', 'Gloss holographique', 'face', 'makeup.lips', { makeup: 'lips', color: '#d58cff', gloss: true }, D(18), 'epic'),
  it('mk_shadow_violet', 'Fard à paupières violet', 'face', 'makeup.eyes', { makeup: 'shadow', color: '#9b59d0' }, G(160)),
  it('mk_shadow_peach', 'Fard pêche', 'face', 'makeup.eyes', { makeup: 'shadow', color: '#ff9f6b' }, G(110)),
  it('mk_liner', 'Eye-liner', 'face', 'makeup.liner', { makeup: 'liner', color: '#1d1220' }, G(110)),
  // ---------- Yeux ----------
  it('eyes_round', 'Yeux ronds', 'eyes', 'eyes', { morph: {} }),
  it('eyes_almond', 'Yeux en amande', 'eyes', 'eyes', { morph: { eyeAlmond: 1 } }, G(180)),
  it('eyes_sleepy', 'Yeux rêveurs', 'eyes', 'eyes', { morph: { eyeSleepy: 1 } }, G(160)),
  it('eyes_big', 'Grands yeux', 'eyes', 'eyes', { morph: { eyeBig: 1 } }, G(220), 'rare'),
  it('eyes_cat', 'Yeux de chat', 'eyes', 'eyes', { morph: { eyeCat: 1 } }, D(25), 'epic', { desc: 'Style d’yeux premium' }),
  ...FACE_V2_ITEMS.filter((i) => i.slot === 'eyes'),
  ...([['eyecol_brown', 'Marron', '#6b3d1f'], ['eyecol_hazel', 'Noisette', '#8a6a2b'], ['eyecol_blue', 'Bleu', '#2f7fd6'], ['eyecol_green', 'Vert', '#2f9a55'],
    ['eyecol_grey', 'Gris', '#7f8a96'], ['eyecol_plum', 'Prune', '#8a1f5a']] as const).map(([id, name, color]) => it(id, name, 'eyes', 'eyeColor', { color }, undefined, 'common', { swatch: true })),
  it('eyecol_violet', 'Améthyste', 'eyes', 'eyeColor', { color: '#8b4dff' }, G(200), 'rare', { swatch: true }),
  it('eyecol_gold', 'Or liquide', 'eyes', 'eyeColor', { color: '#e0a500' }, D(10), 'epic', { swatch: true }),
  // ---------- Sourcils ----------
  it('brow_natural', 'Naturels', 'brows', 'brows', { morph: {} }),
  it('brow_thick', 'Épais', 'brows', 'brows', { morph: { browThick: 1 } }),
  it('brow_thin', 'Fins', 'brows', 'brows', { morph: { browThin: 1 } }, G(90)),
  it('brow_arched', 'Arqués', 'brows', 'brows', { morph: { browArch: 1 } }, G(120)),
  it('brow_straight', 'Droits', 'brows', 'brows', { morph: { browStraight: 1 } }, G(100)),
  // ---------- Nez ----------
  it('nose_base', 'Petit nez', 'nose', 'nose', { morph: {} }),
  it('nose_button', 'Nez bouton', 'nose', 'nose', { morph: { noseButton: 1 } }, G(100)),
  it('nose_up', 'Nez retroussé', 'nose', 'nose', { morph: { noseUp: 1 } }, G(140)),
  it('nose_strong', 'Nez marqué', 'nose', 'nose', { morph: { noseStrong: 1 } }, G(120)),
  it('nose_fine', 'Nez fin', 'nose', 'nose', { morph: { noseFine: 1 } }, D(12), 'rare'),
  // ---------- Bouche ----------
  it('mouth_base', 'Bouche naturelle', 'mouth', 'mouth', { morph: {}, lips: { w: 1, h: 1, bow: 0.5 } }),
  it('mouth_small', 'Petite bouche', 'mouth', 'mouth', { morph: { mouthSmall: 1 }, lips: { w: 0.8, h: 0.9, bow: 0.5 } }, G(90)),
  it('mouth_wide', 'Grand sourire', 'mouth', 'mouth', { morph: { mouthWide: 1 }, lips: { w: 1.3, h: 0.9, bow: 0.3 } }, G(130)),
  it('mouth_full', 'Lèvres pulpeuses', 'mouth', 'mouth', { morph: { mouthFull: 1 }, lips: { w: 1.05, h: 1.45, bow: 0.7 } }, G(150)),
  it('mouth_heart', 'Bouche en cœur', 'mouth', 'mouth', { morph: { mouthHeart: 1 }, lips: { w: 0.9, h: 1.3, bow: 1 } }, D(15), 'epic'),
  ...FACE_V2_ITEMS.filter((i) => i.slot === 'mouth'),
  // ---------- Cheveux ----------
  it('hair_buns', 'Chignons', 'hair', 'hair', { hair: 'buns' }),
  it('hair_quiff', 'Mèche', 'hair', 'hair', { hair: 'quiff' }),
  it('hair_bob', 'Carré', 'hair', 'hair', { hair: 'bob' }, G(300)),
  it('hair_buzz', 'Coupe rase', 'hair', 'hair', { hair: 'buzz' }, G(200)),
  it('hair_pigtails', 'Couettes', 'hair', 'hair', { hair: 'pigtails' }, G(380)),
  it('hair_manbun', 'Chignon haut', 'hair', 'hair', { hair: 'manbun' }, G(420)),
  it('hair_pony', 'Queue de cheval', 'hair', 'hair', { hair: 'pony' }, G(450), 'rare'),
  it('hair_long', 'Longs lâchés', 'hair', 'hair', { hair: 'long' }, G(600), 'rare'),
  it('hair_afro', 'Afro', 'hair', 'hair', { hair: 'afro' }, D(35), 'epic', { desc: 'Coiffure spéciale' }),
  it('hair_mohawk', 'Crête', 'hair', 'hair', { hair: 'mohawk' }, D(30), 'epic'),
  it('hair_braids', 'Tresses', 'hair', 'hair', { hair: 'braids' }, G(480), 'rare'),
  it('hair_bun_high', 'Chignon poupée', 'hair', 'hair', { hair: 'bun_high' }, G(420)),
  ...([['haircol_brown', 'Brun', '#4a2c22'], ['haircol_chestnut', 'Châtain', '#7a4a2a'], ['haircol_black', 'Noir', '#1e1618'], ['haircol_blond', 'Blond', '#e3bd6a'],
    ['haircol_red', 'Roux', '#b5482a'], ['haircol_pink', 'Rose bonbon', '#ff4fb0']] as const).map(([id, name, color]) => it(id, name, 'hair', 'hairColor', { color }, undefined, 'common', { swatch: true })),
  it('haircol_blue', 'Bleu électrique', 'hair', 'hairColor', { color: '#2f6bff' }, G(250), 'rare', { swatch: true }),
  it('haircol_silver', 'Argent', 'hair', 'hairColor', { color: '#d9dde6' }, G(300), 'rare', { swatch: true }),
  it('haircol_sunset', 'Dégradé coucher de soleil', 'hair', 'hairColor', { color: '#ff5e7e', color2: '#ffc04d' }, D(20), 'legendary', { swatch: true }),
  // ---------- Barbe (homme) ----------
  it('beard_none', 'Rasé de près', 'beard', 'beard', { beard: 'none' }, undefined, 'common', { body: 'm' }),
  it('beard_stubble', 'Barbe de 3 jours', 'beard', 'beard', { beard: 'stubble' }, G(80), 'common', { body: 'm' }),
  it('beard_mustache', 'Moustache', 'beard', 'beard', { beard: 'mustache' }, G(120), 'common', { body: 'm' }),
  it('beard_goatee', 'Bouc', 'beard', 'beard', { beard: 'goatee' }, G(150), 'common', { body: 'm' }),
  it('beard_short', 'Barbe courte', 'beard', 'beard', { beard: 'short' }, G(220), 'rare', { body: 'm' }),
  it('beard_full', 'Barbe fournie', 'beard', 'beard', { beard: 'full' }, D(25), 'epic', { body: 'm' }),
  // ---------- T-shirts ----------
  it('tee_cheese', 'Tee Fromage', 'tshirt', 'top', { color: '#f2f1e8', print: 'cheese', sleeve: 'short' }),
  it('tee_white', 'T-shirt blanc', 'tshirt', 'top', { color: '#fbfbf7', print: 'none', sleeve: 'short' }),
  it('tee_stripes', 'Marinière', 'tshirt', 'top', { color: '#f7f7f2', color2: '#1f3f8a', pattern: 'stripes', sleeve: 'long' }, G(180)),
  it('tee_heart', 'Tee cœur', 'tshirt', 'top', { color: '#ffd1e3', print: 'heart', sleeve: 'short' }, G(200)),
  it('tee_star', 'Tee étoile', 'tshirt', 'top', { color: '#26233a', print: 'star', sleeve: 'short' }, G(220)),
  it('tee_tank', 'Débardeur corail', 'tshirt', 'top', { color: '#ff7a5c', print: 'none', sleeve: 'tank' }, G(150)),
  it('tee_yoo', 'Tee YoLand', 'tshirt', 'top', { color: '#ffcf3f', print: 'yoo', sleeve: 'short' }, G(260), 'rare'),
  it('tee_tiedye', 'Tie & dye', 'tshirt', 'top', { color: '#ff6fb5', color2: '#5fd3ff', pattern: 'tiedye', sleeve: 'short' }, D(20), 'epic'),
  it('tee_galaxy', 'Tee Galaxie', 'tshirt', 'top', { color: '#1b1446', color2: '#b17bff', pattern: 'galaxy', print: 'star', sleeve: 'long' }, D(30), 'legendary'),
  // ---------- Vestes ----------
  it('jacket_green', 'Blouson citron', 'jacket', 'jacket', { color: '#7ed321', trim: '#5aa516', extra: 'none' }),
  it('jacket_hoodie', 'Hoodie rose', 'jacket', 'jacket', { color: '#ff8fc2', trim: '#f06aa8', extra: 'hood' }, G(380)),
  it('jacket_denim', 'Veste en jean', 'jacket', 'jacket', { color: '#5b86c5', trim: '#3f6aa8', pattern: 'denim', extra: 'none' }, G(480), 'rare'),
  it('jacket_leather', 'Perfecto', 'jacket', 'jacket', { color: '#2a2530', trim: '#1a161e', pattern: 'leather', extra: 'none', sheen: 0.5 }, G(650), 'rare'),
  it('jacket_varsity', 'Teddy universitaire', 'jacket', 'jacket', { color: '#8a1730', color2: '#f3eee2', trim: '#f3eee2', extra: 'none' }, D(35), 'epic'),
  it('jacket_bomber_gold', 'Bomber doré', 'jacket', 'jacket', { color: '#d8a531', trim: '#9c6f16', extra: 'fur', sheen: 0.8 }, D(45), 'legendary', { desc: 'Veste premium' }),
  // ---------- Pantalons ----------
  it('pants_shorts_black', 'Short noir', 'pants', 'pants', { color: '#2d2a33', length: 'short' }),
  it('pants_black', 'Pantalon noir', 'pants', 'pants', { color: '#2d2a33', length: 'long' }),
  it('pants_jeans', 'Jean bleu', 'pants', 'pants', { color: '#3f67a8', pattern: 'denim', length: 'long' }, G(220)),
  it('pants_pink_shorts', 'Short rose', 'pants', 'pants', { color: '#ff8fbf', length: 'short' }, G(180)),
  it('pants_white', 'Pantalon blanc', 'pants', 'pants', { color: '#f3f1ea', length: 'long' }, G(240)),
  it('pants_cargo', 'Cargo kaki', 'pants', 'pants', { color: '#7b7f4a', color2: '#5d6236', pattern: 'camo', length: 'long' }, G(280)),
  it('pants_check', 'Pantalon à carreaux', 'pants', 'pants', { color: '#c44b3c', color2: '#2a2230', pattern: 'check', length: 'long' }, G(340), 'rare'),
  it('pants_sequin', 'Pantalon paillettes', 'pants', 'pants', { color: '#c9b6ff', color2: '#ffffff', pattern: 'sequin', length: 'long' }, D(30), 'epic'),
  // ---------- Chaussures ----------
  it('shoes_lime', 'Baskets citron', 'shoes', 'shoes', { color: '#cfe05a', color2: '#ffffff' }),
  it('shoes_white', 'Baskets blanches', 'shoes', 'shoes', { color: '#f4f4f0', color2: '#e8e8e2' }, G(150)),
  it('shoes_red', 'Baskets rouges', 'shoes', 'shoes', { color: '#e0383e', color2: '#ffffff' }, G(200)),
  it('shoes_high', 'Montantes noires', 'shoes', 'shoes', { color: '#26232c', color2: '#f2f2ee', shaft: 'high' }, G(300)),
  it('shoes_boots', 'Bottines camel', 'shoes', 'shoes', { color: '#a8652f', color2: '#3b2416', shaft: 'boot' }, G(420), 'rare'),
  it('shoes_neon', 'Sneakers néon', 'shoes', 'shoes', { color: '#39f2c4', color2: '#ff3fd2', glow: 1 }, D(25), 'epic', { desc: 'Sneakers spéciales' }),
  // ---------- Accessoires ----------
  it('acc_glasses_round', 'Lunettes rondes', 'accessory', 'acc.glasses', { acc: 'glasses_round', color: '#2a2230' }, G(120)),
  it('acc_sunglasses', 'Lunettes de soleil', 'accessory', 'acc.glasses', { acc: 'sunglasses', color: '#141018', color2: '#ff7ab8' }, G(200)),
  it('acc_glasses_heart', 'Lunettes cœur', 'accessory', 'acc.glasses', { acc: 'glasses_heart', color: '#ff3f8e', color2: '#ff9fc6' }, D(15), 'epic'),
  it('acc_earrings_pearl', 'Boucles perles', 'accessory', 'acc.earrings', { acc: 'earrings_pearl', color: '#fbf6ee' }, G(140)),
  it('acc_earrings_hoops', 'Créoles dorées', 'accessory', 'acc.earrings', { acc: 'earrings_hoops', color: '#f2c14e' }, G(180)),
  it('acc_earrings_diamond', 'Puces diamant', 'accessory', 'acc.earrings', { acc: 'earrings_diamond', color: '#bff3ff' }, D(20), 'legendary'),
  it('acc_necklace_chain', 'Chaîne dorée', 'accessory', 'acc.necklace', { acc: 'necklace_chain', color: '#f2c14e' }, G(220)),
  it('acc_necklace_heart', 'Collier cœur premium', 'accessory', 'acc.necklace', { acc: 'necklace_heart', color: '#f2c14e', color2: '#ff2f7a' }, D(25), 'epic', { desc: 'Collier premium' }),
  it('acc_scarf', 'Écharpe douce', 'accessory', 'acc.neck2', { acc: 'scarf', color: '#ffb547', color2: '#ff7a5c' }, G(180)),
  it('acc_cap', 'Casquette', 'accessory', 'acc.hat', { acc: 'cap', color: '#2f6bff', color2: '#ffffff' }, G(160)),
  it('acc_beanie', 'Bonnet', 'accessory', 'acc.hat', { acc: 'beanie', color: '#ff7a5c', color2: '#fff3e0' }, G(140)),
  it('acc_strawhat', 'Chapeau de paille', 'accessory', 'acc.hat', { acc: 'strawhat', color: '#e9c77b', color2: '#ff6f91' }, G(260), 'rare'),
  it('acc_crown', 'Couronne', 'accessory', 'acc.hat', { acc: 'crown', color: '#ffd23f', color2: '#ff2f7a' }, D(60), 'legendary'),
  it('acc_headphones', 'Casque audio', 'accessory', 'acc.head2', { acc: 'headphones', color: '#ffffff', color2: '#ff5fa2' }, G(350), 'rare'),
  it('acc_backpack', 'Sac à dos violet', 'accessory', 'acc.bag', { acc: 'backpack', color: '#7b6fd6' }),
  it('acc_beltbag', 'Sac banane', 'accessory', 'acc.bag', { acc: 'beltbag', color: '#ff5f8f', color2: '#2a2230' }, G(200)),
  it('acc_tote', 'Sac à main', 'accessory', 'acc.bag', { acc: 'tote', color: '#f4e1c1', color2: '#b8743a' }, G(320), 'rare'),
  it('acc_watch', 'Montre', 'accessory', 'acc.wrist', { acc: 'watch', color: '#2a2230', color2: '#7fe0ff' }, G(150)),
];
export const ITEMS: Record<string, ItemDef> = Object.fromEntries(CATALOGUE.map((i) => [i.id, i]));
export const itemById = (id: string | undefined) => (id ? ITEMS[id] : undefined);
export const isFree = (i: ItemDef) => !i.price || i.price.amount === 0;
/** `body` restricts an item to one body (beards are male-only); everything else fits both. */
export const fitsBody = (i: ItemDef, body: Body) => !i.body || i.body === body;

export const CATEGORIES: { id: ShopCategory; label: string; icon: string; cam: 'face' | 'head' | 'body' | 'legs' | 'feet' }[] = [
  { id: 'face', label: 'Visage', icon: '🙂', cam: 'face' }, { id: 'eyes', label: 'Yeux', icon: '👁️', cam: 'face' }, { id: 'brows', label: 'Sourcils', icon: '〰️', cam: 'face' },
  { id: 'nose', label: 'Nez', icon: '👃', cam: 'face' }, { id: 'mouth', label: 'Bouche', icon: '👄', cam: 'face' }, { id: 'hair', label: 'Cheveux', icon: '💇', cam: 'head' },
  { id: 'beard', label: 'Barbe', icon: '🧔', cam: 'face' }, { id: 'tshirt', label: 'T-shirts', icon: '👕', cam: 'body' }, { id: 'jacket', label: 'Vestes', icon: '🧥', cam: 'body' },
  { id: 'pants', label: 'Pantalons', icon: '👖', cam: 'legs' }, { id: 'shoes', label: 'Chaussures', icon: '👟', cam: 'feet' }, { id: 'accessory', label: 'Accessoires', icon: '🕶️', cam: 'body' },
];
export const RARITY: Record<Rarity, { label: string; color: string }> = {
  common: { label: 'Commun', color: '#8c84a3' }, rare: { label: 'Rare', color: '#3f8cff' }, epic: { label: 'Épique', color: '#b04fe0' }, legendary: { label: 'Légendaire', color: '#f0a000' },
};
/** Slots that may be left empty (unequip). Others always hold a base option. */
export const OPTIONAL_SLOTS: Slot[] = ['details.freckles', 'details.mole', 'details.blush', 'details.sticker', 'makeup.lips', 'makeup.eyes', 'makeup.liner', 'beard', 'jacket',
  'acc.glasses', 'acc.earrings', 'acc.necklace', 'acc.hat', 'acc.bag', 'acc.wrist', 'acc.neck2', 'acc.head2'];
export const SLOT_LABEL: Partial<Record<Slot, string>> = {
  faceShape: 'Forme du visage', skin: 'Teint', 'details.freckles': 'Taches de rousseur', 'details.mole': 'Grain de beauté', 'details.blush': 'Joues', 'details.sticker': 'Paillettes',
  'makeup.lips': 'Lèvres', 'makeup.eyes': 'Paupières', 'makeup.liner': 'Eye-liner', eyes: 'Forme des yeux', eyeColor: 'Couleur des yeux', hair: 'Coiffure', hairColor: 'Couleur',
  'acc.glasses': 'Lunettes', 'acc.earrings': 'Boucles d’oreilles', 'acc.necklace': 'Colliers', 'acc.hat': 'Chapeaux', 'acc.bag': 'Sacs', 'acc.wrist': 'Poignet', 'acc.neck2': 'Écharpes', 'acc.head2': 'Casques',
};
