/**
 * Exact draw-call accounting, shadow pass included.
 *
 * three r170 resets `renderer.info` *after* rendering the shadow maps (WebGLRenderer.render: `shadowMap.render(...)`
 * then `if (info.autoReset) info.reset()`), so `info.render.calls` only holds the main pass: every shadow-map draw is lost.
 * Here we take over the reset: `info.autoReset = false`, reset once at the start of each `renderer.render()`, and
 * measure the shadow pass by wrapping `shadowMap.render`. After a frame, `info.render.calls` is the real total
 * (main + shadow) and `getDrawStats()` gives the split. No allocation per frame; the cost is two wrapped calls.
 */
export type DrawStats = {
  /** total draw calls of the last rendered frame (main pass + shadow pass) */
  calls: number; callsMain: number; callsShadow: number;
  triangles: number; trianglesMain: number; trianglesShadow: number;
  /** renderer.render() calls seen (frames) */
  frames: number;
};

export type CountableRenderer = {
  info: { autoReset: boolean; reset(): void; render: { calls: number; triangles: number } };
  shadowMap: { render: (...a: never[]) => unknown };
  render: (...a: never[]) => unknown;
};

const zero = (): DrawStats => ({ calls: 0, callsMain: 0, callsShadow: 0, triangles: 0, trianglesMain: 0, trianglesShadow: 0, frames: 0 });
const stats = new WeakMap<object, DrawStats>();
let lastStats: DrawStats = zero();

/** Install the counter on a renderer (idempotent). Returns an uninstall function restoring the original behaviour. */
export function installDrawCounter(gl: CountableRenderer): () => void {
  if (stats.has(gl)) return () => {};
  const st = zero(); stats.set(gl, st); lastStats = st;
  const info = gl.info; const prevAuto = info.autoReset; info.autoReset = false;
  const sm = gl.shadowMap; const smRender = sm.render; const glRender = gl.render;
  let sc = 0, stri = 0;
  sm.render = function (this: unknown, ...a: never[]) {
    const c0 = info.render.calls, t0 = info.render.triangles; const r = smRender.apply(this, a);
    sc += info.render.calls - c0; stri += info.render.triangles - t0; return r;
  };
  gl.render = function (this: unknown, ...a: never[]) {
    info.reset(); sc = 0; stri = 0;
    const r = glRender.apply(this, a);
    const calls = info.render.calls, tri = info.render.triangles;
    st.calls = calls; st.callsShadow = sc; st.callsMain = calls - sc;
    st.triangles = tri; st.trianglesShadow = stri; st.trianglesMain = tri - stri; st.frames++;
    return r;
  };
  return () => {
    if (sm.render !== smRender) sm.render = smRender;
    if (gl.render !== glRender) gl.render = glRender;
    info.autoReset = prevAuto; stats.delete(gl);
  };
}

/** Last frame's counters for `gl` (or for the most recently installed renderer). */
export function getDrawStats(gl?: object): DrawStats { return (gl && stats.get(gl)) || lastStats; }
