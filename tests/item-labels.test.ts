import { describe, expect, it } from 'vitest';
import { CATALOGUE } from '../src/fashion/catalogue';
import { FURNITURE } from '../src/data/furniture';

/** Owner decisions v1.2 (2026-11-19): no Épique/Légendaire on unlimited-stock items;
 *  the starter TV and teddy bear are common starter items. All current shop items
 *  are unlimited (no maxSupply / issued count exists in the registry). */
describe('item labels (owner decisions v1.2)', () => {
  it('no unlimited-stock item carries Epic or Legendary', () => {
    const badFashion = CATALOGUE.filter((i) => i.rarity === 'epic' || i.rarity === 'legendary').map((i) => i.id);
    const badFurn = Object.values(FURNITURE).filter((d) => d.rarity === 'epic' || d.rarity === 'legendary').map((d) => d.id);
    expect(badFashion).toEqual([]);
    expect(badFurn).toEqual([]);
  });
  it('starter TV and teddy bear are common', () => {
    expect(FURNITURE.televisionModern.rarity).toBe('common');
    expect(FURNITURE.bear.rarity).toBe('common');
  });
});
