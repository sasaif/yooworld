import { describe, expect, it } from 'vitest';
import { intersects, placeBoxes, type Box } from '../src/ui/map/mapLayout';

const sh = (b: Box, n: { dx: number; dy: number }) => ({ ...b, x: b.x + n.dx, y: b.y + n.dy });

describe('map layout solver (badges / pins / Toi)', () => {
  const view = { w: 667, h: 375 };
  const close = { x: 613, y: 8, w: 44, h: 44 }, title = { x: 10, y: 8, w: 190, h: 44 };

  it('moves a badge out from under the ✕ and keeps it fully inside the view (iPhone SE BUG-1)', () => {
    const travail = { x: 560, y: 22, w: 120, h: 50 }; // overlaps ✕ and leaves the view on the right
    const [n] = placeBoxes([travail], [close, title], view);
    const b = sh(travail, n);
    expect(intersects(b, close, 5)).toBe(false);
    expect(b.x).toBeGreaterThanOrEqual(6); expect(b.x + b.w).toBeLessThanOrEqual(view.w - 6);
    expect(b.y + b.h).toBeLessThanOrEqual(view.h - 6);
  });

  it('keeps badges off the title and off each other', () => {
    const items = [{ x: 60, y: 30, w: 150, h: 50 }, { x: 120, y: 40, w: 150, h: 50 }];
    const ns = placeBoxes(items, [close, title], view);
    const bs = items.map((b, i) => sh(b, ns[i]));
    expect(intersects(bs[0], title, 5)).toBe(false);
    expect(intersects(bs[1], title, 5)).toBe(false);
    expect(intersects(bs[0], bs[1], 5)).toBe(false);
  });

  it('does not move anything that is already clear', () => {
    expect(placeBoxes([{ x: 300, y: 200, w: 100, h: 44 }], [close, title], view)).toEqual([{ dx: 0, dy: 0 }]);
  });

  it('moves the "Toi" marker off the current-location badge (BUG-2), with a short move', () => {
    const plage = { x: 250, y: 290, w: 120, h: 50 }, toi = { x: 290, y: 280, w: 30, h: 46 };
    const [, n] = placeBoxes([plage, toi], [close, title], view);
    const t = sh(toi, n);
    expect(intersects(t, plage, 0)).toBe(false);
    expect(Math.hypot(n.dx, n.dy)).toBeLessThan(90);
  });
});
