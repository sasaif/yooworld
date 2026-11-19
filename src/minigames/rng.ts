/**
 * Seeded, serializable RNG (mulberry32). The whole generator state is one 32-bit integer, so it can live inside a
 * game state object, survive JSON round trips and be replayed identically on a device or (later) on a server.
 * Pure: `next(state)` returns the value and the new state; nothing global, no Math.random().
 */
export function rngNext(state: number): [value: number, state: number] {
  const s = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, s];
}
/** Fisher–Yates shuffle driven by the serializable RNG; returns the shuffled copy and the new RNG state. */
export function shuffle<T>(items: readonly T[], state: number): [T[], number] {
  const a = items.slice(); let s = state;
  for (let i = a.length - 1; i > 0; i--) { const [r, n] = rngNext(s); s = n; const j = Math.floor(r * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return [a, s];
}
/** Stateful convenience wrapper (bots, tests): a `() => number` backed by the same generator. */
export function makeRng(seed: number): () => number {
  let s = seed | 0; return () => { const [v, n] = rngNext(s); s = n; return v; };
}
/** A fresh seed for a local table (the host owns the seed: the device in Local mode, the server later). */
export const newSeed = () => (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) | 0;
