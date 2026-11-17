import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { LOCO, stepMover, type Mover } from '../src/game/character/locomotion';
import { NavGrid } from '../src/game/nav/NavGrid';

const mover = (x = 0, z = 0): Mover => ({ pos: new THREE.Vector3(x, 0, z), yaw: 0, speed: 0, path: [], running: false });
function run(m: Mover, secs: number, dt = 1 / 60) { let t = 0; while (t < secs && stepMover(m, dt)) t += dt; return t; }

describe('locomotion', () => {
  it('reaches the target and stops exactly on it', () => {
    const m = mover(); m.path = [new THREE.Vector3(2, 0, 0)];
    run(m, 10); expect(m.pos.distanceTo(new THREE.Vector3(2, 0, 0))).toBeLessThan(1e-6); expect(m.speed).toBe(0);
  });
  it('accelerates smoothly and never exceeds walk speed', () => {
    const m = mover(); m.yaw = Math.PI / 2; m.path = [new THREE.Vector3(5, 0, 0)];
    let max = 0; for (let i = 0; i < 30; i++) { stepMover(m, 1 / 60); max = Math.max(max, m.speed); }
    expect(max).toBeLessThanOrEqual(LOCO.walk + 1e-9); expect(max).toBeGreaterThan(0.5);
  });
  it('running is faster than walking', () => {
    const a = mover(), b = mover(); a.path = [new THREE.Vector3(0, 0, 6)]; b.path = [new THREE.Vector3(0, 0, 6)]; b.running = true;
    expect(run(b, 20)).toBeLessThan(run(a, 20));
  });
  it('turns towards the heading', () => {
    const m = mover(); m.path = [new THREE.Vector3(3, 0, 0)];
    for (let i = 0; i < 60; i++) stepMover(m, 1 / 60);
    expect(Math.abs(m.yaw - Math.PI / 2)).toBeLessThan(0.05);
  });
});

describe('NavGrid', () => {
  it('finds a path around an obstacle', () => {
    const g = new NavGrid(4, 4, 0.2); g.blockBox(1.5, 0, 2.5, 3, 0);
    const p = g.path(new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(3.5, 0, 0.5));
    expect(p.length).toBeGreaterThan(1);
    for (let k = 0; k < p.length - 1; k++) expect(g.lineFree(p[k], p[k + 1])).toBe(true);
    expect(p[p.length - 1].distanceTo(new THREE.Vector3(3.5, 0, 0.5))).toBeLessThan(0.01);
  });
  it('returns [] when unreachable', () => {
    const g = new NavGrid(4, 4, 0.2); g.blockBox(1.5, 0, 2.5, 4, 0.2);
    expect(g.path(new THREE.Vector3(0.5, 0, 0.5), new THREE.Vector3(3.5, 0, 0.5))).toEqual([]);
  });
});
