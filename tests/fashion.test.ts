import { describe, expect, it } from 'vitest';
import { CATALOGUE, CATEGORIES, ITEMS, isFree } from '../src/fashion/catalogue';
import { validateCatalogue } from '../src/fashion/schema';
import { DEFAULT_LOOK, equip, parseLook, revertUnowned, sanitizeLook, serializeLook, unequip, unownedItems } from '../src/fashion/look';

const cnt = (slot: string, cat?: string) => CATALOGUE.filter((i) => i.slot === slot && (!cat || i.category === cat)).length;
describe('catalogue', () => {
  it('is valid (schema)', () => { expect(validateCatalogue(CATALOGUE)).toEqual([]); });
  it('meets the minimum counts', () => {
    expect(cnt('eyes')).toBeGreaterThanOrEqual(3); expect(cnt('nose')).toBeGreaterThanOrEqual(3); expect(cnt('mouth')).toBeGreaterThanOrEqual(3);
    expect(cnt('hair')).toBeGreaterThanOrEqual(3); expect(CATALOGUE.filter((i) => i.slot === 'beard' && i.render.beard !== 'none').length).toBeGreaterThanOrEqual(2);
    expect(cnt('top')).toBeGreaterThanOrEqual(5); expect(cnt('jacket')).toBeGreaterThanOrEqual(3); expect(cnt('pants')).toBeGreaterThanOrEqual(4);
    expect(cnt('shoes')).toBeGreaterThanOrEqual(4); expect(CATALOGUE.filter((i) => i.category === 'accessory').length).toBeGreaterThanOrEqual(6);
  });
  it('every shop category has items, and mixes gold and diamond prices overall', () => {
    for (const c of CATEGORIES) expect(CATALOGUE.some((i) => i.category === c.id)).toBe(true);
    const cur = (c: string) => CATALOGUE.filter((i) => i.price?.currency === c).length;
    expect(cur('gold')).toBeGreaterThan(cur('diamond')); expect(cur('diamond')).toBeGreaterThan(5);
    // gold stays useful: each clothing/hair/accessory category has at least 2 gold items
    for (const c of ['hair', 'tshirt', 'jacket', 'pants', 'shoes', 'accessory', 'eyes', 'nose', 'mouth']) expect(CATALOGUE.filter((i) => i.category === c && i.price?.currency === 'gold').length).toBeGreaterThanOrEqual(2);
  });
});
describe('looks', () => {
  it('equips, unequips optional slots only, and rejects beards on the female body', () => {
    let l = equip(DEFAULT_LOOK.f, 'hair_long'); expect(l.slots.hair).toBe('hair_long');
    l = unequip(l, 'jacket'); expect(l.slots.jacket).toBeUndefined();
    expect(unequip(l, 'hair').slots.hair).toBe('hair_long');
    expect(() => equip(DEFAULT_LOOK.f, 'beard_full')).toThrow(); expect(equip(DEFAULT_LOOK.m, 'beard_full').slots.beard).toBe('beard_full');
  });
  it('serializes and parses, dropping unknown/unowned items and filling required slots', () => {
    const l = equip(equip(DEFAULT_LOOK.m, 'hair_afro'), 'acc_cap');
    expect(parseLook(serializeLook(l))).toEqual(l);
    const owned = new Set(['acc_cap']);
    const p = parseLook(serializeLook(l), (id) => owned.has(id)); expect(p.slots.hair).toBe('hair_quiff'); expect(p.slots['acc.hat']).toBe('acc_cap');
    expect(parseLook('{garbage')).toEqual(sanitizeLook(null));
    expect(sanitizeLook({ body: 'f', slots: { hair: 'tee_white', top: 'nope', beard: 'beard_full' } }).slots).toMatchObject({ hair: 'hair_buns', top: 'tee_cheese' });
  });
  it('computes the try-on cart and reverts unbought items', () => {
    const owned = new Set<string>();
    const tryOn = equip(equip(equip(DEFAULT_LOOK.f, 'hair_pony'), 'tee_yoo'), 'eyecol_blue');
    expect(unownedItems(tryOn, (id) => owned.has(id)).map((i) => i.id).sort()).toEqual(['hair_pony', 'tee_yoo']);
    const back = revertUnowned(tryOn, DEFAULT_LOOK.f, (id) => owned.has(id)); expect(back.slots.hair).toBe('hair_buns'); expect(back.slots.eyeColor).toBe('eyecol_blue');
  });
  it('default looks use only free items', () => { for (const l of Object.values(DEFAULT_LOOK)) for (const id of Object.values(l.slots)) expect(isFree(ITEMS[id!])).toBe(true); });
});
