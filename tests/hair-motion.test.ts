import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { attachTie, chainAngleDeg, resetRig, rigHair, setRigEnabled, skinHairGeometry, stepRig, type HairRigDesc } from '../src/render/avatar/hair/hairRig';
import { deg, hairMotionPlan, HEADPHONES_SIDE_MAX, MOVING_STYLES } from '../src/render/avatar/hair/descriptors';
import type { Prepared } from '../src/render/avatar/custom/source';
import type { HairStyle } from '../src/fashion/types';

// a cranium-sized cap + one hanging "tail" below/behind it, in Head-attachment space (+Z = back, like the avatars)
function hairGeo() {
  const cap = new THREE.SphereGeometry(0.12, 16, 12); cap.translate(0, 1.5, 0);
  const tail = new THREE.CylinderGeometry(0.03, 0.02, 0.2, 8, 6); tail.translate(0, 1.4, 0.15);
  const g = new THREE.BufferGeometry(); const a = cap.toNonIndexed(), b = tail.toNonIndexed();
  const p = new Float32Array([...(a.getAttribute('position').array as Float32Array), ...(b.getAttribute('position').array as Float32Array)]);
  g.setAttribute('position', new THREE.BufferAttribute(p, 3)); return g;
}
const desc: HairRigDesc = { id: 'test', chains: [{ name: 'tail', pivot: [0, 1.5, 0.15], tip: [0, 1.3, 0.15],
  region: { kind: 'sphere', center: [0, 1.4, 0.15], radius: 0.13, inner: 0.85, out: [0, -1, 0], ramp: 0.02 },
  freq: 2.4, zeta: 0.65, inertia: 0.4, drag: deg(3), dragMax: deg(6), limit: { side: deg(8), back: deg(10), fwd: deg(4), up: deg(4) } }] };
function rig(opts = {}) {
  const scene = new THREE.Scene(); const head = new THREE.Group(); scene.add(head); const attach = new THREE.Group(); head.add(attach);
  const mesh = new THREE.Mesh(hairGeo(), new THREE.MeshBasicMaterial()); attach.add(mesh); return { head, r: rigHair(mesh, desc, opts) };
}
const run = (head: THREE.Object3D, r: ReturnType<typeof rig>['r'], secs: number, f: (t: number) => void) => { let peak = 0; for (let t = 0; t < secs; t += 1 / 60) { f(t); head.updateMatrixWorld(true); stepRig(r, 1 / 60); peak = Math.max(peak, chainAngleDeg(r.chains[0])); } return peak; };

describe('hair motion: skinning', () => {
  it('weights sum to 1, root keeps the cap rigid, the tail is weighted to its bone', () => {
    const g = skinHairGeometry(hairGeo(), desc); const w = g.getAttribute('skinWeight'), si = g.getAttribute('skinIndex'), p = g.getAttribute('position');
    let tailHits = 0;
    for (let i = 0; i < w.count; i++) {
      expect(Math.abs(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i) - 1)).toBeLessThan(1e-5);
      if (p.getY(i) > 1.55) expect(w.getX(i)).toBeCloseTo(1, 5); // top of the cap: 100 % rigid root
      if (p.getY(i) < 1.33 && p.getZ(i) > 0.1 && si.getY(i) === 1 && w.getY(i) > 0.9) tailHits++;
    }
    expect(tailHits).toBeGreaterThan(5);
  });
  it('the skinned geometry is cached per (geometry, descriptor)', () => { const g = hairGeo(); expect(skinHairGeometry(g, desc)).toBe(skinHairGeometry(g, desc)); });
  it('at rest the skinned copy is the rigid mesh (bones identity), rigid mesh hidden, kept for the fallback', () => {
    const { r } = rig(); expect(r.mesh.visible).toBe(true); expect(r.rigid.visible).toBe(false); expect(r.bones.map((b) => b.name)).toEqual(['hair_root', 'hair_tail']);
    expect(r.chains[0].bone.quaternion.equals(new THREE.Quaternion())).toBe(true);
    setRigEnabled(r, false); expect(r.mesh.visible).toBe(false); expect(r.rigid.visible).toBe(true); setRigEnabled(r, true); expect(r.mesh.visible).toBe(true);
  });
});

describe('hair motion: springs', () => {
  it('idle: exactly zero motion (no jitter)', () => { const { head, r } = rig(); expect(run(head, r, 3, () => {})).toBe(0); });
  it('walk / turn: subtle bounded swing, then smooth return to rest in < 1 s', () => {
    const { head, r } = rig(); const L = r.chains[0].lim; const lim = (Math.max(L.side, L.back, L.fwd, L.up) * 180) / Math.PI;
    const walk = run(head, r, 2, (t) => { head.position.z = -1.2 * t; });          // walk forward (−Z) at 1.2 m/s
    expect(walk).toBeGreaterThan(1); expect(walk).toBeLessThan(lim + 1.5);
    const turn = run(head, r, 1, (t) => { head.rotation.y = Math.min(1, t / 0.4) * Math.PI / 2; head.position.z -= 1.2 / 60; });
    expect(turn).toBeGreaterThan(1); expect(turn).toBeLessThan(lim + 1.5);
    let t0 = -1; for (let t = 0; t < 2; t += 1 / 60) { head.updateMatrixWorld(true); stepRig(r, 1 / 60); if (t0 < 0 && chainAngleDeg(r.chains[0]) < 0.5) t0 = t; }
    expect(t0).toBeGreaterThanOrEqual(0); expect(t0).toBeLessThan(1); expect(chainAngleDeg(r.chains[0])).toBeLessThan(0.1);
  });
  it('a teleport (jump) does not whip the hair: chain re-initialised at rest', () => {
    const { head, r } = rig(); run(head, r, 0.5, () => {}); head.position.x += 30; head.updateMatrixWorld(true); stepRig(r, 1 / 60); expect(chainAngleDeg(r.chains[0])).toBe(0);
  });
  it('reset snaps every bone to rest', () => { const { head, r } = rig(); run(head, r, 1, (t) => { head.position.z = -1.9 * t; }); resetRig(r); expect(chainAngleDeg(r.chains[0])).toBe(0); });
  it('headphones cap the sideways swing at 4°; hat stiffens and shrinks the clamps', () => {
    const p = rig({ sideMax: HEADPHONES_SIDE_MAX }).r; expect(p.chains[0].lim.side).toBeCloseTo(deg(4));
    const h = rig({ stiff: 1.3, clampK: 0.7 }).r; expect(h.stiff).toBe(1.3); expect(h.chains[0].lim.back).toBeCloseTo(deg(7));
    const { head, r } = rig({ sideMax: HEADPHONES_SIDE_MAX });
    const side = run(head, r, 1.5, (t) => { head.position.x = Math.sin(t * 9) * 0.25; }); // violent sideways shake
    expect(side).toBeLessThan(4 + 4 + 0.5); // side ≤ 4°, combined with the back/up components
  });
  it('a hair tie rides its chain bone and keeps its rest transform', () => {
    const { r } = rig(); const tie = new THREE.Mesh(); tie.position.set(0, 1.49, 0.15); r.attach.add(tie); tie.updateMatrixWorld(true);
    const before = new THREE.Vector3().setFromMatrixPosition(tie.matrixWorld);
    expect(attachTie(r, tie)).toBe('tail'); expect(tie.parent).toBe(r.chains[0].bone); r.attach.updateMatrixWorld(true);
    expect(new THREE.Vector3().setFromMatrixPosition(tie.matrixWorld).distanceTo(before)).toBeLessThan(1e-6);
  });
});

// minimal Prepared stand-in for the descriptor maths (Juanita-like proportions)
const bunG = (() => { const a = new THREE.SphereGeometry(0.05, 8, 6); a.translate(0.13, 1.62, 0.05); const b = new THREE.SphereGeometry(0.05, 8, 6); b.translate(-0.13, 1.62, 0.05);
  const p = [...(a.toNonIndexed().getAttribute('position').array as Float32Array), ...(b.toNonIndexed().getAttribute('position').array as Float32Array)]; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g; })();
const P = { cranium: new THREE.Vector3(0, 1.5, 0.01), headRadius: () => 0.12, buns: bunG,
  parts: { vertexCount: 1234, features: { neck: [0, 1.3, 0], mouth: [0, 1.42, -0.1], headTop: [0, 1.64, 0] } } } as unknown as Prepared;

describe('hair motion: descriptors and plan', () => {
  it('every moving style gets springs; short styles stay static', () => {
    for (const st of MOVING_STYLES) { const p = hairMotionPlan(st, false, false, P, P); expect(p, st).not.toBeNull(); expect(p!.desc.chains.length).toBeGreaterThan(0); }
    for (const st of ['quiff', 'afro', 'mohawk', 'buzz'] as HairStyle[]) expect(hairMotionPlan(st, false, false, P, P)).toBeNull();
  });
  it('chain counts: buns 2, long 3, bob 3, pony 1, pigtails 2, braids 2, bun_high 1, manbun 1', () => {
    const n = Object.fromEntries(MOVING_STYLES.map((s) => [s, hairMotionPlan(s, false, false, P, P)!.desc.chains.length]));
    expect(n).toEqual({ buns: 2, long: 3, bob: 3, pony: 1, pigtails: 2, braids: 2, bun_high: 1, manbun: 1 });
  });
  it('under a hat: buns / bun_high / manbun are static, hanging styles are stiffer with smaller clamps', () => {
    for (const st of ['buns', 'bun_high', 'manbun'] as HairStyle[]) expect(hairMotionPlan(st, true, false, P, P)).toBeNull();
    const l = hairMotionPlan('long', true, false, P, P)!; expect(l.opts.stiff).toBe(1.3); expect(l.opts.clampK).toBe(0.7);
  });
  it('headphones: side clamp 4° on every moving style', () => {
    for (const st of MOVING_STYLES) expect(hairMotionPlan(st, false, true, P, P)!.opts.sideMax).toBeCloseTo(deg(4));
    expect(hairMotionPlan('long', false, false, P, P)!.opts.sideMax).toBeUndefined();
  });
  it('limits stay subtle (≤ 12° per axis on any style)', () => {
    for (const st of MOVING_STYLES) for (const c of hairMotionPlan(st, false, false, P, P)!.desc.chains) for (const v of Object.values(c.limit)) expect(v).toBeLessThanOrEqual(deg(12) + 1e-9);
  });
});
