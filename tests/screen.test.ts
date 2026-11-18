import { describe, expect, it } from 'vitest';
import { isPhone, needsRotate } from '../src/app/screen';

describe('rotate screen policy', () => {
  it('asks phones in portrait to rotate', () => {
    expect(needsRotate({ w: 393, h: 852, coarse: true })).toBe(true);   // iPhone 15
    expect(needsRotate({ w: 412, h: 915, coarse: true })).toBe(true);   // Pixel 7
  });
  it('lets phones in landscape play', () => {
    expect(needsRotate({ w: 852, h: 393, coarse: true })).toBe(false);
    expect(needsRotate({ w: 915, h: 412, coarse: true })).toBe(false);
  });
  it('never blocks tablets or desktop', () => {
    expect(isPhone({ w: 768, h: 1024, coarse: true })).toBe(false);     // iPad portrait
    expect(needsRotate({ w: 768, h: 1024, coarse: true })).toBe(false);
    expect(needsRotate({ w: 500, h: 900, coarse: false })).toBe(false); // narrow desktop window (mouse)
  });
});
