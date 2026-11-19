import { describe, expect, it } from 'vitest';
import { avoidOffset, TAG_MARGIN } from '../src/ui/tagAvoid';

const chip = { l: 750, t: 15, r: 834, b: 35 }; // 'Mode local' chip, top-right at 844×390
describe('name tags never sit under the HUD chips', () => {
  it('no shift when the tag is clear of every chip', () => {
    expect(avoidOffset({ l: 400, t: 120, r: 470, b: 140 }, [chip])).toBe(0);
    expect(avoidOffset({ l: 600, t: 20, r: 700, b: 40 }, [chip])).toBe(0); // same height, left of the chip
  });
  it('a tag sliding under the chip is pushed just below it (margin kept)', () => {
    const dy = avoidOffset({ l: 760, t: 20, r: 830, b: 40 }, [chip]);
    expect(20 + dy).toBe(chip.b + TAG_MARGIN);
  });
  it('clears a taller neighbour too, and the result overlaps nothing', () => {
    const obs = [chip, { l: 700, t: 10, r: 745, b: 48 }]; const tag = { l: 690, t: 25, r: 790, b: 45 };
    const dy = avoidOffset(tag, obs);
    for (const o of obs) expect(tag.t + dy >= o.b || tag.l >= o.r || tag.r <= o.l).toBe(true);
    expect(tag.t + dy).toBe(48 + TAG_MARGIN);
  });
});
