import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { clampTarget, roomBounds, fitZoom } from '../src/render/cameraFit';
import { appViewport } from '../src/app/viewportFill';

const ISO = new THREE.Vector3(1, 1.05, 1.2).normalize();
const room = { w: 7.2, d: 6, wallH: 1.55 }; const B = roomBounds(room);
/** visible rectangle (screen-plane world units) for a target */
function view(t: THREE.Vector3, W: number, H: number, zoom: number) {
  const r = new THREE.Vector3(0, 1, 0).cross(ISO).normalize(); const u = ISO.clone().cross(r).normalize();
  return { cx: t.dot(r), cy: t.dot(u), hw: W / 2 / zoom, hh: H / 2 / zoom, r, u };
}
function roomBox(r: THREE.Vector3, u: THREE.Vector3) {
  const pts = [[0, 0, 0], [7.2, 0, 0], [0, 0, 6], [7.2, 0, 6], [0, 1.55, 0], [7.2, 1.55, 0], [0, 1.55, 6]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const xs = pts.map((p) => p.dot(r)), ys = pts.map((p) => p.dot(u));
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe('camera kept on the room (real-device drift bug)', () => {
  const W = 852, H = 393; const zoom = fitZoom(W, H, room, ISO) * 1.2; // V3 on iPhone 15 landscape
  it('a target panned far away is pulled back so the view stays inside the room box', () => {
    for (const far of [new THREE.Vector3(30, 0.35, -20), new THREE.Vector3(-15, 5, 25), new THREE.Vector3(3, -8, 3)]) {
      const out = clampTarget(far, ISO, 0.35, B, W, H, zoom, new THREE.Vector3());
      const v = view(out, W, H, zoom); const box = roomBox(v.r, v.u);
      expect(v.cx - v.hw).toBeGreaterThanOrEqual(box.minX - 1e-6); expect(v.cx + v.hw).toBeLessThanOrEqual(box.maxX + 1e-6);
      expect(v.cy - v.hh).toBeGreaterThanOrEqual(box.minY - 1e-6); expect(v.cy + v.hh).toBeLessThanOrEqual(box.maxY + 1e-6);
      expect(out.y).toBeCloseTo(0.35, 6); // slid back to the reference height
    }
  });
  it('a target already well inside is left alone (no jitter)', () => {
    const c = new THREE.Vector3(3.4, 0.35, 2.7); const out = clampTarget(c, ISO, 0.35, B, W, H, zoom, new THREE.Vector3());
    expect(out.distanceTo(c)).toBeLessThan(1e-6);
  });
  it('the followed avatar always stays on screen, wherever it stands in the room', () => {
    for (let x = 0.2; x < 7.2; x += 0.5) for (let z = 0.2; z < 6; z += 0.5) {
      const out = clampTarget(new THREE.Vector3(x, 0.35, z), ISO, 0.35, B, W, H, zoom, new THREE.Vector3());
      const v = view(out, W, H, zoom); const a = new THREE.Vector3(x, 0, z);
      expect(Math.abs(a.dot(v.r) - v.cx)).toBeLessThanOrEqual(v.hw + 1e-6); expect(Math.abs(a.dot(v.u) - v.cy)).toBeLessThanOrEqual(v.hh + 0.4); // feet within the view (target is 0.35 m up)
    }
  });
  it('zoomed out further than the room: the room is centred', () => {
    const out = clampTarget(new THREE.Vector3(20, 0.35, 20), ISO, 0.35, B, W, H, 30, new THREE.Vector3());
    const v = view(out, W, H, 30); const box = roomBox(v.r, v.u);
    expect(v.cx).toBeCloseTo((box.minX + box.maxX) / 2, 5); expect(v.cy).toBeCloseTo((box.minY + box.maxY) / 2, 5);
  });
});

describe('full-screen stage size (mauve band bug)', () => {
  it('uses the live window height, and the larger value when the toolbar collapses', () => {
    expect(appViewport({ innerWidth: 852, innerHeight: 393, visualViewport: { width: 852, height: 393, scale: 1 } })).toEqual({ w: 852, h: 393 });
    expect(appViewport({ innerWidth: 852, innerHeight: 393, visualViewport: { width: 852, height: 340, scale: 1 } }).h).toBe(393);
    expect(appViewport({ innerWidth: 852, innerHeight: 393, visualViewport: null })).toEqual({ w: 852, h: 393 });
  });
  it('never sizes the game from a pinch-zoomed visual viewport', () => {
    expect(appViewport({ innerWidth: 852, innerHeight: 393, visualViewport: { width: 426, height: 196, scale: 2 } })).toEqual({ w: 852, h: 393 });
  });
});
