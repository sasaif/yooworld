import { describe, expect, it } from 'vitest';
import { FURNITURE as CAT } from '../src/data/furniture';
import { defaultApartment } from '../src/data/defaultApartment';
import { canPlace, childrenOf, findSpot, footprint, moveItem, placeItem, removeItem, rotateItem, toggleItem, type ApartmentLayout } from '../src/game/apartment/ApartmentModel';

const empty = (): ApartmentLayout => ({ ...defaultApartment('t'), items: [] });

describe('default apartment', () => {
  it('every starter item is validly placed', () => {
    const a = defaultApartment('t');
    for (const it of a.items) {
      const r = canPlace(a, CAT, it, it.uid);
      expect(r.ok, `${it.defId} @${it.x},${it.z} -> ${JSON.stringify(r)}`).toBe(true);
    }
  });
});

describe('placement rules', () => {
  it('rejects out-of-bounds', () => {
    expect(canPlace(empty(), CAT, { defId: 'loungeSofa', x: 22, z: 5, rot: 0 })).toEqual({ ok: false, reason: 'bounds' });
    expect(canPlace(empty(), CAT, { defId: 'loungeSofa', x: -1, z: 5, rot: 0 }).ok).toBe(false);
  });
  it('rejects floor overlap but allows furniture on rugs', () => {
    const a = placeItem(empty(), CAT, { defId: 'loungeSofa', x: 5, z: 5, rot: 0 }); expect(a.ok).toBe(true); if (!a.ok) return;
    expect(canPlace(a.layout, CAT, { defId: 'loungeChair', x: 6, z: 5, rot: 0 })).toEqual({ ok: false, reason: 'collision' });
    expect(canPlace(a.layout, CAT, { defId: 'rugRound', x: 5, z: 5, rot: 0 }).ok).toBe(true);
  });
  it('keeps the door free', () => {
    expect(canPlace(empty(), CAT, { defId: 'pottedPlant', x: 17, z: 0, rot: 0 })).toEqual({ ok: false, reason: 'door' });
  });
  it('top items need a surface', () => {
    expect(canPlace(empty(), CAT, { defId: 'radio', x: 5, z: 5, rot: 0 })).toEqual({ ok: false, reason: 'noSurface' });
    const t = placeItem(empty(), CAT, { defId: 'tableCoffee', x: 5, z: 5, rot: 0 }); if (!t.ok) throw 0;
    expect(canPlace(t.layout, CAT, { defId: 'radio', x: 5, z: 5, rot: 0 }).ok).toBe(true);
  });
  it('rotation swaps the footprint', () => {
    const f0 = footprint({ defId: 'loungeSofa', x: 0, z: 0, rot: 0 }, CAT), f1 = footprint({ defId: 'loungeSofa', x: 0, z: 0, rot: 1 }, CAT);
    expect([f1.w, f1.d]).toEqual([f0.d, f0.w]);
  });
});

describe('edits', () => {
  it('move carries items standing on the parent, rotate keeps them on it', () => {
    let a = placeItem(empty(), CAT, { defId: 'cabinetTelevision', x: 4, z: 4, rot: 0, uid: 'cab' }); if (!a.ok) throw 0;
    a = placeItem(a.layout, CAT, { defId: 'televisionModern', x: 4, z: 4, rot: 0, uid: 'tv' }); if (!a.ok) throw 0;
    const m = moveItem(a.layout, CAT, 'cab', 10, 8, 0); expect(m.ok).toBe(true); if (!m.ok) return;
    const tv = m.layout.items.find((i) => i.uid === 'tv')!; expect([tv.x, tv.z]).toEqual([10, 8]);
    const r = rotateItem(m.layout, CAT, 'cab'); expect(r.ok).toBe(true); if (!r.ok) return;
    expect(childrenOf(r.layout, CAT, 'cab').map((k) => k.uid)).toEqual(['tv']);
    expect(r.layout.items.find((i) => i.uid === 'tv')!.rot).toBe(1);
  });
  it('move into a collision is refused', () => {
    let a = placeItem(empty(), CAT, { defId: 'loungeSofa', x: 2, z: 2, rot: 0, uid: 'a' }); if (!a.ok) throw 0;
    a = placeItem(a.layout, CAT, { defId: 'loungeChair', x: 10, z: 2, rot: 0, uid: 'b' }); if (!a.ok) throw 0;
    expect(moveItem(a.layout, CAT, 'b', 3, 2, 0).ok).toBe(false);
  });
  it('remove returns the item and what stood on it', () => {
    let a = placeItem(empty(), CAT, { defId: 'tableRound', x: 6, z: 6, rot: 0, uid: 't' }); if (!a.ok) throw 0;
    a = placeItem(a.layout, CAT, { defId: 'plantSmall2', x: 7, z: 7, rot: 0 }); if (!a.ok) throw 0;
    const r = removeItem(a.layout, CAT, 't'); expect(r.ok && r.stored).toEqual(['tableRound', 'plantSmall2']);
    expect(r.ok && r.layout.items.length).toBe(0);
  });
  it('toggle flips the on state; findSpot finds a free cell', () => {
    const a = defaultApartment('t'); const lamp = a.items.find((i) => i.defId === 'lampRoundFloor')!;
    expect(toggleItem(a, lamp.uid).items.find((i) => i.uid === lamp.uid)!.on).toBe(false);
    const s = findSpot(a, CAT, 'loungeChair', 12, 10); expect(s && canPlace(a, CAT, s).ok).toBe(true);
  });
});
