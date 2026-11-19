import { describe, it, expect } from 'vitest';
import { MOVE_DEFAULTS, newMoveState, stepMove, stepMoveWorld, type CamBasis, type MoveState } from '../src/game/movement/MovementController';
import { GAIT_POINTS, GAIT_SPEEDS, RUN_SPEED, SMOOTH, WALK_ANCHORS, parseSpeeds, readMoveProfile, stickConfig } from '../src/game/movement/walkProfile';
import { GAIT, STRIDE, gaitBlend, locoBlend, modeBlend } from '../src/game/movement/animBlend';
import { DEAD_ZONE, speedFactor } from '../src/game/movement/speedCurve';
import { LOCO } from '../src/game/character/locomotion';

const CAM: CamBasis = { fx: 0, fz: -1, sinEl: 1 };
const run = (cfg: ReturnType<typeof stickConfig>, input: { x: number; y: number }, secs: number, fps = 60, st: MoveState = newMoveState()) => {
  const out: { t: number; v: number; a: number }[] = []; let prev = Math.hypot(st.vx, st.vz);
  for (let i = 1; i <= Math.round(secs * fps); i++) { st = stepMove(st, input, CAM, 1 / fps, cfg); const v = Math.hypot(st.vx, st.vz); out.push({ t: i / fps, v, a: (v - prev) * fps }); prev = v; }
  return { st, out };
};
const P = readMoveProfile('');
const WALK = stickConfig(P, false), RUN = stickConfig(P, true);
const SC = 1.14; // avatar scale of the default view (V3)
const push = (d: number) => ({ x: 0, y: -d });

describe('joystick intensity → walking speed (mode-independent curve)', () => {
  it('default targets: slow 1.2 / normal 1.5 / fast 1.8 / run 2.8 m/s', () => {
    expect(GAIT_SPEEDS).toEqual({ slow: 1.2, normal: 1.5, fast: 1.8, run: 2.8 }); expect(RUN_SPEED).toBe(2.8);
    expect(WALK.maxSpeed).toBe(1.8); expect(RUN.maxSpeed).toBe(2.8); expect(WALK.anchors).toBe(WALK_ANCHORS); expect(RUN.anchors).toBe(WALK_ANCHORS);
  });
  it('25 % = slow walk 1.2, 60 % = normal walk 1.5, 95–100 % = fast walk 1.8 (Run off)', () => {
    const v = (d: number) => speedFactor(d, WALK.anchors) * WALK.maxSpeed;
    expect(v(GAIT_POINTS.slow)).toBeCloseTo(1.2, 6); expect(v(0.25)).toBeCloseTo(1.2, 6); expect(v(0.6)).toBeCloseTo(1.5, 6);
    expect(v(0.95)).toBeCloseTo(1.8, 6); expect(v(1)).toBeCloseTo(1.8, 6); expect(v(1.3)).toBeCloseTo(1.8, 6);
  });
  it('dead zone ≤ 10 %: no movement; NaN / negative safe', () => {
    for (const d of [0, 0.05, DEAD_ZONE, -1, NaN]) expect(speedFactor(d, WALK_ANCHORS)).toBe(0);
  });
  it('monotone and continuous: no step anywhere from the dead zone to full push, never above fast walk', () => {
    let prev = 0; for (let d = 0; d <= 1.0001; d += 0.001) { const v = speedFactor(d, WALK_ANCHORS) * 1.8; expect(v).toBeGreaterThanOrEqual(prev - 1e-12); expect(v - prev).toBeLessThan(0.02); expect(v).toBeLessThanOrEqual(1.8 + 1e-9); prev = v; }
  });
  it('Run on: the same intensity curve scaled to the run speed (2.8 at full push)', () => {
    expect(speedFactor(1, RUN.anchors) * RUN.maxSpeed).toBeCloseTo(2.8, 6); expect(speedFactor(0.6, RUN.anchors) * RUN.maxSpeed).toBeCloseTo(1.5 / 1.8 * 2.8, 6);
  });
  it('?speeds= overrides for tuning, invalid → defaults; ?move=classic is exactly the former controller', () => {
    expect(parseSpeeds('1,1.3,1.6,2.5')).toEqual({ slow: 1, normal: 1.3, fast: 1.6, run: 2.5 });
    for (const bad of [null, '', '1,2', '2,1,3,4', '1,1.3,1.6,9', 'a,b,c,d']) expect(parseSpeeds(bad)).toEqual(GAIT_SPEEDS);
    const t = readMoveProfile('?speeds=1,1.3,1.6,2.5'); const c = stickConfig(t, false); expect(c.maxSpeed).toBe(1.6); expect(speedFactor(0.25, c.anchors) * 1.6).toBeCloseTo(1, 6);
    const k = stickConfig(readMoveProfile('?move=classic'), false); expect(k).toEqual(MOVE_DEFAULTS); expect(k.smooth).toBeUndefined();
  });
});

describe('controller: speeds reached per test case (60 fps)', () => {
  const steady = (cfg: typeof WALK, d: number) => run(cfg, push(d), 2).out.at(-1)!.v;
  it('Run off: 25 % → 1.2, 60 % → 1.5, 100 % → 1.8 and never above', () => {
    expect(steady(WALK, 0.25)).toBeCloseTo(1.2, 2); expect(steady(WALK, 0.6)).toBeCloseTo(1.5, 2); expect(steady(WALK, 1)).toBeCloseTo(1.8, 2);
    expect(Math.max(...run(WALK, push(1), 3).out.map((o) => o.v))).toBeLessThanOrEqual(1.8 * 1.001 + 1e-9);
  });
  it('Run on, 100 % → 2.8', () => { expect(steady(RUN, 1)).toBeCloseTo(2.8, 2); });
  it('Run on → off while moving at full push: eases down to 1.8 within 0.4 s, deceleration ≤ 8 m/s², no frame jump > 0.12 m/s, never below 1.8', () => {
    const fast = run(RUN, push(1), 2).st; const { out } = run(WALK, push(1), 1, 60, fast);
    expect(out[0].v).toBeGreaterThan(2.7); // continuous: no instant drop
    expect(Math.max(...out.map((o) => -o.a))).toBeLessThan(8);
    expect(out.find((o) => o.v <= 1.8 * 1.02)!.t).toBeLessThan(0.4);
    for (const o of out) expect(o.v).toBeGreaterThanOrEqual(1.8 - 1e-6);
    let pv = 2.8; for (const o of out) { expect(Math.abs(o.v - pv)).toBeLessThan(0.12); pv = o.v; }
  });
  it('Run off → on while moving: eases up to 2.8, no jump', () => {
    const w = run(WALK, push(1), 2).st; const { out } = run(RUN, push(1), 1.5, 60, w);
    let pv = 1.8; for (const o of out) { expect(o.v - pv).toBeLessThan(0.12); expect(o.v).toBeGreaterThanOrEqual(pv - 1e-9); pv = o.v; } expect(out.at(-1)!.v).toBeCloseTo(2.8, 2);
  });
  it('start: acceleration ramps up from 0 (half speed < 0.2 s, 95 % in 0.35–0.6 s), monotone', () => {
    const { out } = run(WALK, push(1), 1); const T = 1.8;
    expect(out[0].a).toBeLessThan(0.25 * T * SMOOTH.accel); expect(out[3].a).toBeGreaterThan(out[0].a);
    expect(out.find((o) => o.v >= T / 2)!.t).toBeLessThan(0.2); const t95 = out.find((o) => o.v >= 0.95 * T)!.t; expect(t95).toBeGreaterThan(0.35); expect(t95).toBeLessThan(0.6);
    for (let i = 1; i < out.length; i++) expect(out[i].v).toBeGreaterThanOrEqual(out[i - 1].v - 1e-9);
  });
  it('release (walk and run): eases to a full stop in 0.2–0.5 s, never reverses', () => {
    for (const cfg of [WALK, RUN]) {
      const full = run(cfg, push(1), 2).st; const { out, st } = run(cfg, { x: 0, y: 0 }, 1, 60, full);
      const stop = out.findIndex((o) => o.v === 0); expect(stop / 60).toBeGreaterThan(0.2); expect(stop / 60).toBeLessThan(0.5);
      for (let i = 1; i < out.length; i++) expect(out[i].v).toBeLessThanOrEqual(out[i - 1].v + 1e-9);
      expect(st.vx).toBe(0); expect(st.vz).toBe(0); expect(st.ax).toBe(0);
    }
  });
  it('frame-rate independent (20 vs 120 fps < 1 mm after 1 s); a 0.25 s hitch never teleports', () => {
    const a = run(WALK, { x: 0.6, y: -0.8 }, 1, 20).st, b = run(WALK, { x: 0.6, y: -0.8 }, 1, 120).st; expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.001);
    let st = run(WALK, push(1), 1).st; const z0 = st.z; st = stepMoveWorld(st, { x: 0, z: -1 }, 1, 1.5, WALK); expect(Math.abs(st.z - z0)).toBeLessThanOrEqual(1.8 * WALK.maxDt + 1e-6);
  });
});

describe('animation: mode decides the clips, speed decides weights and rates', () => {
  const sW = STRIDE.walk * SC, sR = STRIDE.run * SC;
  it('walk mode: the run clip weight is 0 at EVERY speed (0 → 3.5 m/s), walk rate = speed / stride (feet planted) up to fast walk', () => {
    for (let v = 0; v <= 3.5; v += 0.01) { const b = modeBlend(v, SC, 'walk'); expect(b.run).toBe(0); expect(b.idle + b.walk).toBeCloseTo(1, 9); }
    for (const v of [0.3, 1.2, 1.5, 1.8]) { const b = modeBlend(v, SC, 'walk'); expect(b.walk).toBeGreaterThan(0.99); expect(b.walkTS * sW).toBeCloseTo(v, 6); }
    expect(1.8 / sW).toBeLessThan(GAIT.walkMaxTS);
  });
  it('run mode at full push (2.8 m/s): run clip only, rate = speed / run stride (no slide)', () => {
    const b = modeBlend(2.8, SC, 'run'); expect(b.run).toBeGreaterThan(0.999); expect(b.runTS * sR).toBeCloseTo(2.8, 6);
  });
  it('run mode: weights sum to 1, rise monotonically into the run clip; slow run-mode speeds still use the walk clip', () => {
    let prev = 0; for (let v = 0; v <= 3.2; v += 0.01) { const b = modeBlend(v, SC, 'run'); expect(b.idle + b.walk + b.run).toBeCloseTo(1, 9); expect(b.run).toBeGreaterThanOrEqual(prev - 1e-12); prev = b.run; }
    expect(modeBlend(0.5, SC, 'run').walk).toBeGreaterThan(0.99);
  });
  it('root cause (reference): the former speed-only blend played the RUN clip at full walk speed with Run off', () => {
    expect(gaitBlend(1.482, SC).run).toBeGreaterThan(0.99); expect(gaitBlend(1.8, SC).run).toBeGreaterThan(0.99);
    expect(modeBlend(1.482, SC, 'walk').run).toBe(0);
  });
  it('classic blend (?move=classic) unchanged', () => {
    const vW = LOCO.walk * SC, vR = LOCO.run * SC; expect(locoBlend(1.9, vW, vR).run).toBeGreaterThan(0.9); expect(locoBlend(0.5, vW, vR).walkTS).toBeCloseTo(0.5 / vW, 9);
  });
});
