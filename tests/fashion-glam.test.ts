import { describe, expect, it } from 'vitest';
import { CATALOGUE, CATEGORIES, ITEMS } from '../src/fashion/catalogue';
import { GLAM_DRESSES, GLAM_EYES, GLAM_GLASSES, GLAM_HAIR, GLAM_ITEMS } from '../src/fashion/glam';
import { validateCatalogue } from '../src/fashion/schema';
import { DEFAULT_LOOK, equip, parseLook, sanitizeLook, serializeLook } from '../src/fashion/look';
import { resolveLook } from '../src/render/avatar/custom/spec';
import { applyTestTopUp, initialState, newAccount, TEST_BALANCES, TEST_FRIEND, TEST_PLAYER, TEST_TOPUP } from '../src/economy/bank';
import { audit, hasTx } from '../src/economy/ledger';
import { checkout } from '../src/economy/purchase';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { RemoteEconomy } from '../src/economy/RemoteEconomy';

const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const T0 = Date.UTC(2026, 10, 21, 9);
describe('Glam collection catalogue (approved 2026-11-21)', () => {
  it('has every approved piece: 6×3 + 3×3 dresses, 3 hairstyles (+3 colours), 3 eye looks, P1 (+3 Terrazzo shapes) + 6 YoVille mixes + 6×4 retro glasses', () => {
    expect(GLAM_DRESSES).toHaveLength(27); expect(GLAM_DRESSES.filter((i) => i.render.pattern === 'latex')).toHaveLength(9);
    expect(GLAM_HAIR.filter((i) => i.slot === 'hair')).toHaveLength(3); expect(GLAM_HAIR.filter((i) => i.slot === 'hairColor')).toHaveLength(3);
    expect(GLAM_EYES).toHaveLength(3); expect(GLAM_GLASSES).toHaveLength(1 + 3 + 6 + 24); expect(GLAM_ITEMS).toHaveLength(70);
    for (const n of GLAM_ITEMS.map((i) => i.name)) expect(n).not.toMatch(/ray-?ban|police|yoworld|yoville/i);
    expect(ITEMS.acc_yoville_p1.render).toMatchObject({ acc: 'glasses_yoville_p1', color: '#e27fb0', trim: '#1a6cff' });
  });
  it('is all Diamonds, priced 20–50, valid, additive and only in existing save slots', () => {
    expect(validateCatalogue(CATALOGUE)).toEqual([]);
    for (const i of GLAM_ITEMS) { expect(i.price?.currency).toBe('diamond'); expect(i.price!.amount).toBeGreaterThanOrEqual(20); expect(i.price!.amount).toBeLessThanOrEqual(50); expect(ITEMS[i.id]).toBe(i); }
    expect(new Set(GLAM_ITEMS.map((i) => i.slot))).toEqual(new Set(['top', 'hair', 'hairColor', 'makeup.eyes', 'acc.glasses']));
    expect(CATEGORIES.find((c) => c.id === 'dress')?.label).toBe('Robes');
    for (const l of Object.values(DEFAULT_LOOK)) for (const id of Object.values(l.slots)) expect(ITEMS[id!].tags?.includes('glam')).toBeFalsy();
  });
  it('dresses are female-only, saved in the existing top slot (v:1) and keep jacket + pants in the save', () => {
    const l = equip(DEFAULT_LOOK.f, 'dress_gv3_noir'); const s = serializeLook(l); const back = parseLook(s);
    expect(JSON.parse(s).v).toBe(1); expect(back.slots.top).toBe('dress_gv3_noir'); expect(back.slots.jacket).toBe('jacket_green'); expect(back.slots.pants).toBe('pants_shorts_black');
    expect(() => equip(DEFAULT_LOOK.m, 'dress_d1_cerise')).toThrow(); expect(sanitizeLook({ v: 1, body: 'm', slots: { top: 'dress_d1_cerise' } }).slots.top).toBe('tee_cheese');
    const sp = resolveLook(l); expect(sp.jacket).toBeUndefined(); expect(sp.dress).toMatchObject({ id: 'gv3', pattern: 'latex', color: '#0d0b10', gloves: '#0d0b10' }); expect(sp.shoes.color).toBe('#0d0b10');
    const off = equip(l, 'tee_white'); expect(resolveLook(off).jacket?.color).toBe('#7ed321'); expect(resolveLook(off).dress).toBeUndefined(); // old outfit comes back
  });
  it('existing looks resolve exactly as before (no glam fields)', () => {
    for (const b of ['f', 'm'] as const) { const sp = resolveLook(DEFAULT_LOOK[b]) as unknown as Record<string, unknown>; for (const k of ['dress', 'hairAccent', 'hairBand', 'wing', 'browColor']) expect(k in sp).toBe(false); }
    const sp = resolveLook(equip(DEFAULT_LOOK.f, 'acc_sunglasses')); expect(sp.acc).toEqual([{ model: 'backpack', color: '#7b6fd6', color2: undefined }, { model: 'sunglasses', color: '#141018', color2: '#ff7ab8' }]);
  });
  it('eye looks drive iris, shadow, winged liner, lips and brows; gothic hair carries its streak colour', () => {
    const sp = resolveLook(equip(equip(DEFAULT_LOOK.f, 'eyelook_rubis'), 'hair_goth_pony'));
    expect(sp).toMatchObject({ eyeColor: '#c0142e', shadow: '#5a1a2a', liner: '#0c0810', wing: true, browColor: '#3a0a18', hair: 'goth_pony', hairAccent: '#efe6e0', hairBand: '#100d14' }); expect(sp.lips.color).toBe('#8a0a1e');
    expect(resolveLook(equip(equip(DEFAULT_LOOK.f, 'eyelook_rubis'), 'mk_lip_rose')).lips.color).toBe('#e8578f'); // a lipstick item wins
  });
  it('glasses carry lens gradient / opacity / accent; one item of each type can be bought with diamonds', () => {
    expect(resolveLook(equip(DEFAULT_LOOK.f, 'acc_cateye_cerise')).acc.find((a) => a.model === 'glasses_cateye')).toEqual({ model: 'glasses_cateye', color: '#c4122f', color2: '#ff6f9c', lens2: '#ffd0de', opacity: 0.72, trim: '#ffe08a' });
    const ids = ['dress_d1_cerise', 'dress_gv1_cerise', 'hair_goth_long', 'haircol_raven', 'eyelook_smoky_prune', 'acc_yoville_p1', 'acc_terrazzo_wayfarer', 'acc_yoville_mauve', 'acc_biba_rose'];
    const r = checkout(initialState(T0), TEST_PLAYER, ids, ITEMS, 'g1', T0); const a = r.state.accounts[TEST_PLAYER];
    const cost = ids.reduce((s, id) => s + ITEMS[id].price!.amount, 0); expect(a.diamond.balance).toBe(100000 - cost); expect(a.gold.balance).toBe(5000);
    for (const id of ids) expect(a.owned[id].bound).toBe(true); expect(audit(a.diamond)).toBe(true);
  });
});
describe('TEST diamond balance 100 000 (local dev only)', () => {
  const oldSave = () => { const s = initialState(T0); return { ...s, accounts: { ...s.accounts, [TEST_PLAYER]: { ...newAccount(TEST_PLAYER, 'Joueur test (toi)', 5000, 100, T0), owned: { tee_heart: { itemId: 'tee_heart', acquiredAt: T0, txId: 'x', currency: 'gold' as const, price: 200, bound: false } } } } }; };
  it('new saves start at 100 000 💎 for the test player only', () => {
    expect(TEST_BALANCES[TEST_PLAYER].diamond).toBe(100000); const s = initialState(T0);
    expect(s.accounts[TEST_PLAYER].diamond.balance).toBe(100000); expect(s.accounts[TEST_FRIEND].diamond.balance).toBe(0);
  });
  it('tops up an existing 100 💎 save once (auditable test_grant), touching nothing else', () => {
    const s0 = oldSave(); const s1 = applyTestTopUp(s0, T0); const a = s1.accounts[TEST_PLAYER];
    expect(a.diamond.balance).toBe(100000); expect(hasTx(a.diamond, TEST_TOPUP.txId, 'test_grant')).toBe(true); expect(audit(a.diamond)).toBe(true);
    expect(a.gold).toBe(s0.accounts[TEST_PLAYER].gold); expect(a.owned).toBe(s0.accounts[TEST_PLAYER].owned); expect(s1.accounts[TEST_FRIEND]).toBe(s0.accounts[TEST_FRIEND]); expect(s1.trades).toBe(s0.trades);
    // spent afterwards: never topped up again
    const spent = checkout(s1, TEST_PLAYER, ['acc_yoville_p1'], ITEMS, 'k', T0).state; expect(applyTestTopUp(spent, T0)).toBe(spent);
    expect(applyTestTopUp(initialState(T0), T0).accounts[TEST_PLAYER].diamond.entries).toHaveLength(1); // fresh save: nothing to add
    const fresh = checkout(initialState(T0), TEST_PLAYER, ['acc_yoville_p1'], ITEMS, 'k2', T0).state; // fresh save, then spend: no refill on the next load
    expect(applyTestTopUp(fresh, T0)).toBe(fresh); expect(fresh.accounts[TEST_PLAYER].diamond.balance).toBe(100000 - 50);
  });
  it('LocalDevEconomy applies it on load and persists it in the SAME key (no new key)', () => {
    const k = kv(); k.setItem('eco:dev', JSON.stringify(oldSave())); k.setItem('look:test-player:f', '{"v":1,"body":"f","slots":{}}'); const before = [...k.m.keys()].sort();
    const e = new LocalDevEconomy(k); expect(e.snapshot().account.diamond.balance).toBe(100000); expect(e.owns('tee_heart')).toBe(true);
    expect([...k.m.keys()].sort()).toEqual(before); expect(k.getItem('look:test-player:f')).toBe('{"v":1,"body":"f","slots":{}}');
    const raw = k.getItem('eco:dev'); const e2 = new LocalDevEconomy(k); expect(e2.snapshot().account.diamond.balance).toBe(100000); expect(k.getItem('eco:dev')).toBe(raw); // idempotent
  });
  it('a corrupt / future save is never written by the top-up; RemoteEconomy has no top-up', () => {
    const k = kv(); k.setItem('eco:dev', '{"version":2}'); const e = new LocalDevEconomy(k); expect(e.readOnly).toBe(true); expect(k.getItem('eco:dev')).toBe('{"version":2}');
    expect(Object.getOwnPropertyNames(RemoteEconomy.prototype).some((n) => /topup/i.test(n))).toBe(false);
  });
});
