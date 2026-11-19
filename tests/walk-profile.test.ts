import { describe, it, expect } from 'vitest';
import { MOVE_DEFAULTS, newMoveState, stepMove, stepMoveWorld, type CamBasis, type MoveState } from '../src/game/movement/MovementController';
import { FULL_FROM, GAIT_ANCHORS, GAIT_SPEEDS, RUN_SPEED, SMOOTH, WALK_SPEED, parseSpeeds, readMoveProfile, stickConfig } from '../src/game/movement/walkProfile';
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

describe('joystick intensity → one walk speed, or run (same ramp-then-hold curve)', () => {
  it('default targets: walk 1.2 / run 2.8 m/s; full speed from 25 % stick', () => {
    expect(GAIT_SPEEDS).toEqual({ walk: 1.2, run: 2.8 }); expect(WALK_SPEED).toBe(1.2); expect(RUN_SPEED).toBe(2.8);
    expect(WALK.maxSpeed).toBe(1.2); expect(RUN.maxSpeed).toBe(2.8); expect(FULL_FROM).toBe(0.25);
    expect(WALK.anchors).toBe(GAIT_ANCHORS); expect(RUN.anchors).toBe(GAIT_ANCHORS);
  });
  it('Run off: 25 / 60 / 100 % (and past the rim) all = the single walk 1.2 m/s', () => {
    const v = (d: number) => speedFactor(d, WALK.anchors) * WALK.maxSpeed;
    expect(v(FULL_FROM)).toBeCloseTo(1.2, 6); expect(v(0.25)).toBeCloseTo(1.2, 6); expect(v(0.6)).toBeCloseTo(1.2, 6);
    expect(v(0.95)).toBeCloseTo(1.2, 6); expect(v(1)).toBeCloseTo(1.2, 6); expect(v(1.3)).toBeCloseTo(1.2, 6);
  });
  it('dead zone ≤ 10 %: no movement; NaN / negative safe', () => {
    for (const d of [0, 0.05, DEAD_ZONE, -1, NaN]) expect(speedFactor(d, GAIT_ANCHORS)).toBe(0);
  });
  it('short ramp after the dead zone is monotone and continuous; then holds, never above 1.2', () => {
    let prev = 0; for (let d = 0; d <= 1.0001; d += 0.001) { const v = speedFactor(d, GAIT_ANCHORS) * 1.2; expect(v).toBeGreaterThanOrEqual(prev - 1e-12); expect(v - prev).toBeLessThan(0.04); expect(v).toBeLessThanOrEqual(1.2 + 1e-9); prev = v; }
    expect(speedFactor(0.15, GAIT_ANCHORS) * 1.2).toBeGreaterThan(0); expect(speedFactor(0.15, GAIT_ANCHORS) * 1.2).toBeLessThan(1.2);
  });
  it('Run on: the same ramp-then-hold curve, 2.8 m/s from 25 % on', () => {
    expect(speedFactor(0.25, RUN.anchors) * RUN.maxSpeed).toBeCloseTo(2.8, 6);
    expect(speedFactor(0.6, RUN.anchors) * RUN.maxSpeed).toBeCloseTo(2.8, 6);
    expect(speedFactor(1, RUN.anchors) * RUN.maxSpeed).toBeCloseTo(2.8, 6);
  });
  it('?speeds= overrides for tuning, invalid → defaults; ?move=classic is exactly the former controller', () => {
    expect(parseSpeeds('1,2.5')).toEqual({ walk: 1, run: 2.5 });
    for (const bad of [null, '', '1', '2,1', '1,1.3,1.6,2.5', '1,9', 'a,b']) expect(parseSpeeds(bad)).toEqual(GAIT_SPEEDS);
    const t = readMoveProfile('?speeds=1,2.5'); const c = stickConfig(t, false); expect(c.maxSpeed).toBe(1); expect(speedFactor(0.25, c.anchors) * 1).toBeCloseTo(1, 6);
    const k = stickConfig(readMoveProfile('?move=classic'), false); expect(k).toEqual(MOVE_DEFAULTS); expect(k.smooth).toBeUndefined();
  });
});

describe('controller: speeds reached per test case (60 fps)', () => {
  const steady = (cfg: typeof WALK, d: number) => run(cfg, push(d), 2).out.at(-1)!.v;
  it('Run off: 25 % / 60 % / 100 % → 1.2 and never above', () => {
    expect(steady(WALK, 0.25)).toBeCloseTo(1.2, 2); expect(steady(WALK, 0.6)).toBeCloseTo(1.2, 2); expect(steady(WALK, 1)).toBeCloseTo(1.2, 2);
    expect(Math.max(...run(WALK, push(1), 3).out.map((o) => o.v))).toBeLessThanOrEqual(1.2 * 1.001 + 1e-9);
  });
  it('Run on, 25 % and 100 % → 2.8', () => {
    expect(steady(RUN, 0.25)).toBeCloseTo(2.8, 2); expect(steady(RUN, 1)).toBeCloseTo(2.8, 2);
  });
  it('Run on → off while moving at full push: eases down to 1.2 within 0.4 s, no snap, never below 1.2', () => {
    const fast = run(RUN, push(1), 2).st; const { out } = run(WALK, push(1), 1, 60, fast);
    expect(out[0].v).toBeGreaterThan(2.7); // continuous: no instant drop
    expect(Math.max(...out.map((o) => -o.a))).toBeLessThan(12); // Δ 1.6 m/s, ω 18 → peak ≈ 10.6 m/s²
    expect(out.find((o) => o.v <= 1.2 * 1.02)!.t).toBeLessThan(0.4);
    for (const o of out) expect(o.v).toBeGreaterThanOrEqual(1.2 - 1e-6);
    let pv = 2.8; for (const o of out) { expect(Math.abs(o.v - pv)).toBeLessThan(0.20); pv = o.v; }
  });
  it('Run off → on while moving: eases up to 2.8, no jump', () => {
    const w = run(WALK, push(1), 2).st; const { out } = run(RUN, push(1), 1.5, 60, w);
    let pv = 1.2; for (const o of out) { expect(o.v - pv).toBeLessThan(0.20); expect(o.v).toBeGreaterThanOrEqual(pv - 1e-9); pv = o.v; } expect(out.at(-1)!.v).toBeCloseTo(2.8, 2);
  });
  it('start: acceleration ramps up from 0 (half speed < 0.2 s, 95 % in 0.35–0.6 s), monotone', () => {
    const { out } = run(WALK, push(1), 1); const T = 1.2;
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
    let st = run(WALK, push(1), 1).st; const z0 = st.z; st = stepMoveWorld(st, { x: 0, z: -1 }, 1, 1.5, WALK); expect(Math.abs(st.z - z0)).toBeLessThanOrEqual(1.2 * WALK.maxDt + 1e-6);
  });
});

describe('animation: mode decides the clips, speed decides weights and rates', () => {
  const sW = STRIDE.walk * SC, sR = STRIDE.run * SC;
  const runModeTS = 2.8 / sR; // ≈ 1.29, the 2.8 m/s run-mode playback
  const walkCapTS = GAIT.walkMaxRunSpeed / sR; // planted rate at the 1.2 m/s walk, ≈ 0.55
  it('walk mode at 1.2 m/s: long-stride Run clip at speed / STRIDE.run (feet planted), never the 2.8 m/s run-mode rate', () => {
    const b = modeBlend(1.2, SC, 'walk');
    expect(b.run).toBeGreaterThan(0.99); expect(b.idle + b.walk + b.run).toBeCloseTo(1, 9);
    expect(b.runTS * sR).toBeCloseTo(1.2, 6);
    expect(b.runTS).toBeCloseTo(walkCapTS, 6);
    expect(b.runTS).toBeLessThan(runModeTS - 0.2);
  });
  it('walk mode below the ≈ 0.82 m/s handoff: Walk clip only, rate = speed / walk stride (ramp only)', () => {
    const handoff = GAIT.runFrom * SC;
    expect(handoff).toBeCloseTo(0.817, 2);
    for (const v of [0.3, 0.5, 0.8]) {
      const b = modeBlend(v, SC, 'walk');
      expect(v).toBeLessThan(handoff);
      expect(b.walk).toBeGreaterThan(0.99); expect(b.run).toBe(0);
      expect(b.walkTS * sW).toBeCloseTo(v, 6);
    }
  });
  it('walk mode at 1.2 m/s (and below the handoff) matches pre-handoff gaitBlend (59f577c look)', () => {
    for (const v of [0.3, 0.5, 0.8, 1.2]) {
      const a = modeBlend(v, SC, 'walk'), g = gaitBlend(v, SC);
      expect(a.run).toBeCloseTo(g.run, 9); expect(a.walk).toBeCloseTo(g.walk, 9);
      expect(a.runTS).toBeCloseTo(g.runTS, 9);
    }
  });
  it('walk mode during a 2.8 → 1.2 ease-down: runTS is capped at the 1.2 m/s planted rate, never the 2.8 m/s rate', () => {
    const b28 = modeBlend(2.8, SC, 'walk');
    expect(b28.runTS).toBeCloseTo(walkCapTS, 6);
    expect(b28.runTS * sR).toBeCloseTo(1.2, 6);
    expect(b28.runTS).toBeLessThan(runModeTS - 0.2);
    expect(modeBlend(2.8, SC, 'run').runTS * sR).toBeCloseTo(2.8, 6);
    for (let v = 1.2; v <= 3.5; v += 0.01) {
      const b = modeBlend(v, SC, 'walk');
      expect(b.runTS).toBeCloseTo(walkCapTS, 6);
      expect(b.runTS).toBeLessThan(runModeTS);
    }
  });
  it('run mode at full push (2.8 m/s): run clip only, rate = speed / run stride (no slide)', () => {
    const b = modeBlend(2.8, SC, 'run'); expect(b.run).toBeGreaterThan(0.999); expect(b.runTS * sR).toBeCloseTo(2.8, 6);
  });
  it('run mode: weights sum to 1, rise monotonically into the run clip; slow run-mode speeds still use the walk clip', () => {
    let prev = 0; for (let v = 0; v <= 3.2; v += 0.01) { const b = modeBlend(v, SC, 'run'); expect(b.idle + b.walk + b.run).toBeCloseTo(1, 9); expect(b.run).toBeGreaterThanOrEqual(prev - 1e-12); prev = b.run; }
    expect(modeBlend(0.5, SC, 'run').walk).toBeGreaterThan(0.99);
  });
  it('root cause (reference): the former speed-only blend played the RUN clip at high walk speeds with Run off; modeBlend walk at 1.2 keeps that clip at the walk rate, not the 2.8 m/s rate', () => {
    expect(gaitBlend(1.482, SC).run).toBeGreaterThan(0.99);
    const w = modeBlend(1.2, SC, 'walk'); expect(w.run).toBeGreaterThan(0.99); expect(w.runTS * sR).toBeCloseTo(1.2, 6);
    expect(w.runTS).toBeLessThan(runModeTS - 0.2);
  });
  it('classic blend (?move=classic) unchanged', () => {
    const vW = LOCO.walk * SC, vR = LOCO.run * SC; expect(locoBlend(1.9, vW, vR).run).toBeGreaterThan(0.9); expect(locoBlend(0.5, vW, vR).walkTS).toBeCloseTo(0.5 / vW, 9);
  });
});
