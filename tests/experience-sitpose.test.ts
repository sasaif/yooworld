import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SitPose, SIT_STYLES, ANKLE_H, solveDroop } from '../src/render/avatar/sitPose';
import { posedRoot, posedSeat, sitHip, SEAT_CLEAR } from '../src/game/interact/anchors';
import type { Seat } from '../src/game/world';

/** Minimal Mixamo-like rig standing upright (legs straight down, arms hanging), facing +Z. */
function rig() {
  const root = new THREE.Group(); const bone = (n: string, p: THREE.Object3D, x: number, y: number, z = 0) => { const b = new THREE.Bone(); b.name = n; b.position.set(x, y, z); p.add(b); return b; };
  const hips = bone('Hips', root, 0, 0.3); const spine = bone('Spine', hips, 0, 0.05); bone('Neck', spine, 0, 0.2);
  for (const [s, x] of [['Left', 0.06], ['Right', -0.06]] as const) {
    const up = bone(s + 'UpLeg', hips, x, -0.02); const low = bone(s + 'Leg', up, 0, -0.12); const foot = bone(s + 'Foot', low, 0, -0.09); bone(s + 'ToeBase', foot, 0, -0.05, 0.06);
    const arm = bone(s + 'Arm', spine, x * 1.6, 0.15); const fa = bone(s + 'ForeArm', arm, 0, -0.1); bone(s + 'Hand', fa, 0, -0.08);
  }
  root.updateMatrixWorld(true); return root;
}
const P = (o: THREE.Object3D, n: string) => o.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
const angle = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => THREE.MathUtils.radToDeg(a.clone().sub(b).angleTo(c.clone().sub(b)));

describe('procedural seated pose (SitPose)', () => {
  it('bends the knees ~90°, thighs forward, plants the pelvis on the seat point', () => {
    const r = rig(); const sp = new SitPose(r); expect(sp.ok).toBe(true);
    // Option C chair (seat 0.195 m): this rig's hips at 0.21 m: thigh nearly level, feet flat on the floor
    const hip = new THREE.Vector3(0.1, 0.21, 0.05); const AY = ANKLE_H; sp.apply(1, hip, 0, SIT_STYLES.chair); r.updateMatrixWorld(true);
    expect(P(r, 'Hips').distanceTo(hip)).toBeLessThan(1e-6);
    for (const s of ['Left', 'Right']) {
      const k = angle(P(r, s + 'UpLeg'), P(r, s + 'Leg'), P(r, s + 'Foot')); expect(k).toBeGreaterThan(80); expect(k).toBeLessThan(110);
      expect(P(r, s + 'Leg').z - P(r, s + 'UpLeg').z).toBeGreaterThan(0.11); // knee in front of the hip joint (facing +Z)
      expect(Math.abs(P(r, s + 'Foot').y - AY)).toBeLessThan(0.004); // feet planted: ankle at the planted height
    }
  });
  it('planted feet: the thigh droop is solved from the bone lengths, for any seat height the legs can reach', () => {
    const AY = ANKLE_H;
    for (const hy of [0.19, 0.22, 0.25, 0.29]) { const r = rig(); new SitPose(r).apply(1, new THREE.Vector3(0, hy, 0), 0, SIT_STYLES.chair); r.updateMatrixWorld(true);
      expect(Math.abs(P(r, 'LeftFoot').y - AY)).toBeLessThan(0.004); }
    expect(solveDroop(0.18, 0.09, 0.12, 0.09, 0)).toBeCloseTo(0, 9); expect(solveDroop(1, 0, 0.12, 0.09, 0)).toBeCloseTo((65 * Math.PI) / 180, 9); // out of reach: clamped
  });
  it('blends: weight 0 leaves the standing pose untouched, 0.5 is half-way', () => {
    const r = rig(); const sp = new SitPose(r); const k0 = P(r, 'LeftLeg');
    sp.apply(0, new THREE.Vector3(0, 0.5, 0), 0, SIT_STYLES.chair); r.updateMatrixWorld(true); expect(P(r, 'LeftLeg').distanceTo(k0)).toBeLessThan(1e-9);
    const r2 = rig(); new SitPose(r2).apply(0.5, new THREE.Vector3(0, 0.21, 0), 0, SIT_STYLES.chair); r2.updateMatrixWorld(true);
    const k = angle(P(r2, 'LeftUpLeg'), P(r2, 'LeftLeg'), P(r2, 'LeftFoot')); expect(k).toBeGreaterThan(110); expect(k).toBeLessThan(170);
  });
  it('follows the seat facing (yaw)', () => {
    const r = rig(); new SitPose(r).apply(1, new THREE.Vector3(0, 0.3, 0), Math.PI / 2, SIT_STYLES.stool); r.updateMatrixWorld(true);
    expect(P(r, 'LeftLeg').x - P(r, 'LeftUpLeg').x).toBeGreaterThan(0.1); // yaw 90° -> knees towards +X
  });
});
describe('posed seat anchors', () => {
  const seat: Seat = { id: 'a:0', pos: new THREE.Vector3(1, 0, 1), yaw: 0, front: new THREE.Vector3(1, 0, 1.4), pose: 'sit', h: 0.522, hip: new THREE.Vector3(1, 0, 1.09), kind: 'stool' };
  it('pelvis on the measured seat height, feet/shadow root on the floor', () => {
    expect(posedSeat(seat)).toBe(true); expect(sitHip(seat, new THREE.Vector3()).y).toBeCloseTo(0.522 + SEAT_CLEAR);
    const r = posedRoot(seat, new THREE.Vector3()); expect(r.y).toBe(0); expect(r.z).toBeGreaterThan(1.09);
  });
  it('legacy seats (no measured data) and beds to lie on are not posed', () => {
    expect(posedSeat({ ...seat, h: undefined, hip: undefined })).toBe(false); expect(posedSeat({ ...seat, pose: 'lie' })).toBe(false);
  });
});
