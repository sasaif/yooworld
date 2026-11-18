import { ITEMS, OPTIONAL_SLOTS, fitsBody, isFree } from './catalogue';
import type { Body, ItemDef, Look, Slot } from './types';
/** Avatar appearance = slot -> item id (pure functions, unit-tested). */
export const REQUIRED_SLOTS: Slot[] = ['skin', 'faceShape', 'eyes', 'eyeColor', 'brows', 'nose', 'mouth', 'hair', 'hairColor', 'top', 'pants', 'shoes'];
export const DEFAULT_LOOK: Record<Body, Look> = {
  f: { v: 1, body: 'f', slots: { skin: 'skin_peach', faceShape: 'face_round', eyes: 'eyes_round', eyeColor: 'eyecol_plum', brows: 'brow_natural', nose: 'nose_base', mouth: 'mouth_base',
    hair: 'hair_buns', hairColor: 'haircol_pink', 'details.blush': 'det_blush', top: 'tee_cheese', jacket: 'jacket_green', pants: 'pants_shorts_black', shoes: 'shoes_lime', 'acc.bag': 'acc_backpack' } },
  m: { v: 1, body: 'm', slots: { skin: 'skin_peach', faceShape: 'face_round', eyes: 'eyes_round', eyeColor: 'eyecol_brown', brows: 'brow_thick', nose: 'nose_base', mouth: 'mouth_base',
    hair: 'hair_quiff', hairColor: 'haircol_brown', beard: 'beard_none', top: 'tee_cheese', jacket: 'jacket_green', pants: 'pants_black', shoes: 'shoes_lime' } },
};
export const cloneLook = (l: Look): Look => ({ v: 1, body: l.body, slots: { ...l.slots } });
/** Equip an item on a look (replaces the slot). Throws on unknown item / wrong body. */
export function equip(l: Look, itemId: string): Look {
  const it = ITEMS[itemId]; if (!it) throw new Error('unknown item ' + itemId);
  if (!fitsBody(it, l.body)) throw new Error('item not for this body');
  return { ...l, slots: { ...l.slots, [it.slot]: itemId } };
}
/** Remove an optional slot (required slots keep their base option). */
export function unequip(l: Look, slot: Slot): Look {
  if (!OPTIONAL_SLOTS.includes(slot)) return l;
  const slots = { ...l.slots }; delete slots[slot]; return { ...l, slots };
}
export const equipped = (l: Look, itemId: string) => { const it = ITEMS[itemId]; return !!it && l.slots[it.slot] === itemId; };
export const lookItems = (l: Look): ItemDef[] => Object.values(l.slots).map((id) => ITEMS[id!]).filter(Boolean);
/** Items of `l` that the player does not own yet (= the try-on cart). Free base options never count. */
export const unownedItems = (l: Look, owns: (id: string) => boolean) => lookItems(l).filter((i) => !isFree(i) && !owns(i.id));
/** Replace every not-owned item by what `fallback` had in that slot (used when leaving the studio without buying). */
export function revertUnowned(l: Look, fallback: Look, owns: (id: string) => boolean): Look {
  let out = cloneLook(l);
  for (const it of unownedItems(l, owns)) { const prev = fallback.slots[it.slot]; out = prev && (isFree(ITEMS[prev]) || owns(prev)) ? { ...out, slots: { ...out.slots, [it.slot]: prev } } : unequip(out, it.slot); }
  return sanitizeLook(out, owns);
}
/** Make any input a valid look: known items, right slots/body, required slots filled with defaults. */
export function sanitizeLook(raw: unknown, owns: (id: string) => boolean = () => true): Look {
  const r = (raw ?? {}) as Partial<Look>; const body: Body = r.body === 'm' ? 'm' : 'f'; const def = DEFAULT_LOOK[body];
  const slots: Look['slots'] = {};
  for (const [slot, id] of Object.entries(r.slots ?? {})) {
    const it = typeof id === 'string' ? ITEMS[id] : undefined;
    if (it && it.slot === slot && fitsBody(it, body) && (isFree(it) || owns(it.id))) slots[slot as Slot] = id as string;
  }
  for (const s of REQUIRED_SLOTS) if (!slots[s]) slots[s] = def.slots[s];
  return { v: 1, body, slots };
}
export const serializeLook = (l: Look) => JSON.stringify({ v: 1, body: l.body, slots: l.slots });
export const parseLook = (s: string | null | undefined, owns?: (id: string) => boolean): Look => { try { return sanitizeLook(s ? JSON.parse(s) : null, owns); } catch { return sanitizeLook(null, owns); } };
export const sameLook = (a: Look, b: Look) => serializeLook(sanitizeLook(a)) === serializeLook(sanitizeLook(b));
