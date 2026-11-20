/** Pure de-overlap maths for the speech bubbles (unit-tested in tests/bubble-stack.test.ts). */
export interface Box { l: number; t: number; r: number; b: number; owner?: string }
export interface StackItem { id: string; box: Box; self: boolean }
/** Pure: per-bubble offsets {dx, dy} (px) so that no two bubbles overlap each other nor the fixed HUD / name tags
 *  (`obstacles`), staying inside the viewport. Own bubble first, then lower on screen (= nearer the camera) is placed
 *  first; each next one takes the smallest move (lifting is preferred to a side step, a drop below is the last resort).
 *  `prev` (last offsets) makes it sticky: a still-valid previous spot is kept unless the bubble's own spot is free. */
export function stackOffsets(items: StackItem[], obstacles: Box[] = [], vp?: { w: number; h: number }, pad = 4, maxMove = 150, prev?: ReadonlyMap<string, { dx: number; dy: number }>): Map<string, { dx: number; dy: number; stuck?: boolean }> {
  const order = [...items].sort((a, b) => Number(b.self) - Number(a.self) || b.box.b - a.box.b || (a.id < b.id ? -1 : 1));
  const placed: Box[] = []; const out = new Map<string, { dx: number; dy: number; stuck?: boolean }>();
  const hits = (x: Box, list: Box[]) => list.some((p) => x.l < p.r + pad && x.r > p.l - pad && x.t < p.b + pad && x.b > p.t - pad);
  for (const it of order) {
    const B = it.box; const blockers = [...placed, ...obstacles.filter((o) => o.owner !== it.id)];
    const own = obstacles.filter((o) => o.owner === it.id); // its own name tag: only in the way when moving down
    const dys = new Set([0]), dxs = new Set([0]);
    for (const p of blockers) { dys.add(p.t - pad - B.b); dys.add(p.b + pad - B.t); dxs.add(p.l - pad - B.r); dxs.add(p.r + pad - B.l); }
    let best: { dx: number; dy: number; cost: number } | null = null;
    // stability: a bubble keeps its previous offset while that spot is still free (no jumping between equal solutions
    // from one tick to the next, so its slide transition can finish)
    const pv = prev?.get(it.id);
    if (pv && (pv.dx || pv.dy)) {
      const x = { l: B.l + pv.dx, r: B.r + pv.dx, t: B.t + pv.dy, b: B.b + pv.dy };
      const inVp = !vp || (x.l >= 0 && x.r <= vp.w && x.t >= 0 && x.b <= vp.h);
      const cost0 = hits(B, blockers) ? Infinity : 0; // its own spot is free again: go back home
      if (inVp && cost0 > 0 && !hits(x, blockers) && !(pv.dy > 0 && hits(x, own))) best = { dx: pv.dx, dy: pv.dy, cost: -1 };
    }
    if (!best) for (const dy of dys) for (const dx of dxs) {
      if (Math.abs(dx) > maxMove * 1.35 || Math.abs(dy) > maxMove) continue;
      const cost = (dy <= 0 ? -dy : dy * 2.5) + Math.abs(dx) * 1.3;
      if (best && cost >= best.cost) continue;
      const x = { l: B.l + dx, r: B.r + dx, t: B.t + dy, b: B.b + dy };
      if (vp && (x.l < 0 || x.r > vp.w || x.t < 0 || x.b > vp.h)) continue;
      if (hits(x, blockers) || (dy > 0 && hits(x, own))) continue;
      best = { dx, dy, cost };
    }
    // no free spot: stays on its speaker and is flagged `stuck` (the layer squeezes it to one short line)
    const o = best ?? { dx: 0, dy: 0 };
    out.set(it.id, { dx: o.dx, dy: o.dy, stuck: !best }); placed.push({ l: B.l + o.dx, r: B.r + o.dx, t: B.t + o.dy, b: B.b + o.dy });
  }
  return out;
}

