/**
 * Joystick displacement → speed factor (0..1). Pure + unit-tested.
 *
 * Owner's speed levels (displacement d = thumb distance / max radius):
 *   0–10 % dead zone (0) · 10–35 % slow ≈30 % · 35–65 % normal ≈60 % · 65–90 % fast ≈85 % · 90–100 % max 100 %
 * The curve passes exactly through each level's value at the centre of its band and is a monotone cubic
 * (Fritsch–Carlson / PCHIP) between those anchors, so speed rises progressively with no step anywhere
 * (C¹-continuous, never decreasing). Anchors are configurable.
 */
export type Anchor = readonly [d: number, factor: number];
export const DEAD_ZONE = 0.10;
export const SPEED_BANDS = [
  { name: 'dead', from: 0, to: 0.10, target: 0 },
  { name: 'slow', from: 0.10, to: 0.35, target: 0.30 },
  { name: 'normal', from: 0.35, to: 0.65, target: 0.60 },
  { name: 'fast', from: 0.65, to: 0.90, target: 0.85 },
  { name: 'max', from: 0.90, to: 1.0, target: 1.0 },
] as const;
/** (dead-zone edge, 0) → band centres → full speed reached at 95 % and held to 100 %. */
export const DEFAULT_ANCHORS: readonly Anchor[] = [[DEAD_ZONE, 0], [0.225, 0.30], [0.50, 0.60], [0.775, 0.85], [0.95, 1], [1, 1]];

/** Monotone cubic Hermite slopes (Fritsch–Carlson). */
function slopes(a: readonly Anchor[]) {
  const n = a.length, h: number[] = [], s: number[] = [], m = new Array<number>(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = a[i + 1][0] - a[i][0]; s[i] = (a[i + 1][1] - a[i][1]) / h[i]; }
  m[0] = s[0]; m[n - 1] = s[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = s[i - 1] * s[i] <= 0 ? 0 : (3 * (h[i - 1] + h[i])) / ((2 * h[i] + h[i - 1]) / s[i - 1] + (h[i] + 2 * h[i - 1]) / s[i]);
  // the dead-zone edge starts from rest: zero slope there so the very first millimetres are gentle
  m[0] = 0;
  for (let i = 0; i < n - 1; i++) {
    if (s[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const al = m[i] / s[i], be = m[i + 1] / s[i], r = al * al + be * be;
    if (r > 9) { const t = 3 / Math.sqrt(r); m[i] = t * al * s[i]; m[i + 1] = t * be * s[i]; }
  }
  return m;
}
const cache = new WeakMap<readonly Anchor[], number[]>();

export function speedFactor(d: number, anchors: readonly Anchor[] = DEFAULT_ANCHORS): number {
  if (!(d > anchors[0][0])) return 0; // includes NaN
  const last = anchors[anchors.length - 1]; if (d >= last[0]) return last[1];
  let m = cache.get(anchors); if (!m) { m = slopes(anchors); cache.set(anchors, m); }
  let i = 0; while (d > anchors[i + 1][0]) i++;
  const [x0, y0] = anchors[i], [x1, y1] = anchors[i + 1], h = x1 - x0, t = (d - x0) / h, t2 = t * t, t3 = t2 * t;
  const v = (2 * t3 - 3 * t2 + 1) * y0 + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * y1 + (t3 - t2) * h * m[i + 1];
  return Math.min(1, Math.max(0, v));
}
export function bandOf(d: number) { return SPEED_BANDS.find((b) => d < b.to) ?? SPEED_BANDS[SPEED_BANDS.length - 1]; }
