/** Pure overlap solver for the map's UI layer (badges, pins, "Toi"): no DOM, unit-tested.
 *  Each item is placed in order; it must stay inside the view (margin m) and must not intersect the fixed UI
 *  (title, ✕, back / tabs, card strip) nor any item placed before it. Smallest move wins. */
export type Box = { x: number; y: number; w: number; h: number };
export type Nudge = { dx: number; dy: number };

export const intersects = (a: Box, b: Box, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
export const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const shift = (b: Box, n: Nudge): Box => ({ ...b, x: b.x + n.dx, y: b.y + n.dy });

export function placeBoxes(items: Box[], obstacles: Box[], view: { w: number; h: number }, m = 6): Nudge[] {
  const placed: Box[] = [...obstacles];
  const out: Nudge[] = [];
  const clamp = (b: Box, n: Nudge): Nudge => {
    const x = Math.min(Math.max(b.x + n.dx, m), Math.max(m, view.w - m - b.w));
    const y = Math.min(Math.max(b.y + n.dy, m), Math.max(m, view.h - m - b.h));
    return { dx: x - b.x, dy: y - b.y };
  };
  const cost = (b: Box, n: Nudge) => placed.reduce((s, o) => s + (intersects(shift(b, n), o, m - 1) ? overlapArea(shift(b, n), o) + 1 : 0), 0);
  const escapes = (b: Box, n: Nudge): Nudge[] => {
    const c = shift(b, n), r: Nudge[] = [];
    for (const o of placed) {
      if (!intersects(c, o, m - 1)) continue;
      r.push({ dx: o.x - m - (b.x + b.w), dy: n.dy }, { dx: o.x + o.w + m - b.x, dy: n.dy },
        { dx: n.dx, dy: o.y - m - (b.y + b.h) }, { dx: n.dx, dy: o.y + o.h + m - b.y });
    }
    return r.map((e) => clamp(b, e));
  };
  for (const b of items) {
    const start = clamp(b, { dx: 0, dy: 0 });
    let best = start, bestCost = cost(b, start);
    if (bestCost > 0) {
      let frontier = [start];
      for (let round = 0; round < 3 && bestCost > 0; round++) {
        const next: Nudge[] = [];
        for (const f of frontier) for (const e of escapes(b, f)) {
          const c = cost(b, e), d = Math.hypot(e.dx, e.dy), bd = Math.hypot(best.dx, best.dy);
          if (c < bestCost || (c === bestCost && d < bd)) { best = e; bestCost = c; }
          next.push(e);
        }
        // among collision-free candidates keep the shortest move
        const free = next.filter((e) => cost(b, e) === 0).sort((a, z) => Math.hypot(a.dx, a.dy) - Math.hypot(z.dx, z.dy));
        if (free.length) { best = free[0]; bestCost = 0; }
        frontier = next.slice(0, 64);
      }
    }
    out.push({ dx: Math.round(best.dx), dy: Math.round(best.dy) });
    placed.push(shift(b, best));
  }
  return out;
}
