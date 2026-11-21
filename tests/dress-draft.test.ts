import { describe, expect, it } from 'vitest';
import { LocalDevEconomy } from '../src/economy/LocalDevEconomy';
import { FashionController } from '../src/fashion/FashionController';
import { DEFAULT_LOOK, equip, equipOutfit } from '../src/fashion/look';
import type { EconomyService } from '../src/economy/EconomyService';

/** Black-dress bug (Alessandro, uat 21/11): 'Short rose' (180 🪙) bought, the avatar ended up in a long black dress. */
const kv = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
const DRESS = 'dress_gv3_noir', SHORTS = 'pants_pink_shorts';
const env = () => { const k = kv(); const e = new LocalDevEconomy(k); return { k, e, fc: new FashionController(e) }; };
const bal = (e: LocalDevEconomy) => { const a = e.snapshot().account; return { g: a.gold.balance, d: a.diamond.balance }; };
const reloaded = (k: ReturnType<typeof kv>) => new FashionController(new LocalDevEconomy(k)).s.looks.f.slots;

describe('equipOutfit (dress vs trousers / jacket)', () => {
  const f = DEFAULT_LOOK.f;
  it('trousers or a jacket take a dress off (back to the base top, or the default tee)', () => {
    const withDress = equip(f, DRESS);
    expect(equipOutfit(withDress, SHORTS, f).slots).toMatchObject({ top: f.slots.top, pants: SHORTS });
    expect(equipOutfit(withDress, 'jacket_green', withDress).slots.top).toBe(DEFAULT_LOOK.f.slots.top);
  });
  it('anything else is a plain equip (a dress over trousers stays a dress)', () => {
    expect(equipOutfit(f, DRESS, f)).toEqual(equip(f, DRESS)); expect(equipOutfit(f, SHORTS, f)).toEqual(equip(f, SHORTS));
    expect(equipOutfit(equip(f, DRESS), 'hair_buns', f)).toEqual(equip(equip(f, DRESS), 'hair_buns'));
  });
});

describe('try on a dress, buy the shorts alone, reload', () => {
  it('A: an OWNED dress tried on again is not saved with the shorts', async () => {
    const x = env(); x.fc.open('f', 'dress'); x.fc.tap(DRESS); await x.fc.buy([DRESS]); x.fc.open('f', 'top'); x.fc.tap('tee_cheese'); await x.fc.close();
    const b0 = bal(x.e); x.fc.open('f', 'dress', 'owned'); x.fc.tap(DRESS); x.fc.setCat('pants'); x.fc.tap(SHORTS);
    expect(x.fc.s.studio!.draft.slots.top).toBe('tee_cheese'); // the shorts are visible in the preview
    await x.fc.buy([SHORTS]); await x.fc.close();
    const s = reloaded(x.k); expect(s.pants).toBe(SHORTS); expect(s.top).toBe('tee_cheese');
    expect(b0.g - bal(x.e).g).toBe(180); expect(b0.d - bal(x.e).d).toBe(0);
  });
  it('B: a not-owned dress leaves the try-on cart when the shorts go on (nothing else can be bought with them)', async () => {
    const x = env(); const b0 = bal(x.e); x.fc.open('f', 'dress'); x.fc.tap(DRESS); x.fc.setCat('pants'); x.fc.tap(SHORTS);
    expect(x.fc.cart().map((i) => i.id)).toEqual([SHORTS]);
    await x.fc.buy([SHORTS]); expect(x.fc.cart()).toEqual([]); await x.fc.close(); expect(x.fc.s.studio).toBeNull(); // no « articles en essai » prompt
    const s = reloaded(x.k); expect(s.pants).toBe(SHORTS); expect(s.top).toBe(DEFAULT_LOOK.f.slots.top);
    expect(x.e.owns(DRESS)).toBe(false); expect(b0.g - bal(x.e).g).toBe(180); expect(b0.d - bal(x.e).d).toBe(0);
  });
  it('a dress put on AFTER the shorts is still a normal try-on (kept only if bought)', async () => {
    const x = env(); x.fc.open('f', 'pants'); x.fc.tap(SHORTS); await x.fc.buy([SHORTS]); x.fc.setCat('dress'); x.fc.tap(DRESS);
    expect(x.fc.cart().map((i) => i.id)).toEqual([DRESS]); x.fc.clearCart(); await x.fc.close('keep-owned');
    expect(reloaded(x.k).top).not.toBe(DRESS);
  });
});

describe('purchase lock (double tap)', () => {
  it('a second buy while one is in flight is ignored: one checkout, one debit', async () => {
    const x = env(); let calls = 0; let release!: () => void; const gate = new Promise<void>((r) => (release = r));
    const real = x.e.checkout.bind(x.e);
    (x.e as unknown as EconomyService).checkout = (async (ids: string[], tx: string) => { calls++; await gate; return real(ids, tx); }) as EconomyService['checkout'];
    x.fc.open('f', 'pants'); x.fc.tap(SHORTS); const b0 = bal(x.e);
    const p1 = x.fc.buy([SHORTS]); const p2 = x.fc.buy([SHORTS]); expect(x.fc.s.buying).toBe(true);
    release(); const r = await Promise.all([p1, p2]);
    expect(r).toEqual([true, false]); expect(calls).toBe(1); expect(b0.g - bal(x.e).g).toBe(180); expect(x.fc.s.buying).toBe(false);
  });
});
