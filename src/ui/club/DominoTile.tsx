/** One domino drawn in SVG (pips by code, no image asset). `vertical` for doubles across the line and for the hand. */
const P: Record<number, [number, number][]> = {
  0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};
export function DominoTile({ a, b, size, vertical = false, dim = false, hi = false }: { a: number; b: number; size: number; vertical?: boolean; dim?: boolean; hi?: boolean }) {
  const half = (v: number, cx: number, cy: number) => P[v].map(([x, y], i) => <circle key={i} cx={cx + (vertical ? x : y) * 0.27} cy={cy + (vertical ? y : x) * 0.27} r={0.1} />);
  const W = vertical ? 1 : 2, H = vertical ? 2 : 1;
  return (
    <svg className={'dtile' + (dim ? ' dim' : '') + (hi ? ' hi' : '')} width={size * W} height={size * H} viewBox={`0 0 ${W} ${H}`} aria-label={`${a}-${b}`}>
      <rect x={0.03} y={0.03} width={W - 0.06} height={H - 0.06} rx={0.14} className="dtile-face" />
      {vertical ? <line x1={0.18} y1={1} x2={0.82} y2={1} className="dtile-bar" /> : <line x1={1} y1={0.18} x2={1} y2={0.82} className="dtile-bar" />}
      <g className="dtile-pips">{vertical ? <>{half(a, 0.5, 0.5)}{half(b, 0.5, 1.5)}</> : <>{half(a, 0.5, 0.5)}{half(b, 1.5, 0.5)}</>}</g>
    </svg>
  );
}
