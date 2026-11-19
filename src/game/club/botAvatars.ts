import { DEFAULT_LOOK } from '../../fashion/look';
import type { Look } from '../../fashion/types';

/**
 * Club bots wear ordinary YooWorld looks built from the existing fashion catalogue (no new asset): the two existing bodies,
 * varied skin tones, hair styles / colours and clothes. These looks are display-only presets: nothing is owned, bought,
 * granted or saved, and they never touch the player's wardrobe or the economy.
 * Hair styles with extra hair-tie meshes (buns, pony, pigtails, manbun) and accessories are left out on purpose: one hair
 * mesh per bot keeps the club inside its draw-call budget.
 */
const L = (body: 'f' | 'm', slots: Look['slots']): Look => ({ v: 1, body, slots: { ...DEFAULT_LOOK[body].slots, jacket: undefined, 'acc.bag': undefined, 'details.blush': undefined, ...slots } });
export const BOT_LOOKS: Look[] = [
  L('f', { skin: 'skin_cocoa', hair: 'hair_afro', hairColor: 'haircol_black', eyeColor: 'eyecol_brown', top: 'tee_white', pants: 'pants_jeans', shoes: 'shoes_white' }),
  L('m', { skin: 'skin_honey', hair: 'hair_buzz', hairColor: 'haircol_black', eyeColor: 'eyecol_hazel', top: 'tee_stripes', pants: 'pants_cargo', shoes: 'shoes_red', beard: 'beard_stubble' }),
  L('f', { skin: 'skin_porcelain', hair: 'hair_bob', hairColor: 'haircol_red', eyeColor: 'eyecol_green', top: 'tee_heart', pants: 'pants_white', shoes: 'shoes_lime' }),
  L('m', { skin: 'skin_caramel', hair: 'hair_quiff', hairColor: 'haircol_chestnut', eyeColor: 'eyecol_brown', top: 'tee_yoo', pants: 'pants_black', shoes: 'shoes_white' }),
  L('f', { skin: 'skin_olive', hair: 'hair_long', hairColor: 'haircol_blond', eyeColor: 'eyecol_blue', top: 'tee_star', pants: 'pants_pink_shorts', shoes: 'shoes_neon' }),
  L('m', { skin: 'skin_ebony', hair: 'hair_mohawk', hairColor: 'haircol_brown', eyeColor: 'eyecol_grey', top: 'tee_white', pants: 'pants_jeans', shoes: 'shoes_lime' }),
];
for (const l of BOT_LOOKS) for (const k of Object.keys(l.slots) as (keyof Look['slots'])[]) if (l.slots[k] === undefined) delete l.slots[k];
/** Name-tag colour of the bots (neutral, distinct from the two player colours). */
export const BOT_TAG = '#6b5b95';
/** `count` different looks for one table, varied from game to game by `seed` (deterministic). */
export function botLooks(count: number, seed: number): Look[] {
  const n = BOT_LOOKS.length; const start = ((seed % n) + n) % n; const step = seed % 2 ? 1 : 5; // 1 or 5 (both coprime with 6)
  return Array.from({ length: count }, (_, k) => BOT_LOOKS[(start + k * step) % n]);
}
