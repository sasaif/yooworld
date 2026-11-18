import * as THREE from 'three';
/**
 * Procedural seated pose on the existing Mixamo skeleton (the library's SitDown clip, once retargeted onto the chibi
 * bodies, ends with straight legs: the avatar looked "standing" on chairs and stools, measured Nov 2026 in
 * tools/pose-probe.mjs: knees only 5 cm in front of the hips).
 *
 * Layer applied AFTER the mixer (base = the breathing Idle clip), weight w in [0,1] for smooth in/out blends:
 *  1. the Hips bone is planted on the seat point (pelvis on the cushion, idle sway removed);
 *  2. each limb bone is aimed (minimal rotation, so knees and elbows bend the natural way) at a target direction
 *     expressed in the seat frame: thighs forward (slight droop), shins down (tucked back on high stools),
 *     upper arms down along the body, forearms forward so the hands rest on the lap.
 * Allocation-free per frame (module scratch objects), only touches ~12 bones.
 */
export interface SitStyle { droop: number; shinBack: number; splay: number; footDown: number; lean: number }
const D = Math.PI / 180;
/** Head nod when lying (rad): chin towards the chest so the big chibi head rests on the pillow. */
export const LIE_NOD = 22 * D;
/** Per seat kind. Chibi legs are short (hip joint -> sole ≈ 0.30 m at scale 1.14): on a 0.29 m chair the feet dangle
 *  a little above the floor, and nobody can reach the bar stool rung (0.17 m) from a 0.52 m seat. */
export const SIT_STYLES: Record<'chair' | 'stool' | 'sofa' | 'bed', SitStyle> = {
  chair: { droop: 4 * D, shinBack: -4 * D, splay: 0.08, footDown: 0, lean: 0 },
  sofa: { droop: 0, shinBack: -12 * D, splay: 0.1, footDown: 0, lean: -4 * D },
  bed: { droop: 2 * D, shinBack: -8 * D, splay: 0.08, footDown: 0, lean: 0 },
  stool: { droop: 2 * D, shinBack: 5 * D, splay: 0.12, footDown: 12 * D, lean: 3 * D },
};
type Limb = { bone: THREE.Bone; child: THREE.Object3D };
const _p = new THREE.Vector3(), _c = new THREE.Vector3(), _cur = new THREE.Vector3(), _des = new THREE.Vector3(), _s = new THREE.Vector3();
const _F = new THREE.Vector3(), _L = new THREE.Vector3(), _U = new THREE.Vector3(0, 1, 0), _t = new THREE.Vector3();
const _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _pqi = new THREE.Quaternion(), _id = new THREE.Quaternion();

export class SitPose {
  hips: THREE.Bone | null; spine: THREE.Bone | null; neck: THREE.Bone | null;
  legs: { up: Limb; low: Limb; foot: Limb; side: number }[] = []; arms: { up: Limb; low: Limb; side: number }[] = [];
  constructor(root: THREE.Object3D) {
    const b = (n: string) => root.getObjectByName(n) as THREE.Bone | undefined;
    this.hips = b('Hips') ?? null; this.spine = b('Spine') ?? null; this.neck = b('Neck') ?? null;
    for (const [s, side] of [['Left', 1], ['Right', -1]] as const) {
      const up = b(s + 'UpLeg'), low = b(s + 'Leg'), foot = b(s + 'Foot'), toe = b(s + 'ToeBase');
      if (up && low && foot && toe) this.legs.push({ up: { bone: up, child: low }, low: { bone: low, child: foot }, foot: { bone: foot, child: toe }, side });
      const ua = b(s + 'Arm'), fa = b(s + 'ForeArm'), hand = b(s + 'Hand');
      if (ua && fa && hand) this.arms.push({ up: { bone: ua, child: fa }, low: { bone: fa, child: hand }, side });
    }
  }
  get ok() { return !!this.hips && this.legs.length === 2; }
  /** Rotate `l.bone` (minimal arc, weight w) so that bone -> child points along `dir` (world, unit). */
  private aim(l: Limb, dir: THREE.Vector3, w: number) {
    const bone = l.bone; _p.setFromMatrixPosition(bone.matrixWorld); _c.setFromMatrixPosition(l.child.matrixWorld);
    _cur.subVectors(_c, _p); if (_cur.lengthSq() < 1e-10) return; _cur.normalize();
    _q.setFromUnitVectors(_cur, dir); if (w < 1) _q.copy(_id.identity().slerp(_q, w));
    bone.parent!.matrixWorld.decompose(_t, _pq, _s); _pqi.copy(_pq).invert();
    // local' = P^-1 · Δ · P · local
    bone.quaternion.premultiply(_q.premultiply(_pqi).multiply(_pq));
    bone.updateWorldMatrix(false, true);
  }
  /** Rotate a bone about a world axis by `angle` (weight already applied). */
  private bend(bone: THREE.Bone, axis: THREE.Vector3, angle: number) {
    _q.setFromAxisAngle(axis, angle); bone.parent!.matrixWorld.decompose(_t, _pq, _s); _pqi.copy(_pq).invert();
    bone.quaternion.premultiply(_q.premultiply(_pqi).multiply(_pq)); bone.updateWorldMatrix(false, true);
  }
  /**
   * Lying on the back (the whole avatar group is already pitched onto its back by the caller). `q` = world rotation of
   * the avatar group, so body-frame directions are: up = towards the head, forward = towards the ceiling.
   * Head nods forward onto the pillow (the chibi head is deep: without this the back of the head digs into the bed
   * or the body floats), legs straight with soft knees, arms relaxed along the body.
   */
  applyLie(w: number, q: THREE.Quaternion) {
    if (w <= 0.001 || !this.ok) return;
    this.hips!.updateWorldMatrix(true, true);
    _U.set(0, 1, 0).applyQuaternion(q); _F.set(0, 0, 1).applyQuaternion(q);
    _L.setFromMatrixPosition(this.legs[0].up.bone.matrixWorld).sub(_c.setFromMatrixPosition(this.legs[1].up.bone.matrixWorld)).normalize();
    if (this.neck) this.bend(this.neck, _L, LIE_NOD * w);
    for (const g of this.legs) {
      _des.copy(_U).multiplyScalar(-Math.cos(16 * D)).addScaledVector(_F, -Math.sin(16 * D)).addScaledVector(_L, g.side * 0.06).normalize(); this.aim(g.up, _des, w);
      _des.copy(_U).multiplyScalar(-Math.cos(2 * D)).addScaledVector(_F, -Math.sin(2 * D)).normalize(); this.aim(g.low, _des, w);
    }
    for (const a of this.arms) {
      _des.copy(_U).multiplyScalar(-0.95).addScaledVector(_L, a.side * 0.28).addScaledVector(_F, 0.05).normalize(); this.aim(a.up, _des, w);
      _des.copy(_U).multiplyScalar(-0.85).addScaledVector(_F, 0.35).addScaledVector(_L, a.side * 0.1).normalize(); this.aim(a.low, _des, w);
    }
  }
  /** Apply the layer. `hip` = world point where the Hips bone must sit, `yaw` = seat facing, w = blend weight. */
  apply(w: number, hip: THREE.Vector3, yaw: number, st: SitStyle) {
    if (w <= 0.001 || !this.ok) return;
    const hips = this.hips!; hips.parent!.updateWorldMatrix(true, false);
    _t.copy(hip); hips.parent!.worldToLocal(_t); hips.position.lerp(_t, w); hips.updateWorldMatrix(false, true);
    _F.set(Math.sin(yaw), 0, Math.cos(yaw));
    // lateral axis from the skeleton itself (+ = the avatar's left)
    _L.setFromMatrixPosition(this.legs[0].up.bone.matrixWorld).sub(_c.setFromMatrixPosition(this.legs[1].up.bone.matrixWorld)); _L.y = 0; _L.normalize();
    if (this.spine && st.lean) { // small lean: rotate the spine about the lateral axis
      _q.setFromAxisAngle(_L, st.lean * w); const sp = this.spine; sp.parent!.matrixWorld.decompose(_t, _pq, _s); _pqi.copy(_pq).invert();
      sp.quaternion.premultiply(_q.premultiply(_pqi).multiply(_pq)); sp.updateWorldMatrix(false, true);
    }
    for (const g of this.legs) {
      // thigh: forward, a little down, knees slightly apart
      _des.copy(_F).multiplyScalar(Math.cos(st.droop)).addScaledVector(_U, -Math.sin(st.droop)).addScaledVector(_L, g.side * st.splay).normalize();
      this.aim(g.up, _des, w);
      // shin: down, tucked back under the seat by shinBack
      _des.copy(_U).multiplyScalar(-Math.cos(st.shinBack)).addScaledVector(_F, -Math.sin(st.shinBack)).addScaledVector(_L, g.side * st.splay * 0.5).normalize();
      this.aim(g.low, _des, w);
      if (st.footDown) { // relaxed dangling feet: toes point a bit more down
        _des.copy(_F).multiplyScalar(Math.cos(0.8 + st.footDown)).addScaledVector(_U, -Math.sin(0.8 + st.footDown)).normalize(); this.aim(g.foot, _des, w);
      }
    }
    for (const a of this.arms) {
      // upper arm down along the side, slightly forward; forearm forward/down, hands towards the thighs
      _des.copy(_U).multiplyScalar(-0.9).addScaledVector(_F, 0.32).addScaledVector(_L, a.side * 0.12).normalize(); this.aim(a.up, _des, w);
      _des.copy(_F).multiplyScalar(0.85).addScaledVector(_U, -0.5).addScaledVector(_L, -a.side * 0.3).normalize(); this.aim(a.low, _des, w);
    }
  }
}
