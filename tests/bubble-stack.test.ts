import { describe, expect, it } from 'vitest';
import { stackOffsets, type Box, type StackItem } from '../src/ui/chat/bubbleStack';

const box = (l: number, t: number, w = 120, h = 30): Box => ({ l, t, r: l + w, b: t + h });
const moved = (b: Box, o: { dx: number; dy: number }) => ({ l: b.l + o.dx, r: b.r + o.dx, t: b.t + o.dy, b: b.b + o.dy });
const overlap = (a: Box, b: Box) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

describe('speech-bubble de-overlap', () => {
  it('own bubble never moves; overlapping bubbles are lifted / side-stepped until none overlap', () => {
    const items: StackItem[] = [
      { id: 'me', self: true, box: box(300, 200) },
      { id: 'a', self: false, box: box(320, 205) },
      { id: 'b', self: false, box: box(340, 190) },
    ];
    const o = stackOffsets(items, [], { w: 852, h: 393 });
    expect(o.get('me')).toEqual({ dx: 0, dy: 0, stuck: false });
    const placed = items.map((i) => moved(i.box, o.get(i.id)!));
    for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) expect(overlap(placed[i], placed[j])).toBe(false);
  });

  it('avoids fixed obstacles (top HUD chips) and stays in the viewport', () => {
    const hud: Box = { l: 280, t: 0, r: 500, b: 40 };
    const items: StackItem[] = [{ id: 'me', self: true, box: box(300, 60) }, { id: 'x', self: false, box: box(310, 62) }];
    const o = stackOffsets(items, [hud], { w: 852, h: 393 });
    const x = moved(items[1].box, o.get('x')!);
    expect(overlap(x, hud)).toBe(false); expect(overlap(x, moved(items[0].box, o.get('me')!))).toBe(false);
    expect(x.t).toBeGreaterThanOrEqual(0);
  });

  it('no overlap -> no move', () => {
    const o = stackOffsets([{ id: 'a', self: false, box: box(0, 100) }, { id: 'b', self: false, box: box(400, 100) }]);
    expect(o.get('a')).toMatchObject({ dx: 0, dy: 0 }); expect(o.get('b')).toMatchObject({ dx: 0, dy: 0 });
  });
});
