/** Dev / ?perf=1 performance monitor: FPS window, renderer.info snapshot, toggle. Zero work unless the collector is mounted. */
export type PerfSnapshot = {
  fps: number;
  msAvg: number;
  msWorst: number;
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  programs: number;
  uniqueGeometries: number;
  uniqueMaterials: number;
  visible: boolean;
  samples: number;
};

const WINDOW_MS = 1500;
const CAP = 240;
const stamp = new Float64Array(CAP);
const msArr = new Float64Array(CAP);
let w = 0, n = 0;

const empty = (): PerfSnapshot => ({ fps: 0, msAvg: 0, msWorst: 0, calls: 0, triangles: 0, geometries: 0, textures: 0, programs: 0, uniqueGeometries: 0, uniqueMaterials: 0, visible: false, samples: 0 });
let snap: PerfSnapshot = empty();
let lowSince = 0;
let warned = 0;

export type RendererInfo = {
  render: { calls: number; triangles: number };
  memory: { geometries: number; textures: number };
  programs?: { length: number } | null;
};

const rnd = (v: number, d = 1) => Math.round(v * (10 ** d)) / (10 ** d);

/** Record one frame. `dt` is seconds (R3F useFrame). No heap allocations. */
export function sampleFrame(dt: number, info: RendererInfo, uniques?: { geometries: number; materials: number }) {
  const now = (typeof performance !== 'undefined' ? performance.now() : 0);
  const ms = Math.max(0, dt * 1000);
  stamp[w] = now; msArr[w] = ms; w = (w + 1) % CAP; if (n < CAP) n++;
  let sum = 0, worst = 0, k = 0, oldest = now;
  for (let i = 0; i < n; i++) {
    const idx = (w - 1 - i + CAP) % CAP;
    if (now - stamp[idx] > WINDOW_MS) break;
    sum += msArr[idx]; if (msArr[idx] > worst) worst = msArr[idx]; k++; oldest = stamp[idx];
  }
  const span = Math.max(1, now - oldest);
  const msAvg = k ? sum / k : 0;
  snap = {
    fps: k > 1 ? rnd((k - 1) * 1000 / span, 1) : (msAvg > 0 ? rnd(1000 / msAvg, 1) : 0),
    msAvg: rnd(msAvg, 2), msWorst: rnd(worst, 2),
    calls: info.render.calls, triangles: info.render.triangles,
    geometries: info.memory.geometries, textures: info.memory.textures,
    programs: info.programs?.length ?? 0,
    uniqueGeometries: uniques?.geometries ?? snap.uniqueGeometries,
    uniqueMaterials: uniques?.materials ?? snap.uniqueMaterials,
    visible: true, samples: k,
  };
  if (import.meta.env.DEV) maybeWarn(now, snap.fps);
}

function maybeWarn(now: number, fps: number) {
  if (fps >= 25 || n < 30) { lowSince = 0; return; }
  if (!lowSince) lowSince = now;
  if (now - lowSince < 3000) return;
  if (now - warned < 15000) return;
  warned = now; lowSince = now;
  console.warn(`[YooWorld perf] FPS stable sous 25 (${fps}) depuis plusieurs secondes — à surveiller (mode dev).`);
}

export function getPerfSnapshot(): PerfSnapshot { return snap; }
export function setPerfVisible(v: boolean) { snap = { ...snap, visible: v }; }
export function resetPerfSamples() { w = 0; n = 0; lowSince = 0; warned = 0; snap = empty(); }

/** True in Vite dev, or on a built/deployed page with ?perf=1. */
export function isPerfAvailable(): boolean {
  if (import.meta.env.DEV) return true;
  if (typeof location === 'undefined') return false;
  try { return new URLSearchParams(location.search).get('perf') === '1'; } catch { return false; }
}

type Sub = () => void;
const subs = new Set<Sub>();
let enabled = true;
export function perfEnabled() { return enabled; }
export function setPerfEnabled(v: boolean) { if (enabled === v) return; enabled = v; setPerfVisible(v); subs.forEach((s) => s()); }
export function togglePerf() { setPerfEnabled(!enabled); }
export function subscribePerf(fn: Sub) { subs.add(fn); return () => { subs.delete(fn); }; }

/** Install window.__perf() (and keep window.__info in sync when we have a snapshot). */
export function installPerfDebug() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as Record<string, unknown>;
  w.__perf = () => ({ ...getPerfSnapshot() });
}
