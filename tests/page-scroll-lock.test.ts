import { afterEach, describe, expect, it } from 'vitest';
import { resetPageScroll } from '../src/app/viewportFill';

/** iOS keyboard bug (uat@6d524ad): Safari scrolled the page when the chat field got the focus; the game puts it back. */
const g = globalThis as Record<string, unknown>;
afterEach(() => { delete g.window; delete g.document; });
function fakePage(sy: number, st: number) {
  const calls: number[][] = [];
  const el = (top: number) => ({ scrollTop: top, scrollLeft: 0 });
  const html = el(st), body = el(0);
  g.window = { scrollX: 0, scrollY: sy, scrollTo: (x: number, y: number) => { calls.push([x, y]); (g.window as { scrollY: number }).scrollY = y; } };
  g.document = { scrollingElement: html, documentElement: html, body };
  return { calls, html, body };
}
describe('page scroll lock (resetPageScroll)', () => {
  it('puts a scrolled page back at 0,0 (window + scrolling element)', () => {
    const f = fakePage(140, 140);
    expect(resetPageScroll()).toBe(true);
    expect(f.calls).toEqual([[0, 0]]); expect((g.window as { scrollY: number }).scrollY).toBe(0); expect(f.html.scrollTop).toBe(0);
  });
  it('does nothing on a page already at 0 (no scroll call, returns false)', () => {
    const f = fakePage(0, 0);
    expect(resetPageScroll()).toBe(false); expect(f.calls).toEqual([]);
  });
  it('also resets a body that scrolled on its own', () => {
    const f = fakePage(0, 0); f.body.scrollTop = 30;
    expect(resetPageScroll()).toBe(true); expect(f.body.scrollTop).toBe(0);
  });
  it('is a no-op without a DOM (SSR / unit tests)', () => { expect(resetPageScroll()).toBe(false); });
});
