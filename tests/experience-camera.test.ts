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
  it('Vue perso (2× zoom) panned into a corner of the box: the screen centre stays over the room silhouette', () => {
    const z2 = zoom * 2; const r = new THREE.Vector3(0, 1, 0).cross(ISO).normalize(); const u = ISO.clone().cross(r).normalize();
    const pts = [[0, 0, 0], [7.2, 0, 0], [0, 0, 6], [7.2, 0, 6], [0, 1.55, 0], [7.2, 1.55, 0], [0, 1.55, 6]].map(([x, y, z]) => { const p = new THREE.Vector3(x, y, z); return [p.dot(r), p.dot(u)]; });
    // convex hull (monotone chain) of the silhouette, then point-in-polygon for the screen centre
    const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]); const cr = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo: number[][] = [], up: number[][] = []; for (const q of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (const q of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); } const hull = lo.slice(0, -1).concat(up.slice(0, -1));
    for (const far of [new THREE.Vector3(-20, 0.35, 20), new THREE.Vector3(20, 0.35, 20), new THREE.Vector3(-5, 0.35, -5), new THREE.Vector3(20, 0.35, -20)]) {
      const out = clampTarget(far, ISO, 0.35, B, W, H, z2, new THREE.Vector3()); const c = [out.dot(r), out.dot(u)];
      for (let i = 0; i < hull.length; i++) expect(cr(hull[i], hull[(i + 1) % hull.length], c)).toBeGreaterThanOrEqual(-1e-6);
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

import { keyboardInset } from '../src/app/viewportFill';
import { fullRoomZoom, zoomLimits as zl } from '../src/render/cameraFit';
describe('Android resizes-content keyboard (layout viewport shrinks)', () => {
  it('is detected against the pre-focus height, iOS results unchanged', () => {
    const and = { innerHeight: 200, visualViewport: { height: 200, offsetTop: 0, scale: 1 } };
    expect(keyboardInset(and, true, 393)).toEqual({ open: true, off: 0, vh: 200, resized: true });
    expect(keyboardInset(and, true).open).toBe(false); // no pre-focus height: old behaviour
    expect(keyboardInset(and, false, 393).open).toBe(false); // not typing
    expect(keyboardInset({ innerHeight: 340, visualViewport: { height: 340, offsetTop: 0, scale: 1 } }, true, 393).open).toBe(false); // toolbar only
    expect(keyboardInset({ innerHeight: 393, visualViewport: { height: 170, offsetTop: 0, scale: 1 } }, true, 393)).toEqual({ open: true, off: 223, vh: 170 }); // iOS
  });
});
describe('chat above the on-screen keyboard (keyboardInset)', () => {
  it('reports the keyboard height only while typing and when the visual viewport really shrank', () => {
    expect(keyboardInset({ innerHeight: 393, visualViewport: { height: 170, offsetTop: 0, scale: 1 } }, true)).toEqual({ open: true, off: 223, vh: 170 });
    expect(keyboardInset({ innerHeight: 393, visualViewport: { height: 170, offsetTop: 0, scale: 1 } }, false).open).toBe(false);
    expect(keyboardInset({ innerHeight: 393, visualViewport: { height: 350, offsetTop: 0, scale: 1 } }, true).open).toBe(false); // toolbar change only
    expect(keyboardInset({ innerHeight: 393, visualViewport: { height: 170, offsetTop: 0, scale: 2 } }, true).open).toBe(false); // pinch-zoomed page
  });
});
describe('zoom range', () => {
  it('pinch-out always reaches the whole-room zoom, default untouched', () => {
    const room = { w: 7.2, d: 6, wallH: 1.55 } as never; const dir = new THREE.Vector3(1, 1.05, 1.2).normalize();
    const full = fullRoomZoom(852, 393, room, dir); const l = zl(86, full); expect(l.min).toBeLessThanOrEqual(full); expect(full).toBeLessThan(86); expect(l.max).toBeGreaterThan(250);
  });
});
