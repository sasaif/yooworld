import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_ANCHORS, SPEED_BANDS, speedFactor, bandOf } from '../src/game/movement/speedCurve';
import { MOVE_DEFAULTS, camBasisFromDir, newMoveState, screenToWorldDir, stepMove, type MoveState } from '../src/game/movement/MovementController';
import { gridCollider, discBlocked } from '../src/game/movement/collision';
import { locoBlend } from '../src/game/movement/animBlend';
import { keyboardVector, readInput, resetStick, setStick, stick, stickFromOffset, onStickReset } from '../src/input/joystick/joystickState';
import { stickRadius, wantsJoystick } from '../src/input/joystick/VirtualJoystick';
import { NavGrid } from '../src/game/nav/NavGrid';
import { ISO_DIR } from '../src/render/CameraRig';
import { LOCO } from '../src/game/character/locomotion';
import { driveCharacter, motion } from '../src/game/movement/playerMotion';
import { makeChar } from '../src/game/world';

const ISO = camBasisFromDir(-ISO_DIR.x, -ISO_DIR.y, -ISO_DIR.z); // the game camera looks along -ISO_DIR
const TOP = { fx: 0, fz: -1, sinEl: 1 }; // simple top-down camera looking towards -Z, for exact geometry checks
const cfg = MOVE_DEFAULTS;
function simulate(input: { x: number; y: number }, secs: number, fps: number, st: MoveState = newMoveState(), cam = TOP, collide?: Parameters<typeof stepMove>[5]) {
  const dt = 1 / fps; let s = st; const n = Math.round(secs * fps);
  for (let i = 0; i < n; i++) s = stepMove(s, input, cam, dt, cfg, collide);
  return s;
}
const stickAt = (d: number, angleDeg: number) => ({ x: Math.cos(angleDeg * Math.PI / 180) * d, y: -Math.sin(angleDeg * Math.PI / 180) * d });

describe('speed curve (joystick displacement → speed factor)', () => {
  it('0–10 % is a dead zone', () => { for (const d of [0, 0.02, 0.05, 0.099, 0.1]) expect(speedFactor(d)).toBe(0); expect(speedFactor(NaN)).toBe(0); });
  it('hits each level at the centre of its band', () => {
    expect(speedFactor(0.225)).toBeCloseTo(0.30, 6); expect(speedFactor(0.50)).toBeCloseTo(0.60, 6);
    expect(speedFactor(0.775)).toBeCloseTo(0.85, 6); expect(speedFactor(0.95)).toBe(1); expect(speedFactor(1)).toBe(1); expect(speedFactor(2)).toBe(1);
  });
  it('stays within each band\'s neighbourhood (slow ≈30 %, normal ≈60 %, fast ≈85 %, max 100 %)', () => {
    const avg = (a: number, b: number) => { let s = 0; for (let i = 0; i < 100; i++) s += speedFactor(a + (b - a) * (i + 0.5) / 100); return s / 100; };
    expect(avg(0.15, 0.30)).toBeGreaterThan(0.2); expect(avg(0.15, 0.30)).toBeLessThan(0.4);
    expect(avg(0.40, 0.60)).toBeGreaterThan(0.5); expect(avg(0.40, 0.60)).toBeLessThan(0.7);
    expect(avg(0.70, 0.85)).toBeGreaterThan(0.75); expect(avg(0.70, 0.85)).toBeLessThan(0.95);
    expect(avg(0.92, 1.0)).toBeGreaterThan(0.97);
    expect(bandOf(0.5).name).toBe('normal'); expect(SPEED_BANDS).toHaveLength(5);
  });
  it('is continuous and monotonic (progressive, no step)', () => {
    let prev = 0, maxJump = 0;
    for (let i = 0; i <= 10000; i++) { const v = speedFactor(i / 10000); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); maxJump = Math.max(maxJump, v - prev); prev = v; }
    expect(maxJump).toBeLessThan(0.002); // 0.01 % of travel never changes speed by more than 0.2 %
    expect(DEFAULT_ANCHORS[0][0]).toBe(0.1);
  });
  it('anchors are configurable', () => { const a = [[0.2, 0], [0.6, 0.5], [1, 1]] as const; expect(speedFactor(0.15, a)).toBe(0); expect(speedFactor(0.6, a)).toBeCloseTo(0.5, 6); expect(speedFactor(1, a)).toBe(1); });
});

describe('direction mapping & normalisation', () => {
  it('top-down camera: screen up = away from camera, right = right', () => {
    const up = screenToWorldDir(0, -1, TOP)!; expect(up.x).toBeCloseTo(0); expect(up.z).toBeCloseTo(-1);
    const right = screenToWorldDir(1, 0, TOP)!; expect(right.x).toBeCloseTo(1); expect(right.z).toBeCloseTo(0);
  });
  it('isometric camera: stick up walks away from the camera on the floor; every screen direction is followed', () => {
    const up = screenToWorldDir(0, -1, ISO)!; expect(up.x).toBeCloseTo(ISO.fx, 6); expect(up.z).toBeCloseTo(ISO.fz, 6);
    expect(up.x).toBeLessThan(0); expect(up.z).toBeLessThan(0); // towards the back walls
    // project the floor direction back to the screen with a real ortho camera: angle must match the stick
    const cam = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100); cam.position.copy(ISO_DIR).multiplyScalar(30); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    for (let a = 0; a < 360; a += 15) {
      const s = stickAt(1, a); const w = screenToWorldDir(s.x, s.y, ISO)!;
      const p0 = new THREE.Vector3(0, 0, 0).project(cam), p1 = new THREE.Vector3(w.x, 0, w.z).project(cam);
      const screenAng = Math.atan2(p1.y - p0.y, p1.x - p0.x) * 180 / Math.PI;
      const err = Math.abs(((screenAng - a + 540) % 360) - 180); expect(err).toBeLessThan(0.01);
    }
  });
  it('diagonals are not faster than straight lines (top speed identical in all 360°)', () => {
    const speeds: number[] = [];
    for (let a = 0; a < 360; a += 22.5) { const s = simulate(stickAt(1, a), 1.5, 60, newMoveState(), ISO); speeds.push(Math.hypot(s.vx, s.vz)); }
    for (const v of speeds) expect(v).toBeCloseTo(cfg.maxSpeed, 4);
    // corner of a square stick (|x|=|y|=1 → length √2) is clamped to full speed, not 141 %
    const sq = simulate({ x: 1, y: -1 }, 1.5, 60, newMoveState(), ISO); expect(Math.hypot(sq.vx, sq.vz)).toBeCloseTo(cfg.maxSpeed, 4);
  });
  it('character turns smoothly to face the movement direction', () => {
    let s = newMoveState(); s.yaw = 0; const yaws: number[] = [];
    for (let i = 0; i < 60; i++) { s = stepMove(s, { x: 1, y: 0 }, TOP, 1 / 60); yaws.push(s.yaw); }
    expect(yaws[0]).toBeGreaterThan(0); expect(yaws[0]).toBeLessThan(Math.PI / 4); // not a snap
    expect(s.yaw).toBeCloseTo(Math.PI / 2, 2); // facing +X after 1 s
    for (let i = 1; i < yaws.length; i++) expect(yaws[i]).toBeGreaterThanOrEqual(yaws[i - 1] - 1e-9);
  });
});

describe('acceleration, deceleration, frame-rate independence', () => {
  it('same distance at 30 / 60 / 120 / 144 fps', () => {
    const d = [30, 60, 120, 144].map((fps) => { const s = simulate(stickAt(0.8, 30), 2, fps); return Math.hypot(s.x, s.z); });
    for (const v of d) expect(Math.abs(v - d[1])).toBeLessThan(0.005);
    // also with release in the middle
    const r = [30, 60, 120].map((fps) => { let s = simulate(stickAt(1, 0), 1, fps); s = simulate({ x: 0, y: 0 }, 0.5, fps, s); return s.x; });
    for (const v of r) expect(Math.abs(v - r[1])).toBeLessThan(0.005);
  });
  it('accelerates smoothly: ~95 % of the target speed in ≈0.2 s, never overshooting', () => {
    let s = newMoveState(); const v: number[] = [];
    for (let i = 0; i < 30; i++) { s = stepMove(s, { x: 1, y: 0 }, TOP, 1 / 60); v.push(Math.hypot(s.vx, s.vz)); }
    expect(v[0]).toBeLessThan(cfg.maxSpeed * 0.3); // no instant jump
    const t95 = v.findIndex((x) => x >= 0.95 * cfg.maxSpeed) / 60; expect(t95).toBeGreaterThan(0.1); expect(t95).toBeLessThan(0.3);
    for (let i = 1; i < v.length; i++) { expect(v[i]).toBeGreaterThanOrEqual(v[i - 1]); expect(v[i]).toBeLessThanOrEqual(cfg.maxSpeed + 1e-9); }
  });
  it('stops within ~0.12 s of release and fully at rest (no drift)', () => {
    let s = simulate({ x: 0, y: -1 }, 1, 60); expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(cfg.maxSpeed, 3);
    let t = 0; while (Math.hypot(s.vx, s.vz) > 0 && t < 1) { s = stepMove(s, { x: 0, y: 0 }, TOP, 1 / 60); t += 1 / 60; }
    expect(t).toBeLessThanOrEqual(0.15); const x = s.x, z = s.z;
    s = simulate({ x: 0, y: 0 }, 1, 60, s); expect(s.x).toBe(x); expect(s.z).toBe(z);
  });
  it('dead-zone input brakes like a release', () => { let s = simulate({ x: 1, y: 0 }, 1, 60); s = simulate({ x: 0.05, y: 0 }, 0.3, 60, s); expect(s.vx).toBe(0); });
  it('measured top speed per band (moving at constant displacement)', () => {
    for (const [d, f] of [[0.225, 0.3], [0.5, 0.6], [0.775, 0.85], [1, 1]] as const) {
      const s = simulate(stickAt(d, 45), 1, 60); expect(s.speed / cfg.maxSpeed).toBeCloseTo(f, 3);
    }
    expect(simulate(stickAt(0.08, 45), 1, 60).speed).toBe(0);
  });
  it('max speed is configurable', () => { const s = (() => { let x = newMoveState(); for (let i = 0; i < 120; i++) x = stepMove(x, { x: 1, y: 0 }, TOP, 1 / 60, { ...cfg, maxSpeed: 3 }); return x; })(); expect(s.vx).toBeCloseTo(3, 3); });
  it('clamps huge frame times (no teleport after a hitch)', () => { const s = stepMove(newMoveState(), { x: 1, y: 0 }, TOP, 5); expect(s.x).toBeLessThan(cfg.maxSpeed * cfg.maxDt + 1e-9); });
});

describe('collision: walls, furniture, bounds, sliding', () => {
  const room = () => { const g = new NavGrid(6, 5, 0.2); g.blockBox(0, 0, 6, 0.12, 0); g.blockBox(0, 0, 0.12, 5, 0); g.blockBox(2.4, 2.0, 3.6, 3.0, 0.06); return g; };
  it('cannot walk through a furniture block, even at a huge speed / frame time', () => {
    const nav = room(); const col = gridCollider(nav);
    let s = newMoveState(1.0, 2.5); // left of the block, push +X
    for (let i = 0; i < 200; i++) s = stepMove(s, { x: 1, y: 0 }, TOP, 0.1, { ...cfg, maxSpeed: 20 }, col);
    expect(s.x).toBeLessThan(2.34); expect(discBlocked(nav, s.x, s.z, 0.08)).toBe(false);
  });
  it('slides along an obstacle instead of sticking when pushing diagonally', () => {
    const nav = room(); const col = gridCollider(nav);
    let s = newMoveState(1.6, 2.5); // push +X and -Z (screen up-right): blocked in X, keeps sliding in -Z
    for (let i = 0; i < 60; i++) s = stepMove(s, { x: 0.7071, y: 0.7071 * -1 }, TOP, 1 / 60, cfg, col);
    expect(s.z).toBeLessThan(1.9); // slid up past the block's edge
  });
  it('rounds a corner when pushing head-on just beside an edge', () => {
    const nav = room(); const col = gridCollider(nav);
    let s = newMoveState(2.0, 1.86); // head-on into the block, 0.14 m inside its top edge
    for (let i = 0; i < 120; i++) s = stepMove(s, { x: 1, y: 0 }, TOP, 1 / 60, cfg, col);
    expect(s.x).toBeGreaterThan(2.5); // got around instead of stopping dead
  });
  it('stays inside the room / world bounds (walls and open edges)', () => {
    const nav = room(); const col = gridCollider(nav);
    for (const inp of [{ x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }]) {
      let s = newMoveState(1, 1); s = simulate(inp, 6, 60, s, TOP, col);
      expect(s.x).toBeGreaterThan(0.12); expect(s.z).toBeGreaterThan(0.12); expect(s.x).toBeLessThan(6); expect(s.z).toBeLessThan(5);
      expect(Math.hypot(s.vx, s.vz)).toBe(0); // pushing into a wall: velocity cancelled, no jitter
    }
  });
  it('can always walk out when starting overlapped (e.g. after standing up)', () => {
    const nav = room(); const col = gridCollider(nav); let s = newMoveState(2.4, 2.5); // inside the padded block edge
    s = simulate({ x: -1, y: 0 }, 0.5, 60, s, TOP, col); expect(s.x).toBeLessThan(2.1);
  });
});

describe('animation driven by actual speed', () => {
  const vW = LOCO.walk * 1.14, vR = LOCO.run * 1.14;
  it('idle at rest, walk when slow, run at full speed', () => {
    expect(locoBlend(0, vW, vR).idle).toBe(1);
    const slow = locoBlend(0.3 * cfg.maxSpeed, vW, vR); expect(slow.walk).toBeGreaterThan(0.9);
    const full = locoBlend(cfg.maxSpeed, vW, vR); expect(full.run).toBeGreaterThan(0.99);
    for (let v = 0; v <= 3; v += 0.05) { const b = locoBlend(v, vW, vR); expect(b.idle + b.walk + b.run).toBeCloseTo(1, 9); }
  });
  it('playback rate is proportional to the actual speed and never faster than the motion', () => {
    for (let v = 0; v <= 3; v += 0.01) { const b = locoBlend(v, vW, vR); expect(b.walkTS).toBeLessThanOrEqual(v / vW + 1e-9); expect(b.runTS).toBeLessThanOrEqual(v / vR + 1e-9); }
    expect(locoBlend(0.5, vW, vR).walkTS).toBeCloseTo(0.5 / vW, 9);
    expect(locoBlend(0, vW, vR).walkTS).toBe(0); // blocked against a wall: feet stop
  });
});

describe('joystick input state', () => {
  it('normalises the finger offset to the unit disc', () => {
    expect(stickFromOffset(0, 0, 50)).toEqual({ x: 0, y: 0, mag: 0 });
    const a = stickFromOffset(25, 0, 50); expect(a.mag).toBeCloseTo(0.5); expect(a.x).toBeCloseTo(0.5);
    const b = stickFromOffset(300, 400, 50); expect(b.mag).toBe(1); expect(Math.hypot(b.x, b.y)).toBeCloseTo(1, 9);
  });
  it('resets on release / cancel / blur and notifies the knob', () => {
    let n = 0; const off = onStickReset(() => n++);
    setStick(7, 0.6, -0.2, 0.63); expect(readInput().source).toBe('stick'); expect(stick.pointerId).toBe(7);
    resetStick(); expect(stick).toEqual({ active: false, pointerId: null, x: 0, y: 0, mag: 0 }); expect(readInput().mag).toBe(0); expect(n).toBe(1); off();
  });
  it('keyboard: diagonal not faster, Shift = slow', () => {
    const d = keyboardVector(['KeyW', 'KeyD'], false); expect(Math.hypot(d.x, d.y)).toBeCloseTo(1, 9);
    expect(keyboardVector(['ArrowLeft'], true).mag).toBe(0.5); expect(keyboardVector(['KeyW', 'KeyS'], false).mag).toBe(0);
  });
  it('stick travel radius comes from layout sizes (148 px base, 44 % knob → 62.3 px), never below 20 px', () => {
    expect(stickRadius(148, 148 * 0.44)).toBeCloseTo(74 - 148 * 0.44 * 0.18, 9); expect(stickRadius(124, 124 * 0.44)).toBeCloseTo(52.18, 2); expect(stickRadius(10, 5)).toBe(20);
  });
  it('shown on touch devices only (?joystick=1 / 0 override)', () => {
    expect(wantsJoystick('', true)).toBe(true); expect(wantsJoystick('', false)).toBe(false);
    // iPad / touch tablet that does not report pointer:coarse: touch points and no fine hovering pointer → joystick
    expect(wantsJoystick('', false, 5, false)).toBe(true);
    // touch laptop driven by a trackpad (fine + hover) → click / keyboard, no stick; plain desktop → none
    expect(wantsJoystick('', false, 10, true)).toBe(false); expect(wantsJoystick('', false, 0, false)).toBe(false);
    expect(wantsJoystick('?joystick=1', false)).toBe(true); expect(wantsJoystick('?joystick=0', true)).toBe(false);
  });
});

describe('player glue: stick vs tap-to-move, sit & dance', () => {
  const nav = new NavGrid(6, 5, 0.2); const dir = { x: -ISO_DIR.x, y: -ISO_DIR.y, z: -ISO_DIR.z };
  it('stick interrupts a tap-to-move path and drives the avatar; release hands back to tap-to-move', () => {
    resetStick(); motion.st = newMoveState(); motion.engaged = false; motion.driving = false;
    const c = makeChar('t', 'T', 3, 2.5); c.path = [new THREE.Vector3(5, 0, 4)]; c.pendingSeat = { id: 's', pos: new THREE.Vector3(), yaw: 0, front: new THREE.Vector3() };
    setStick(1, 0, -1, 1);
    for (let i = 0; i < 30; i++) expect(driveCharacter(c, 1 / 60, dir, nav)).toBe(true);
    expect(c.path).toHaveLength(0); expect(c.pendingSeat).toBeUndefined(); expect(c.pos.distanceTo(new THREE.Vector3(3, 0, 2.5))).toBeGreaterThan(0.3);
    resetStick(); for (let i = 0; i < 20; i++) driveCharacter(c, 1 / 60, dir, nav);
    expect(driveCharacter(c, 1 / 60, dir, nav)).toBe(false); // at rest → tap-to-move owns the avatar again
  });
  it('stick while seated stands the avatar up (no teleport), and stops a dance via the engage hook', () => {
    resetStick(); motion.engaged = false; motion.driving = false; let hook = 0; motion.onEngage = (ch) => { hook++; ch.emote = false; };
    const c = makeChar('t2', 'T', 3, 2.5); c.mode = 'sitting'; c.emote = true;
    setStick(1, 1, 0, 1); expect(driveCharacter(c, 1 / 60, dir, nav)).toBe(false);
    expect(c.mode).toBe('standing'); expect(hook).toBe(1); expect(c.emote).toBe(false);
    c.mode = 'idle'; expect(driveCharacter(c, 1 / 60, dir, nav)).toBe(true); expect(hook).toBe(1);
    resetStick(); motion.onEngage = null;
  });
});
