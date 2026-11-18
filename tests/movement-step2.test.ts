import { describe, expect, it, beforeEach } from 'vitest';
import * as THREE from 'three';
import { MOVE_DEFAULTS, newMoveState, stepMove, camBasisFromDir } from '../src/game/movement/MovementController';
import { gridCollider, discBlocked } from '../src/game/movement/collision';
import { followPath, newFollow, PATH_CFG } from '../src/game/movement/pathFollow';
import { resolveTapTarget, nearestFreePoint } from '../src/game/movement/tapTarget';
import { marker, showMarker, arriveMarker, invalidMarker, resetMarker, stepMarker, MARKER_CFG } from '../src/game/movement/marker';
import { DEFAULT_MOVE_SETTINGS, MOVE_SETTINGS_KEY, floorTapMoves, loadMoveSettings, saveMoveSettings, primaryInput, trackPointerKind, lastPointerKind, _setLastPointerKind } from '../src/input/moveSettings';
import { NavGrid } from '../src/game/nav/NavGrid';
import { ISO_DIR } from '../src/render/CameraRig';
import { driveCharacter, motion } from '../src/game/movement/playerMotion';
import { resetStick, setStick } from '../src/input/joystick/joystickState';
import { goTo, makeChar, world } from '../src/game/world';

const memKV = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const DIR = { x: -ISO_DIR.x, y: -ISO_DIR.y, z: -ISO_DIR.z };
/** 6 × 5 m room with a 1.2 × 0.8 m "sofa" in the middle (padded like real furniture). */
function room() { const n = new NavGrid(6, 5, 0.2); n.blockBox(2.4, 2.1, 3.6, 2.9); return n; }
const sofaHit = (x: number, z: number) => x > 2.4 && x < 3.6 && z > 2.1 && z < 2.9; // raw footprint (no pad)

function resetMotion() { resetStick(); motion.st = newMoveState(); motion.engaged = false; motion.driving = false; motion.followPath = null; motion.onEngage = null; motion.pathStats = { frames: 0, arrived: 0, replans: 0, gaveUp: 0 }; resetMarker(); }
/** Run the player glue like <Character> does: controller first, the old stepMover never touches the player while driven. */
function run(c: ReturnType<typeof makeChar>, nav: NavGrid, secs: number, fps = 60, each?: (t: number) => void) {
  const dt = 1 / fps; let t = 0;
  for (let i = 0; i < secs * fps; i++) { driveCharacter(c, dt, DIR, nav); stepMarker(dt); t += dt; each?.(t); }
}

describe('settings: default and persistence', () => {
  it('defaults to "Joystick seul" (touch tap-to-move OFF) when nothing is saved, or the save is corrupt / old', () => {
    expect(DEFAULT_MOVE_SETTINGS.touchTapToMove).toBe(false);
    const kv = memKV(); expect(loadMoveSettings(kv).touchTapToMove).toBe(false);
    kv.setItem(MOVE_SETTINGS_KEY, '{not json'); expect(loadMoveSettings(kv).touchTapToMove).toBe(false);
    kv.setItem(MOVE_SETTINGS_KEY, JSON.stringify({ touchTapToMove: 'yes' })); expect(loadMoveSettings(kv).touchTapToMove).toBe(false);
    expect(loadMoveSettings(null).touchTapToMove).toBe(false);
  });
  it('persists the choice and reloads it, in its own key (game save untouched)', () => {
    const kv = memKV(); kv.setItem('yooville.profile', '{"old":1}');
    saveMoveSettings({ touchTapToMove: true }, kv); expect(loadMoveSettings(kv).touchTapToMove).toBe(true);
    saveMoveSettings({ touchTapToMove: false }, kv); expect(loadMoveSettings(kv).touchTapToMove).toBe(false);
    expect(kv.getItem('yooville.profile')).toBe('{"old":1}'); expect([...kv.m.keys()].sort()).toEqual([MOVE_SETTINGS_KEY, 'yooville.profile'].sort());
  });
});

describe('input-mode detection', () => {
  it('device primary input: coarse pointer / touch screen without fine hover = touch; trackpad laptop / desktop = mouse', () => {
    expect(primaryInput(true, 5, false)).toBe('touch'); expect(primaryInput(false, 5, false)).toBe('touch'); // iPad desktop-mode UA
    expect(primaryInput(false, 10, true)).toBe('mouse'); expect(primaryInput(false, 0, true)).toBe('mouse'); expect(primaryInput(false, 0, false)).toBe('mouse');
  });
  it('mouse / pen clicks always move; touches follow the setting; unknown pointer → device default', () => {
    const off = { touchTapToMove: false }, on = { touchTapToMove: true };
    expect(floorTapMoves('mouse', off, 'touch')).toBe(true); expect(floorTapMoves('pen', off, 'mouse')).toBe(true);
    expect(floorTapMoves('touch', off, 'mouse')).toBe(false); expect(floorTapMoves('touch', on, 'mouse')).toBe(true);
    expect(floorTapMoves(null, off, 'touch')).toBe(false); expect(floorTapMoves(null, off, 'mouse')).toBe(true); expect(floorTapMoves(null, on, 'touch')).toBe(true);
  });
  it('the last pointerdown type is tracked (hybrid device: mouse click then a touch)', () => {
    const ls: Record<string, (e: Event) => void> = {}; trackPointerKind({ addEventListener: (t: string, f: (e: Event) => void) => { ls[t] = f; } } as unknown as Window);
    ls.pointerdown({ pointerType: 'mouse' } as unknown as Event); expect(lastPointerKind()).toBe('mouse');
    ls.pointerdown({ pointerType: 'touch' } as unknown as Event); expect(lastPointerKind()).toBe('touch');
    ls.pointerdown({ pointerType: 'pen' } as unknown as Event); expect(lastPointerKind()).toBe('pen');
    _setLastPointerKind(null);
  });
});

describe('tap target validation / snapping', () => {
  const nav = room(); const from = new THREE.Vector3(1, 0, 1);
  it('a free floor point is used as is', () => { const t = resolveTapTarget(nav, from, { x: 4.5, z: 4.1 }); expect(t.ok && !t.snapped && t.point.x).toBe(4.5); });
  it('a tap on furniture snaps to the nearest free point outside its footprint', () => {
    const t = resolveTapTarget(nav, from, { x: 3, z: 2.2 }); expect(t.ok).toBe(true);
    if (t.ok) { expect(t.snapped).toBe(true); expect(discBlocked(nav, t.point.x, t.point.z, 0.08)).toBe(false); expect(t.point.distanceTo(new THREE.Vector3(3, 0, 2.2))).toBeLessThan(0.9); }
  });
  it('outside the room / far in the sea → rejected, nothing to walk to', () => {
    expect(resolveTapTarget(nav, from, { x: -3, z: 2 })).toMatchObject({ ok: false, reason: 'outside' });
    expect(resolveTapTarget(nav, from, { x: 3, z: 9 })).toMatchObject({ ok: false, reason: 'outside' });
    // just past the edge: snaps back inside
    const t = resolveTapTarget(nav, from, { x: 6.3, z: 2 }); expect(t.ok).toBe(true);
  });
  it('in the middle of a big solid (no free spot within reach) → rejected as blocked', () => {
    const n = new NavGrid(8, 8, 0.2); n.blockBox(1, 1, 7, 7, 0); expect(resolveTapTarget(n, new THREE.Vector3(0.3, 0, 0.3), { x: 4, z: 4 })).toMatchObject({ ok: false, reason: 'blocked' });
    expect(nearestFreePoint(n, 4, 4, 0.9)).toBeNull();
  });
  it('a free spot that cannot be reached (closed pocket) → rejected as unreachable', () => {
    const n = new NavGrid(6, 5, 0.2); // a closed box of walls around (4.5, 2.5)
    n.blockBox(3.6, 1.6, 5.4, 1.6, 0); n.blockBox(3.6, 3.4, 5.4, 3.4, 0); n.blockBox(3.6, 1.6, 3.6, 3.4, 0); n.blockBox(5.4, 1.6, 5.4, 3.4, 0);
    expect(resolveTapTarget(n, new THREE.Vector3(1, 0, 1), { x: 4.5, z: 2.5 })).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('path following with the analog controller', () => {
  beforeEach(resetMotion);
  it('walks to the destination and stops on it (within 4 cm), at the natural walk speed', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    expect(goTo('p', new THREE.Vector3(5, 0, 1))).toBe(true);
    let vmax = 0; run(c, nav, 8, 60, () => { vmax = Math.max(vmax, c.speed); });
    expect(c.path).toHaveLength(0); expect(Math.hypot(c.pos.x - 5, c.pos.z - 1)).toBeLessThan(0.04);
    expect(vmax).toBeGreaterThan(PATH_CFG.walk * 0.9); expect(vmax).toBeLessThan(PATH_CFG.walk * 1.05); expect(c.speed).toBe(0);
    expect(motion.pathStats.arrived).toBeGreaterThan(0);
  });
  it('a double-tap run uses the run speed', () => {
    const nav = room(); const c = makeChar('p', 'P', 0.5, 0.5); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(5.5, 0, 0.5), { run: true }); let vmax = 0; run(c, nav, 5, 60, () => { vmax = Math.max(vmax, c.speed); });
    expect(vmax).toBeGreaterThan(PATH_CFG.run * 0.9); expect(Math.hypot(c.pos.x - 5.5, c.pos.z - 0.5)).toBeLessThan(0.04);
  });
  it('a destination behind furniture is reached around it: the avatar centre never enters the footprint', () => {
    const nav = room(); const c = makeChar('p', 'P', 3, 1.2); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(3, 0, 3.8)); let inside = 0;
    run(c, nav, 10, 60, () => { if (sofaHit(c.pos.x, c.pos.z)) inside++; });
    expect(inside).toBe(0); expect(Math.hypot(c.pos.x - 3, c.pos.z - 3.8)).toBeLessThan(0.04);
  });
  it('frame-rate independent: same arrival at 20, 60 and 144 fps', () => {
    for (const fps of [20, 60, 144]) {
      resetMotion(); const nav = room(); const c = makeChar('p', 'P', 1, 4); world.nav = nav; world.chars.p = c;
      goTo('p', new THREE.Vector3(5, 0, 4)); let t = 0; run(c, nav, 8, fps, (tt) => { if (!t && !c.path.length) t = tt; });
      expect(Math.hypot(c.pos.x - 5, c.pos.z - 4)).toBeLessThan(0.04); expect(t).toBeGreaterThan(4.3); expect(t).toBeLessThan(5.6);
    }
  });
  it('re-targeting mid-walk keeps the velocity (no stop, no teleport) and goes to the new spot', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(5, 0, 1)); run(c, nav, 1.5);
    const before = c.pos.clone(), v0 = c.speed; expect(v0).toBeGreaterThan(0.6);
    goTo('p', new THREE.Vector3(1, 0, 4.2)); driveCharacter(c, 1 / 60, DIR, nav);
    expect(c.pos.distanceTo(before)).toBeLessThan(0.05); expect(c.speed).toBeGreaterThan(0.3);
    run(c, nav, 8); expect(Math.hypot(c.pos.x - 1, c.pos.z - 4.2)).toBeLessThan(0.04);
  });
  it('the joystick interrupts a path at any time: path cleared, the stick drives', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(5, 0, 4)); showMarker(5, 4, 'p'); run(c, nav, 1);
    setStick(1, 0, 1, 1); driveCharacter(c, 1 / 60, DIR, nav);
    expect(c.path).toHaveLength(0); expect(marker.phase).toBe('fading'); expect(motion.engaged).toBe(true);
    const p = c.pos.clone(); for (let i = 0; i < 30; i++) driveCharacter(c, 1 / 60, DIR, nav);
    expect(c.pos.distanceTo(p)).toBeGreaterThan(0.3); resetStick();
  });
  it('a seat reached by path still sits (pending seat handed back to <Character>)', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    const seat = { id: 's', pos: new THREE.Vector3(4, 0, 4), yaw: 0, front: new THREE.Vector3(4, 0, 3.6) };
    goTo('p', seat.front, { seat }); let driven = true; for (let i = 0; i < 600 && driven; i++) driven = driveCharacter(c, 1 / 60, DIR, nav);
    expect(driven).toBe(false); expect(c.pendingSeat).toBe(seat); expect(c.path).toHaveLength(0);
  });
  it('stuck against a moved obstacle: re-plans once, then gives up cleanly (no endless walking in place)', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(5, 0, 1)); nav.blockBox(1.5, 0, 1.7, 5, 0); // a wall appears across the room after planning
    run(c, nav, 4); expect(c.path).toHaveLength(0); expect(c.pos.x).toBeLessThan(1.5); expect(motion.pathStats.gaveUp + motion.pathStats.replans).toBeGreaterThan(0);
  });
  it('followPath never overshoots the final point even with a long frame', () => {
    const st = newMoveState(0, 0); const path = [new THREE.Vector3(0.1, 0, 0)];
    const r = followPath({ ...st, vx: 1.5 }, path, false, 0.25, MOVE_DEFAULTS, undefined, newFollow());
    expect(r.arrived).toBe(true); expect(r.st.x).toBeCloseTo(0.1, 5);
  });
  it('the stick path is unchanged by the refactor (stepMove still reaches the same speed)', () => {
    let st = newMoveState(10, 10); const cam = camBasisFromDir(DIR.x, DIR.y, DIR.z); const col = gridCollider(new NavGrid(20, 20, 0.2));
    for (let i = 0; i < 60; i++) st = stepMove(st, { x: 1, y: 0 }, cam, 1 / 60, MOVE_DEFAULTS, col);
    expect(st.speed).toBeCloseTo(MOVE_DEFAULTS.maxSpeed, 2);
  });
});

describe('destination marker lifecycle', () => {
  beforeEach(resetMarker);
  it('appears on a valid tap, stays while walking, fades out after arrival', () => {
    showMarker(2, 3); expect(marker.phase).toBe('active'); stepMarker(0.5); expect(marker.alpha).toBe(1);
    arriveMarker(); expect(marker.phase).toBe('fading'); stepMarker(MARKER_CFG.fade / 2); expect(marker.alpha).toBeGreaterThan(0); expect(marker.alpha).toBeLessThan(1);
    stepMarker(MARKER_CFG.fade); expect(marker.phase).toBe('hidden'); expect(marker.alpha).toBe(0);
  });
  it('an invalid tap flashes briefly then disappears; arrive() does not touch an invalid ripple', () => {
    invalidMarker(1, 1); arriveMarker(); expect(marker.phase).toBe('invalid'); stepMarker(MARKER_CFG.invalid + 0.01); expect(marker.phase).toBe('hidden');
  });
  it('the glue fades the marker when the path ends, is replaced elsewhere, or arrives', () => {
    resetMotion(); const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    goTo('p', new THREE.Vector3(5, 0, 1)); showMarker(5, 1, 'p'); run(c, nav, 0.5); expect(marker.phase).toBe('active');
    goTo('p', new THREE.Vector3(5, 0, 1.1)); showMarker(5, 1.1, 'p'); run(c, nav, 0.2); expect(marker.phase).toBe('active'); // re-target: new marker
    goTo('p', new THREE.Vector3(1, 0, 4)); driveCharacter(c, 1 / 60, DIR, nav); expect(marker.phase).toBe('fading'); // seat / other walk elsewhere
    goTo('p', new THREE.Vector3(4, 0, 1)); showMarker(4, 1, 'p'); run(c, nav, 8); expect(marker.phase).toBe('hidden'); expect(c.path).toHaveLength(0);
  });
});

describe('interaction targets next to furniture', () => {
  beforeEach(resetMotion);
  it('a seat front 5 cm from a padded furniture cell is reached exactly and hands the seat back (point collision on the path)', () => {
    const nav = room(); const c = makeChar('p', 'P', 1, 1); world.nav = nav; world.chars.p = c;
    const front = new THREE.Vector3(3, 0, 1.75); // the sofa's padded cells start at z = 1.8
    const seat = { id: 's', pos: new THREE.Vector3(3, 0, 2.3), yaw: 0, front };
    expect(nav.free(...nav.toCell(front.x, front.z))).toBe(true); expect(discBlocked(nav, front.x, front.z, 0.08)).toBe(true);
    goTo('p', front, { seat }); let driven = true; for (let i = 0; i < 900 && driven; i++) driven = driveCharacter(c, 1 / 60, DIR, nav);
    expect(driven).toBe(false); expect(c.pendingSeat).toBe(seat); expect(c.pos.distanceTo(front)).toBeLessThan(0.04); expect(motion.pathStats.gaveUp).toBe(0);
  });
});
