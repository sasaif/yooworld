import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getDrawStats, installDrawCounter, type CountableRenderer } from '../src/render/perf/drawCounter';
import { getPerfSnapshot, resetPerfSamples, sampleFrame, setPerfEnabled } from '../src/render/perf/perfStats';

/** A fake renderer that behaves like three r170's WebGLRenderer.render(): shadow pass first, then
 *  `if (info.autoReset) info.reset()`, then the main pass. That ordering is what used to hide the shadow draws. */
function fakeRenderer(shadowDraws: number, mainDraws: number, triPerDraw = 100) {
  const info = { autoReset: true, render: { calls: 0, triangles: 0 }, reset() { this.render.calls = 0; this.render.triangles = 0; } };
  const draw = (n: number) => { info.render.calls += n; info.render.triangles += n * triPerDraw; };
  const gl = {
    info,
    shadowMap: { render: vi.fn(() => draw(shadowDraws)) },
    render: vi.fn(function (this: typeof gl) { this.shadowMap.render(); if (info.autoReset) info.reset(); draw(mainDraws); }),
  };
  return gl;
}

describe('draw-call accounting (shadow pass included)', () => {
  beforeEach(() => { resetPerfSamples(); setPerfEnabled(true); });

  it('reproduces the bug: three-style autoReset drops the shadow pass from renderer.info', () => {
    const gl = fakeRenderer(67, 87); gl.render();
    expect(gl.info.render.calls).toBe(87); // 67 shadow-map draws are lost
  });

  it('counts main + shadow passes separately and exposes the real total (apartment: 87 + 67 = 154)', () => {
    const gl = fakeRenderer(67, 87); const off = installDrawCounter(gl as unknown as CountableRenderer);
    gl.render(); gl.render();
    const d = getDrawStats(gl);
    expect(d).toMatchObject({ calls: 154, callsMain: 87, callsShadow: 67, triangles: 15400, trianglesShadow: 6700, trianglesMain: 8700, frames: 2 });
    expect(gl.info.render.calls).toBe(154); // renderer.info itself now holds the honest total after a frame
    expect(gl.info.autoReset).toBe(false);
    off();
  });

  it('resets once per frame (no accumulation across frames) and keeps working when there is no shadow pass', () => {
    const gl = fakeRenderer(0, 21); const off = installDrawCounter(gl as unknown as CountableRenderer);
    for (let i = 0; i < 5; i++) gl.render();
    expect(getDrawStats(gl)).toMatchObject({ calls: 21, callsMain: 21, callsShadow: 0, frames: 5 });
    off();
  });

  it('is idempotent and the uninstall restores the original renderer behaviour', () => {
    const gl = fakeRenderer(10, 21); const r0 = gl.render, s0 = gl.shadowMap.render;
    const off = installDrawCounter(gl as unknown as CountableRenderer); const again = installDrawCounter(gl as unknown as CountableRenderer);
    gl.render(); expect(getDrawStats(gl).calls).toBe(31); // wrapped once, not twice
    again(); off();
    expect(gl.render).toBe(r0); expect(gl.shadowMap.render).toBe(s0); expect(gl.info.autoReset).toBe(true);
    gl.render(); expect(gl.info.render.calls).toBe(21); // back to three's own (shadow-less) counter
  });

  it('the perf snapshot (overlay, window.__perf) reports total, main and shadow, never main alone', () => {
    const gl = fakeRenderer(67, 87); const off = installDrawCounter(gl as unknown as CountableRenderer); gl.render();
    let t = 0; vi.spyOn(performance, 'now').mockImplementation(() => t);
    const info = { render: gl.info.render, memory: { geometries: 85, textures: 13 }, programs: { length: 22 } };
    sampleFrame(0.016, info, undefined, getDrawStats(gl)); t = 16; sampleFrame(0.016, info, undefined, getDrawStats(gl));
    const s = getPerfSnapshot();
    expect(s.calls).toBe(154); expect(s.callsMain).toBe(87); expect(s.callsShadow).toBe(67); expect(s.calls).toBe(s.callsMain + s.callsShadow);
    expect(s.calls).toBeGreaterThan(120); // the docs/10 apartment budget (120) is honestly reported as exceeded
    off();
  });
});
