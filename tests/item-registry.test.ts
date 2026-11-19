import { describe, expect, it } from 'vitest';
import {
  ITEM_REGISTRY, ITEM_CLASSES, NON_TRADABLE_REASONS, catalogueRows, compareWithCatalogue, registryItem, registryKey, validateRegistry, type RegistryItem,
} from '../src/registry';
import { defaultApartment, STARTER_INVENTORY } from '../src/data/defaultApartment';
import { CATALOGUE } from '../src/fashion/catalogue';
import { FURNITURE } from '../src/data/furniture';
import baseline from './fixtures/item-prices-119643c.json';

const live = ITEM_REGISTRY.filter((i) => !i.pendingBranch);
const priceKey = (i: RegistryItem) => (i.price ? `${i.price.currency}:${i.price.amount}` : 'free');

describe('item registry v1 — structure', () => {
  it('passes every structural rule (unique ids, classes, Limited⇒maxSupply, documented exceptions)', () => {
    expect(validateRegistry(ITEM_REGISTRY)).toEqual([]);
  });
  it('has unique keys and unique ids per kind; fashion and furniture ids never collide', () => {
    const keys = ITEM_REGISTRY.map(registryKey);
    expect(new Set(keys).size).toBe(keys.length);
    const fashion = new Set(ITEM_REGISTRY.filter((i) => i.kind === 'fashion').map((i) => i.id));
    expect(ITEM_REGISTRY.filter((i) => i.kind === 'furniture' && fashion.has(i.id))).toEqual([]);
  });
  it('only uses official classes; Épique/Légendaire are never a class', () => {
    for (const i of ITEM_REGISTRY) {
      expect(ITEM_CLASSES).toContain(i.classification);
      expect(String(i.classification)).not.toMatch(/epic|legendary/i);
    }
  });
  it('no unlimited item carries an unresolved Epic/Legendary badge', () => {
    const bad = ITEM_REGISTRY.filter((i) => (i.legacyRarity === 'epic' || i.legacyRarity === 'legendary') && i.classification !== 'LimitedEdition' && i.labelStatus === 'ok');
    expect(bad.map((i) => i.id)).toEqual([]);
  });
  it('no item is Limited/Rare/Seasonal/Exclusive today (no scarce obtain method exists) and none has a maxSupply', () => {
    expect(ITEM_REGISTRY.filter((i) => !['Free', 'Gold', 'Premium'].includes(i.classification))).toEqual([]);
    expect(ITEM_REGISTRY.filter((i) => i.maxSupply !== undefined)).toEqual([]);
  });
  it('rejects a Limited Edition row without maxSupply and accepts one with it', () => {
    const base = registryItem('acc_crown')!;
    expect(validateRegistry([{ ...base, classification: 'LimitedEdition' }])).toContain('acc_crown: LimitedEdition sans maxSupply');
    expect(validateRegistry([{ ...base, classification: 'LimitedEdition', maxSupply: 0 }])).toContain('acc_crown: LimitedEdition sans maxSupply');
    expect(validateRegistry([{ ...base, classification: 'LimitedEdition', maxSupply: 500 }])).toEqual([]);
    expect(validateRegistry([{ ...base, maxSupply: 500 }])).toContain('acc_crown: maxSupply réservé à LimitedEdition');
  });
  it('rejects tradable=false without a documented reason, Epic as a class, an undocumented Epic badge, duplicates', () => {
    const base = registryItem('tee_galaxy')!;
    expect(validateRegistry([{ ...base, tradable: false }])).toContain('tee_galaxy: tradable=false sans raison documentée');
    expect(validateRegistry([{ ...base, classification: 'Epic' as never }]).join()).toMatch(/Épique\/Légendaire ne sont pas des classes/);
    expect(validateRegistry([{ ...base, labelStatus: 'ok' }])).toContain('tee_galaxy: badge Épique/Légendaire sur un article illimité');
    expect(validateRegistry([base, base])).toContain('tee_galaxy: clé en double');
  });
  it('documents every non-tradable reason used', () => {
    for (const i of ITEM_REGISTRY.filter((x) => !x.tradable)) expect(NON_TRADABLE_REASONS[i.nonTradableReason!]).toBeTruthy();
  });
});

describe('item registry v1 — matches the existing catalogues exactly', () => {
  it('every live catalogue item is registered with identical id, name, category and price', () => {
    expect(compareWithCatalogue(ITEM_REGISTRY, catalogueRows())).toEqual([]);
  });
  it('detects a price drift or a missing item', () => {
    const rows = catalogueRows();
    const drift = rows.map((r) => (r.id === 'acc_crown' ? { ...r, price: { currency: 'diamond', amount: 61 } } : r));
    expect(compareWithCatalogue(ITEM_REGISTRY, drift)).toContain('acc_crown: prix diamond:60 ≠ catalogue diamond:61');
    expect(compareWithCatalogue(ITEM_REGISTRY, [...rows, { kind: 'fashion', id: 'new_thing', name: 'X', category: 'hair', price: null }])).toContain('new_thing: absent du registre');
  });
  it('ids and prices are identical to the 119643c baseline (no rename, no reprice, no removal)', () => {
    const base = baseline.items as [string, string, string][];
    expect(live.length).toBe(base.length);
    for (const [kind, id, price] of base) {
      const i = registryItem(kind === 'floor' || kind === 'wall' ? `${kind}:${id}` : id);
      expect(i, `${kind}:${id}`).toBeDefined();
      expect(i!.kind).toBe(kind);
      expect(priceKey(i!), `${kind}:${id}`).toBe(price);
    }
  });
  it('covers fashion, furniture and finishes', () => {
    const inCat = new Set(CATALOGUE.map((i) => i.id));
    const n = (k: string) => ITEM_REGISTRY.filter((i) => i.kind === k && (!i.pendingBranch || inCat.has(i.id))).length;
    expect([n('fashion'), n('furniture'), n('floor'), n('wall')]).toEqual([CATALOGUE.length, Object.keys(FURNITURE).length, 5, 5]);
  });
  it('items pre-registered for another branch are flagged (avatar-hair-test additions)', () => {
    const pend = ITEM_REGISTRY.filter((i) => i.pendingBranch);
    expect(pend.map((i) => i.id).sort()).toEqual(['eyes_sparkle', 'hair_braids', 'hair_bun_high', 'mouth_smile']);
  });
});

describe('item registry v1 — defaults (v1.1 §2, v1.2)', () => {
  it('Premium (Diamond) items are tradable by default', () => {
    const prem = ITEM_REGISTRY.filter((i) => i.price?.currency === 'diamond');
    expect(prem.length).toBe(21);
    for (const i of prem) { expect(i.classification).toBe('Premium'); expect(i.tradable).toBe(true); }
  });
  it('free base options are Free and non-tradable (free_base)', () => {
    for (const i of ITEM_REGISTRY.filter((x) => !x.price)) { expect(i.classification).toBe('Free'); expect(i.tradable).toBe(false); }
  });
  it('every starter apartment and starter inventory item is non-tradable (starter_item)', () => {
    const ids = new Set([...defaultApartment('t').items.map((p) => p.defId), ...Object.keys(STARTER_INVENTORY)]);
    expect([...ids].sort()).toEqual([...baseline.starterApartment, ...Object.keys(baseline.starterInventory)].filter((v, i, a) => a.indexOf(v) === i).sort());
    for (const id of ids) { const i = registryItem(id)!; expect(i.tradable, id).toBe(false); expect(i.nonTradableReason, id).toBe('starter_item'); expect(i.acquisition).toContain('starter_grant'); }
    for (const k of ['floor:oak', 'wall:peach']) expect(registryItem(k)!.nonTradableReason).toBe('starter_item');
  });
  it('starting TV and teddy bear are common starters: no Rare/Epic class, badge removal recorded', () => {
    for (const id of ['televisionModern', 'bear']) {
      const i = registryItem(id)!;
      expect(i.classification).not.toBe('Rare'); expect(i.tradable).toBe(false); expect(i.labelStatus).toBe('remove_approved');
    }
  });
  it('ordinary Gold shop items (not starter, not finishes) are tradable', () => {
    const gold = ITEM_REGISTRY.filter((i) => i.classification === 'Gold' && !i.acquisition.includes('starter_grant') && i.kind !== 'floor' && i.kind !== 'wall');
    expect(gold.length).toBeGreaterThan(0);
    for (const i of gold) expect(i.tradable, i.id).toBe(true);
  });
});
