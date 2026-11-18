import { describe, expect, it } from 'vitest';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { FashionController } from '../src/fashion/FashionController';
import { DEFAULT_LOOK, equip } from '../src/fashion/look';
import { resolveLook, hasHat } from '../src/render/avatar/custom/spec';
import { compositePixels, computeStats, patternAt } from '../src/render/avatar/custom/composite';
import { PART } from '../src/render/avatar/custom/parts';
import { ITEMS } from '../src/fashion/catalogue';

const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };

describe('studio flow (controller + local dev economy)', () => {
  it('try-on several items, buy the outfit atomically, persist the look, then re-load it', async () => {
    const store = kv(); const eco = new LocalDevEconomy(store); const fc = new FashionController(eco);
    fc.open('f', 'tshirt');
    fc.tap('tee_stripes'); fc.tap('jacket_denim'); fc.tap('acc_glasses_heart');
    expect(fc.cart().map((i) => i.id).sort()).toEqual(['acc_glasses_heart', 'jacket_denim', 'tee_stripes']);
    const t = fc.totals(); expect(t.gold).toBe(ITEMS.tee_stripes.price!.amount + ITEMS.jacket_denim.price!.amount); expect(t.diamond).toBe(15);
    expect(await fc.buyCart()).toBe(true);
    const a = eco.snapshot().account; expect(a.gold.balance).toBe(5000 - t.gold); expect(a.diamond.balance).toBe(100 - 15);
    expect(fc.cart()).toEqual([]); expect(fc.s.looks.f.slots.top).toBe('tee_stripes');
    // re-buying is refused and charges nothing
    expect(await fc.buy(['tee_stripes'])).toBe(false); expect(eco.snapshot().account.gold.balance).toBe(5000 - t.gold);
    // a fresh controller on the same storage restores ownership + equipped look
    const fc2 = new FashionController(new LocalDevEconomy(store)); expect(fc2.s.looks.f.slots.jacket).toBe('jacket_denim'); expect(fc2.owns('acc_glasses_heart')).toBe(true);
  });
  it('closing with unbought try-ons asks first, and leaving without buying keeps only owned items', async () => {
    const eco = new LocalDevEconomy(kv()); const fc = new FashionController(eco); fc.open('m', 'hair'); const before = fc.s.looks.m.slots.hair;
    fc.tap('hair_afro'); await fc.close(); expect(fc.s.studio?.leaving).toBe(true);
    fc.clearCart(); await fc.close('keep-owned'); expect(fc.s.studio).toBeNull(); expect(fc.s.looks.m.slots.hair).toBe(before);
    expect(eco.snapshot().account.diamond.balance).toBe(100);
  });
  it('switching avatar with try-ons remembers the target body', () => {
    const fc = new FashionController(new LocalDevEconomy(kv())); fc.open('f', 'pants'); fc.tap('pants_jeans'); fc.switchBody('m');
    expect(fc.s.studio).toMatchObject({ body: 'f', leaving: true, pending: 'm' }); fc.clearCart(); fc.switchBody('m'); expect(fc.s.studio?.body).toBe('m');
  });
  it('cannot afford beyond the test balances', async () => {
    const fc = new FashionController(new LocalDevEconomy(kv())); fc.open('f', 'jacket');
    for (const id of ['jacket_bomber_gold', 'hair_afro', 'acc_crown']) fc.tap(id); // 45+35+60 = 140 💎 > 100
    expect(fc.canAfford(fc.totals())).toBe(false); expect(await fc.buyCart()).toBe(false);
  });
});

describe('render spec (pure)', () => {
  it('maps a look to geometry/texture parameters', () => {
    let l = DEFAULT_LOOK.m; for (const id of ['beard_full', 'hair_mohawk', 'acc_cap', 'shoes_boots', 'pants_pink_shorts', 'eyes_big', 'jacket_hoodie']) l = equip(l, id);
    const s = resolveLook(l);
    expect(s.beard).toBe('full'); expect(s.hair).toBe('mohawk'); expect(hasHat(s)).toBe(true); expect(s.shoes.shaft).toBe('boot');
    expect(s.pants.length).toBe('short'); expect(Object.keys(s.morph).length).toBeGreaterThan(0); expect(s.jacket?.extra).toBe('hood');
  });
  it('never renders a beard on the female body', () => { expect(resolveLook(DEFAULT_LOOK.f).beard).toBe('none'); });
});

describe('atlas compositor (pure)', () => {
  it('recolours only the labelled regions', () => {
    const size = 16; const base = new Uint8ClampedArray(size * size * 4).fill(200); const mask = new Uint8Array(size * size);
    for (let i = 0; i < size * size; i++) mask[i] = i < 64 ? PART.SKIN_HEAD : i < 128 ? PART.TEE : PART.NONE;
    for (let i = 3; i < base.length; i += 4) base[i] = 255;
    const st = computeStats(base, mask, size); const look = equip(equip(DEFAULT_LOOK.f, 'skin_ebony'), 'tee_white');
    const out = compositePixels(base, mask, size, resolveLook(look), st);
    expect(out[0]).toBeLessThan(150); // skin darkened
    const none = 200 * 4; expect([out[none], out[none + 1], out[none + 2]]).toEqual([200, 200, 200]); // unlabelled untouched
  });
  it('patterns are deterministic and bounded', () => {
    for (const p of ['stripes', 'check', 'camo', 'sequin', 'tiedye', 'galaxy', 'denim', 'leather', 'none'] as const) {
      const a = patternAt(p, 37, 91, 1); expect(a).toEqual(patternAt(p, 37, 91, 1)); expect(a[0]).toBeGreaterThanOrEqual(0); expect(a[0]).toBeLessThanOrEqual(1);
    }
  });
});
