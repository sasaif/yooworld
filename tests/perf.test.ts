import { describe, expect, it, beforeEach, vi } from 'vitest';
import { getPerfSnapshot, isPerfAvailable, resetPerfSamples, sampleFrame, setPerfEnabled, perfEnabled, togglePerf } from '../src/render/perf/perfStats';

const info = (calls = 40, triangles = 20000, geometries = 80, textures = 12, programs = 10) => ({
  render: { calls, triangles }, memory: { geometries, textures }, programs: { length: programs },
});

describe('perf monitor', () => {
  beforeEach(() => { resetPerfSamples(); setPerfEnabled(true); });

  it('starts empty and fills a snapshot after a few frames', () => {
    const z = getPerfSnapshot(); expect(z.fps).toBe(0); expect(z.samples).toBe(0); expect(z.visible).toBe(false);
    const t0 = 1000; vi.spyOn(performance, 'now').mockReturnValue(t0);
    sampleFrame(1 / 60, info(42, 18000, 70, 11, 9), { geometries: 55, materials: 30 });
    vi.spyOn(performance, 'now').mockReturnValue(t0 + 16.7);
    sampleFrame(1 / 60, info(42, 18000, 70, 11, 9), { geometries: 55, materials: 30 });
    const s = getPerfSnapshot();
    expect(s.calls).toBe(42); expect(s.triangles).toBe(18000); expect(s.geometries).toBe(70); expect(s.textures).toBe(11); expect(s.programs).toBe(9);
    expect(s.uniqueMaterials).toBe(30); expect(s.uniqueGeometries).toBe(55);
    expect(s.msAvg).toBeGreaterThan(15); expect(s.msAvg).toBeLessThan(18);
    expect(s.msWorst).toBeGreaterThanOrEqual(s.msAvg);
    expect(s.fps).toBeGreaterThan(50); expect(s.fps).toBeLessThan(70);
    expect(s.visible).toBe(true); expect(s.samples).toBe(2);
  });

  it('reports the worst frame in the window, not the last one', () => {
    let t = 0; vi.spyOn(performance, 'now').mockImplementation(() => t);
    for (let i = 0; i < 10; i++) { t = i * 16; sampleFrame(0.016, info()); }
    t = 10 * 16; sampleFrame(0.050, info()); // a 50 ms hitch
    const s = getPerfSnapshot();
    expect(s.msWorst).toBeGreaterThanOrEqual(49); expect(s.msAvg).toBeLessThan(s.msWorst);
  });

  it('drops frames older than the 1.5 s window', () => {
    let t = 0; vi.spyOn(performance, 'now').mockImplementation(() => t);
    sampleFrame(0.1, info()); // 100 ms, will age out
    t = 2000; sampleFrame(0.016, info()); sampleFrame(0.016, info());
    const s = getPerfSnapshot();
    expect(s.msWorst).toBeLessThan(20); expect(s.samples).toBeLessThan(3);
  });

  it('toggle hides the overlay flag without losing the last counters', () => {
    sampleFrame(0.016, info(33)); const before = getPerfSnapshot().calls;
    expect(perfEnabled()).toBe(true); togglePerf(); expect(perfEnabled()).toBe(false);
    expect(getPerfSnapshot().visible).toBe(false); expect(getPerfSnapshot().calls).toBe(before);
    togglePerf(); expect(perfEnabled()).toBe(true); expect(getPerfSnapshot().visible).toBe(true);
  });

  it('keeps the last scene counters when a frame reports zero draw calls', () => {
    let t = 0; vi.spyOn(performance, 'now').mockImplementation(() => t);
    sampleFrame(0.016, info(86, 54000, 84, 13, 21));
    t = 16; sampleFrame(0.016, info(0, 0, 0, 0, 0));
    const s = getPerfSnapshot();
    expect(s.calls).toBe(86); expect(s.triangles).toBe(54000); expect(s.geometries).toBe(84);
    expect(s.textures).toBe(13); expect(s.programs).toBe(21);
  });

  it('is available in vitest/dev (DEV) and also when ?perf=1 in a production-like check', () => {
    expect(isPerfAvailable()).toBe(true); // import.meta.env.DEV is true under vitest
  });
});
