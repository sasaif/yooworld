import { describe, it, expect } from 'vitest';
import { MOVE_DEFAULTS, newMoveState, stepMove, stepMoveWorld, type CamBasis } from '../src/game/movement/MovementController';
import { DEFAULT_WALK, RUN_SPEED, SMOOTH, WALK_PROFILES, readMoveProfile, stickConfig } from '../src/game/movement/walkProfile';
import { GAIT, STRIDE, gaitBlend, locoBlend } from '../src/game/movement/animBlend';
import { LOCO } from '../src/game/character/locomotion';

const CAM: CamBasis = { fx: 0, fz: -1, sinEl: 1 };
const run = (cfg: ReturnType<typeof stickConfig>, input: { x: number; y: number }, secs: number, fps = 60, st = newMoveState()) => {
  const out: { t: number; v: number; a: number }[] = []; let prev = 0;
  for (let i = 1; i <= Math.round(secs * fps); i++) { st = stepMove(st, input, CAM, 1 / fps, cfg); const v = Math.hypot(st.vx, st.vz); out.push({ t: i / fps, v, a: (v - prev) * fps }); prev = v; }
  return { st, out };
};

describe('walk profiles a / b / c', () => {
  it('are 15 / 22 / 30 % slower than the former full-stick speed, default b, run = former speed', () => {
    expect(WALK_PROFILES.a.speed).toBeCloseTo(1.9 * 0.85, 2); expect(WALK_PROFILES.b.speed).toBeCloseTo(1.9 * 0.78, 2); expect(WALK_PROFILES.c.speed).toBeCloseTo(1.9 * 0.7, 2);
    expect(DEFAULT_WALK).toBe('b'); expect(RUN_SPEED).toBe(MOVE_DEFAULTS.maxSpeed);
    const b = stickConfig(readMoveProfile(''), false); expect(b.maxSpeed).toBe(WALK_PROFILES.b.speed);
    expect(stickConfig(readMoveProfile('?walk=c'), false).maxSpeed).toBe(WALK_PROFILES.c.speed);
    expect(stickConfig(readMoveProfile('?walk=A'), false).maxSpeed).toBe(WALK_PROFILES.a.speed);
    expect(stickConfig(readMoveProfile('?walk=zz'), false).maxSpeed).toBe(WALK_PROFILES.b.speed);
    expect(stickConfig(readMoveProfile(''), true).maxSpeed).toBe(1.9);
  });
  it('?move=classic is exactly the former controller', () => {
    const c = stickConfig(readMoveProfile('?move=classic&walk=c'), false); expect(c).toEqual(MOVE_DEFAULTS); expect(c.smooth).toBeUndefined();
  });
  for (const k of ['a', 'b', 'c'] as const) it(`full stick reaches walk ${k} and never exceeds it`, () => {
    const cfg = stickConfig({ classic: false, walk: k }, false); const { out } = run(cfg, { x: 0, y: -1 }, 2);
    expect(Math.max(...out.map((o) => o.v))).toBeLessThanOrEqual(cfg.maxSpeed * 1.001 + 1e-9);
    expect(out[out.length - 1].v).toBeCloseTo(cfg.maxSpeed, 2);
  });
});

describe('progressive acceleration / deceleration (2nd-order)', () => {
  const cfg = stickConfig({ classic: false, walk: 'b' }, false); const T = cfg.maxSpeed;
  it('acceleration starts at 0 and ramps up (no jump), still half speed within 0.2 s', () => {
    const { out } = run(cfg, { x: 0, y: -1 }, 1);
    expect(out[0].a).toBeLessThan(0.25 * T * SMOOTH.accel); // classic: first frame ≈ 0.8·T·k
    expect(out[3].a).toBeGreaterThan(out[0].a); // jerk-limited: acceleration builds up
    const half = out.find((o) => o.v >= T / 2)!; expect(half.t).toBeLessThan(0.2);
    const t95 = out.find((o) => o.v >= 0.95 * T)!; expect(t95.t).toBeGreaterThan(0.35); expect(t95.t).toBeLessThan(0.6);
    // monotone, no overshoot
    for (let i = 1; i < out.length; i++) expect(out[i].v).toBeGreaterThanOrEqual(out[i - 1].v - 1e-9);
  });
  it('classic jumps much faster (reference)', () => {
    const { out } = run(stickConfig({ classic: true, walk: 'b' }, false), { x: 0, y: -1 }, 0.2);
    expect(out[0].a).toBeGreaterThan(0.5 * 1.9 * 14);
  });
  it('release eases to a full stop in ≈ 0.3–0.45 s without reversing', () => {
    const full = run(cfg, { x: 0, y: -1 }, 2).st; const { out, st } = run(cfg, { x: 0, y: 0 }, 1, 60, full);
    const stop = out.findIndex((o) => o.v === 0); expect(stop / 60).toBeGreaterThan(0.2); expect(stop / 60).toBeLessThan(0.5);
    for (let i = 1; i < out.length; i++) expect(out[i].v).toBeLessThanOrEqual(out[i - 1].v + 1e-9);
    expect(st.vx).toBe(0); expect(st.vz).toBe(0); expect(st.ax).toBe(0);
  });
  it('frame-rate independent: 20 fps and 120 fps land on the same position (< 1 mm) after 1 s', () => {
    const a = run(cfg, { x: 0.6, y: -0.8 }, 1, 20).st, b = run(cfg, { x: 0.6, y: -0.8 }, 1, 120).st;
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.001);
  });
  it('a 0.25 s hitch never teleports: displacement ≤ top speed × dt', () => {
    let st = run(cfg, { x: 0, y: -1 }, 1).st; const z0 = st.z; st = stepMoveWorld(st, { x: 0, z: -1 }, 1, 1.5, cfg);
    expect(Math.abs(st.z - z0)).toBeLessThanOrEqual(T * cfg.maxDt + 1e-6);
  });
});

describe('gait synced to the actual speed (measured stride speeds)', () => {
  const sc = 1.14, sW = STRIDE.walk * sc, sR = STRIDE.run * sc;
  for (const k of ['a', 'b', 'c'] as const) it(`full stick ${k}: run clip only, rate = speed / its stride speed`, () => {
    const v = WALK_PROFILES[k].speed; const bl = gaitBlend(v, sc);
    expect(bl.run).toBeGreaterThan(0.99); expect(bl.runTS * sR).toBeCloseTo(v, 5); expect(bl.runTS).toBeGreaterThanOrEqual(GAIT.runMinTS - 1e-9);
  });
  it('slow stick and walking paces (≤ 0.8 m/s): walk clip, rate = speed / its stride speed', () => {
    for (const v of [0.3, 0.57, 0.8]) { const bl = gaitBlend(v, sc); expect(bl.walk).toBeGreaterThan(0.95); expect(bl.walkTS * sW).toBeCloseTo(v, 5); }
  });
  it('weights always sum to 1 and rise monotonically into the run clip', () => {
    let prev = 0; for (let v = 0; v <= 2.2; v += 0.01) { const bl = gaitBlend(v, sc); expect(bl.idle + bl.walk + bl.run).toBeCloseTo(1, 9); expect(bl.run).toBeGreaterThanOrEqual(prev - 1e-12); prev = bl.run; }
  });
  it('classic blend (?move=classic) unchanged', () => {
    const vW = LOCO.walk * sc, vR = LOCO.run * sc; expect(locoBlend(1.9, vW, vR).run).toBeGreaterThan(0.9); expect(locoBlend(0.5, vW, vR).walkTS).toBeCloseTo(0.5 / vW, 9);
  });
});
