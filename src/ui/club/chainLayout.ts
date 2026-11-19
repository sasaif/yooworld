/**
 * Domino line layout for the table overlay (pure, unit-tested). The line keeps a readable tile size on phones
 * (never below `min` px per half-tile) and wraps as a snake instead of shrinking: row 0 runs left → right, row 1
 * right → left (tiles drawn flipped so that touching halves still match), row 2 left → right…
 * Doubles stand across the line (1 unit wide, 2 tall); other tiles lie along it (2 units wide).
 */
export interface ChainTile { a: number; b: number }
export interface ChainCell { idx: number; a: number; b: number; double: boolean }
export interface ChainRow { reverse: boolean; cells: ChainCell[]; width: number }
export interface ChainLayout { size: number; rows: ChainRow[]; width: number; height: number; fits: boolean }
export interface ChainOpts { max?: number; min?: number; /** first try to keep at least this size, wrapping into more rows */ pref?: number; gap?: number; maxRows?: number; rowGap?: number }
const units = (t: ChainTile) => (t.a === t.b ? 1 : 2);
function split(line: readonly ChainTile[], width: number, size: number, gap: number): ChainTile[][] {
  const rows: ChainTile[][] = []; let cur: ChainTile[] = []; let w = 0;
  for (const t of line) {
    const tw = units(t) * size; const nw = cur.length ? w + gap + tw : tw;
    if (cur.length && nw > width) { rows.push(cur); cur = [t]; w = tw; } else { cur.push(t); w = nw; }
  }
  if (cur.length) rows.push(cur);
  return rows;
}
export function chainLayout(line: readonly ChainTile[], width: number, o: ChainOpts = {}): ChainLayout {
  const max = o.max ?? 22, min = o.min ?? 16, gap = o.gap ?? 2, maxRows = o.maxRows ?? 3, rowGap = o.rowGap ?? 4;
  const build = (size: number, rows: ChainTile[][], fits: boolean): ChainLayout => {
    let k = 0;
    const out = rows.map((r, i) => {
      const reverse = i % 2 === 1;
      const cells = r.map((t) => ({ idx: k++, a: reverse ? t.b : t.a, b: reverse ? t.a : t.b, double: t.a === t.b }));
      return { reverse, cells, width: r.reduce((n, t) => n + units(t) * size, 0) + Math.max(0, r.length - 1) * gap };
    });
    const height = out.reduce((n, r) => n + (r.cells.some((c) => c.double) ? 2 : 1) * size, 0) + Math.max(0, out.length - 1) * rowGap;
    return { size, rows: out, width: Math.max(0, ...out.map((r) => r.width)), height, fits };
  };
  if (!line.length) return { size: max, rows: [], width: 0, height: 0, fits: true };
  const pref = Math.max(min, Math.min(max, o.pref ?? 18));
  for (let rows = 1; rows <= maxRows; rows++) for (let s = max; s >= pref; s--) { const r = split(line, width, s, gap); if (r.length <= rows) return build(s, r, true); }
  for (let s = pref - 1; s >= min; s--) { const r = split(line, width, s, gap); if (r.length <= maxRows) return build(s, r, true); }
  // too long even at the minimum size: keep `min` and let the strip scroll (never shrink below a readable size)
  return build(min, split(line, width, min, gap), false);
}
