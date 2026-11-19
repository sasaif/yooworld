/**
 * Keeps an avatar's floating name tag (drei <Html>) out from under the HUD chips (top bar: name, wallet, place,
 * view, settings, 'Mode local'). Pure + unit-tested (tests/tag-avoid.test.ts). Screen CSS pixels, y down.
 * Bug fixed Nov 2026: on Yoo Plage Juan's "PNJ" tag slid under the top-right 'Mode local' chip.
 */
export interface Rect { l: number; t: number; r: number; b: number }
export const TAG_MARGIN = 4;
const hit = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
/** Downward shift (px, ≥ 0) that moves `tag` just below every obstacle it would overlap (obstacles = one HUD row,
 *  re-checked after each push so a taller chip further along is also cleared). */
export function avoidOffset(tag: Rect, obstacles: readonly Rect[], margin = TAG_MARGIN): number {
  let dy = 0;
  for (let k = 0; k < 4; k++) {
    const r = { l: tag.l, r: tag.r, t: tag.t + dy, b: tag.b + dy }; let push = 0;
    for (const o of obstacles) if (hit(r, { l: o.l - margin, r: o.r + margin, t: o.t, b: o.b + margin })) push = Math.max(push, o.b + margin - r.t);
    if (push <= 0) break; dy += push;
  }
  return dy;
}
/** HUD obstacle rects, re-measured at most every `ms` (layout reads stay off the per-frame path). */
const cache = { at: -1e9, rects: [] as Rect[] };
export function hudObstacles(now: number, ms = 500): Rect[] {
  if (now - cache.at < ms || typeof document === 'undefined') return cache.rects;
  cache.at = now; cache.rects = [...document.querySelectorAll('.hud-top .chip, .hud-top .net-pop')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }).filter((r) => r.r > r.l);
  return cache.rects;
}
