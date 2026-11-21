import type { Currency } from '../economy/money';
/** Data-driven fashion items. Adding an item = adding one entry to catalogue.ts (no component change),
 *  as long as it uses an existing `render` recipe (morph values, colours, patterns, hair/beard styles, accessory models). */
export type Body = 'f' | 'm';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ShopCategory = 'face' | 'eyes' | 'brows' | 'nose' | 'mouth' | 'hair' | 'beard' | 'tshirt' | 'jacket' | 'pants' | 'shoes' | 'accessory' | 'dress';
/** Equip slots (one item per slot). Accessories have sub-slots so several can be worn together. */
export type Slot =
  | 'faceShape' | 'skin' | 'details.freckles' | 'details.mole' | 'details.blush' | 'details.sticker' | 'makeup.lips' | 'makeup.eyes' | 'makeup.liner'
  | 'eyes' | 'eyeColor' | 'brows' | 'nose' | 'mouth' | 'hair' | 'hairColor' | 'beard'
  | 'top' | 'jacket' | 'pants' | 'shoes'
  | 'acc.glasses' | 'acc.earrings' | 'acc.necklace' | 'acc.hat' | 'acc.bag' | 'acc.wrist' | 'acc.neck2' | 'acc.head2';
export type Pattern = 'none' | 'stripes' | 'dots' | 'check' | 'tiedye' | 'galaxy' | 'denim' | 'camo' | 'sequin' | 'leather' | 'latex' | 'velvet' | 'ombre';
export type Print = 'none' | 'cheese' | 'star' | 'heart' | 'yoo' | 'bolt';
export type HairStyle = 'buns' | 'quiff' | 'bob' | 'pony' | 'long' | 'buzz' | 'afro' | 'pigtails' | 'manbun' | 'mohawk' | 'braids' | 'bun_high'
  /** glam collection (2026-11-21): gothic strand-clump hair, mobile LOD */ | 'goth_long' | 'goth_bob' | 'goth_pony';
export type BeardStyle = 'none' | 'stubble' | 'goatee' | 'short' | 'full' | 'mustache';
export type AccModel = 'glasses_round' | 'sunglasses' | 'glasses_heart' | 'earrings_pearl' | 'earrings_hoops' | 'earrings_diamond' | 'necklace_chain' | 'necklace_heart'
  | 'cap' | 'beanie' | 'strawhat' | 'crown' | 'backpack' | 'beltbag' | 'tote' | 'watch' | 'headphones' | 'scarf'
  /** glam collection glasses */ | 'glasses_biba' | 'glasses_cateye' | 'glasses_70s' | 'glasses_aviator' | 'glasses_hexa' | 'glasses_heart2' | 'glasses_yoville' | 'glasses_yoville_p1'
  | 'glasses_terrazzo_wayfarer' | 'glasses_terrazzo_pilote' | 'glasses_terrazzo_demilune';
export type FaceMorph = 'faceOval' | 'faceHeart' | 'faceSquare' | 'faceSoft' | 'eyeBig' | 'eyeAlmond' | 'eyeCat' | 'eyeSleepy'
  | 'noseButton' | 'noseUp' | 'noseStrong' | 'noseFine' | 'mouthFull' | 'mouthWide' | 'mouthSmall' | 'mouthHeart'
  | 'browThick' | 'browThin' | 'browArch' | 'browStraight';
export interface Render {
  morph?: Partial<Record<FaceMorph, number>>;
  color?: string; color2?: string;
  /** clothing */ pattern?: Pattern; print?: Print; sleeve?: 'long' | 'short' | 'tank'; length?: 'long' | 'short'; trim?: string;
  extra?: 'hood' | 'fur' | 'none'; sheen?: number; glow?: number; shaft?: 'boot' | 'high';
  /** face decals / makeup */ decal?: 'freckles' | 'mole' | 'blush' | 'glow' | 'star'; makeup?: 'lips' | 'shadow' | 'liner'; gloss?: boolean;
  /** lips drawn on the face texture (shape of the mouth option) */ lips?: { w: number; h: number; bow: number };
  hair?: HairStyle; beard?: BeardStyle; acc?: AccModel;
  /** face v2 (src/avatar/face): smiling mouth / sparkle eyes painted on the atlas */ face?: { smile?: boolean; sparkle?: boolean };
  /** glam collection (data only, no save change). Dresses live in the `top` slot: while one is worn the renderer
   *  ignores the jacket and paints the trousers area as legs (the saved jacket/pants slots are kept). */
  dress?: DressId; /** lacing / trim accent colour of a dress */ lacing?: string; gloves?: string; legs?: string; shoe?: string;
  /** glasses: second lens colour (vertical gradient) and lens opacity */ lens2?: string; opacity?: number;
  /** eye look (makeup.eyes slot): iris + smoky shadow + liner/wing + lips + brows, painted on the face atlas */
  eyeLook?: { iris: string; shadow: string; liner: string; wing?: boolean; lips?: string; brow?: string };
}
export type DressId = 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6' | 'gv1' | 'gv2' | 'gv3';
export interface ItemDef {
  id: string; name: string; category: ShopCategory; slot: Slot;
  /** price: absent/0 = free base option (owned by everyone) */
  price?: { currency: Currency; amount: number };
  rarity: Rarity; body?: Body; /** short line shown in the shop */ desc?: string;
  render: Render; /** swatch items (colours) are shown as round swatches */ swatch?: boolean;
  tags?: string[];
  /** TRIAL item (« À l'essai »): visible and equippable by everyone for testing, NOT for sale (no price) until a price is set. */
  trial?: boolean;
}
/** The saved appearance of one avatar body: slot -> item id. Missing optional slot = nothing equipped. */
export interface Look { v: 1; body: Body; slots: Partial<Record<Slot, string>> }
