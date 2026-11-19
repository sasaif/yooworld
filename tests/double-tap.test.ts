import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { newTapMemo, registerTap } from '../src/game/movement/doubleTap';

describe('floor double tap (touch double-tap = run)', () => {
  it('two quick taps at the same spot make a double tap; slow or far taps do not', () => {
    const m = newTapMemo();
    expect(registerTap(m, 1000, 2, 2)).toBe(false);
    expect(registerTap(m, 1250, 2.1, 2)).toBe(true);
    expect(registerTap(m, 1300, 2.1, 2)).toBe(false); // consumed: a third tap starts a new pair
    expect(registerTap(m, 2000, 2.1, 2)).toBe(false); // 700 ms later
    expect(registerTap(m, 2200, 4, 4)).toBe(false); // too far
    expect(registerTap(m, 5000, 1, 1, 2)).toBe(true); // browser click count (mouse double-click)
  });
  it('regression: the views record the tap in code, not inside a trailing comment', () => {
    for (const f of ['src/render/apartment/ApartmentView.tsx', 'src/render/beach/BeachView.tsx']) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).toContain('registerTap(lastTap.current');
      for (const line of src.split('\n')) { const c = line.indexOf('//'); if (c >= 0) expect(line.slice(c)).not.toMatch(/lastTap\.current\s*=/); }
    }
  });
});
