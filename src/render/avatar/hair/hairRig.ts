import * as THREE from 'three';
/**
 * Secondary hair motion (springs) for the procedural YoLand hairstyles.
 *
 * The merged rigid hair Mesh (child of the Head attachment group) is mirrored ONCE per (hair geometry, descriptor) by a
 * SkinnedMesh with 1..3 tiny "virtual" bones living under the same attachment group. Skin weights come from a small data
 * descriptor (regions: sphere for buns / tails / braids, curtain window for long hair): no asset, no Blender work, no save
 * change. At rest every bone is the identity, so the skinned copy is vertex-for-vertex the rigid mesh.
 * Each bone is driven by a damped spring on its tip offset, in world space:
 *   - near-critical damping (ζ 0.6..0.7) → smooth return to rest, no cartoon bounce
 *   - head acceleration × inertia → lag on acceleration, deceleration and turns
 *   - a small speed-proportional backward "air drag" lean (smoothed, τ 0.25 s)
 *   - per-axis clamps in head space (side / back / forward / up) → no clipping into the face, neck or chest
 * Zero allocations per frame. The rigid mesh is kept (hidden) as an instant static fallback.
 */
export type V3 = [number, number, number];
export type Region =
  /** weight = sphere falloff (1 inside radius*inner, 0 at radius) × ramp along `out` measured from the pivot */
  | { kind: 'sphere'; center: V3; radius: number; inner: number; out: V3; ramp: number }
  /** hanging sheet around the cranium: azimuth window (rad, 0 = front −Z, π = back +Z) × height ramp yStart→yEnd */
  | { kind: 'curtain'; cranium: V3; azC: number; azHalf: number; yStart: number; yEnd: number; group: string };
export interface ChainLimit { side: number; back: number; fwd: number; up: number }
export interface ChainDesc {
  name: string; pivot: V3; tip: V3; region: Region;
  /** spring natural frequency (Hz) and damping ratio */ freq: number; zeta: number;
  /** backward swing per m/s of head speed (rad), capped at dragMax (rad) */ drag: number; dragMax: number;
  /** 0..1 share of the head acceleration felt by the hair (lower = calmer) */ inertia: number;
  /** clamps (rad, head space): |side|, back (+Z), forward (−Z), up (+Y) */ limit: ChainLimit;
}
export interface HairRigDesc { id: string; chains: ChainDesc[] }
/** per-instance modifiers (hat: stiffer + smaller clamps; headphones: side clamp cap) */
export interface RigOpts { stiff?: number; clampK?: number; sideMax?: number }

const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const geoCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

/** Clone the hair geometry once per (geometry, descriptor id) and add skinIndex / skinWeight (bone 0 = rigid root).
 *  The hair geometries are cached by the builders, so the skinned copies are shared too (never disposed per avatar). */
export function skinHairGeometry(src: THREE.BufferGeometry, desc: HairRigDesc): THREE.BufferGeometry {
  let m = geoCache.get(src); if (!m) { m = new Map(); geoCache.set(src, m); }
  const hit = m.get(desc.id); if (hit) return hit;
  const g = src.clone(); const pos = g.getAttribute('position'); const n = pos.count; const nc = desc.chains.length;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4); const v = new THREE.Vector3(), d = new THREE.Vector3(), o = new THREE.Vector3();
  const raw = new Float32Array(nc), azw = new Float32Array(nc); const groupSum = new Map<string, number>(); const w: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i); groupSum.clear();
    for (let k = 0; k < nc; k++) {
      const c = desc.chains[k]; const r = c.region; raw[k] = 0; azw[k] = 1;
      if (r.kind === 'sphere') {
        const dist = v.distanceTo(d.set(...r.center)); const fall = 1 - ss(r.radius * r.inner, r.radius, dist);
        const along = d.set(v.x - c.pivot[0], v.y - c.pivot[1], v.z - c.pivot[2]).dot(o.set(...r.out));
        raw[k] = fall * ss(0, r.ramp, along);
      } else {
        const az = Math.atan2(v.x - r.cranium[0], -(v.z - r.cranium[2])); let da = Math.abs(az - r.azC) % (2 * Math.PI); if (da > Math.PI) da = 2 * Math.PI - da;
        azw[k] = 1 - ss(r.azHalf * 0.35, r.azHalf, da); raw[k] = ss(r.yStart, r.yEnd, v.y);
        groupSum.set(r.group, (groupSum.get(r.group) ?? 0) + azw[k]);
      }
    }
    // normalise the azimuth windows inside a curtain group, then keep the 3 strongest chains + the rigid root
    w.length = 0;
    for (let k = 0; k < nc; k++) { const r = desc.chains[k].region; const a = r.kind === 'curtain' ? azw[k] / Math.max(1e-6, groupSum.get(r.group)!) : 1; const x = raw[k] * a; if (x > 1e-3) w.push([k + 1, x]); }
    w.sort((a, b) => b[1] - a[1]); if (w.length > 3) w.length = 3;
    let tot = 0; for (const x of w) tot += x[1]; if (tot > 1) { for (const x of w) x[1] /= tot; tot = 1; }
    si[i * 4] = 0; sw[i * 4] = 1 - tot; for (let j = 0; j < w.length; j++) { si[i * 4 + 1 + j] = w[j][0]; sw[i * 4 + 1 + j] = w[j][1]; }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  m.set(desc.id, g); return g;
}

export interface ChainState {
  c: ChainDesc; bone: THREE.Bone; pivot: THREE.Vector3; tip: THREE.Vector3; rest: THREE.Vector3; len: number; lim: ChainLimit;
  e: THREE.Vector3; ev: THREE.Vector3; prevT: THREE.Vector3; vT: THREE.Vector3; drag: THREE.Vector3; init: boolean; fresh: boolean;
}
export interface HairRig {
  id: string; mesh: THREE.SkinnedMesh; rigid: THREE.Mesh; attach: THREE.Object3D; chains: ChainState[]; bones: THREE.Bone[];
  /** false = static fallback (rigid mesh shown, springs off) */ enabled: boolean; stiff: number;
  /** objects (hair ties) carried by a chain bone */ ties: THREE.Object3D[];
  /** peak angle (deg) per chain since the last `resetPeaks` (debug / e2e) */ peak: number[];
}

/** Replace the rigid hair Mesh (child of the Head attachment group) by a skinned copy driven by the descriptor. */
export function rigHair(hair: THREE.Mesh, desc: HairRigDesc, opts: RigOpts = {}): HairRig {
  const attach = hair.parent!; const geo = skinHairGeometry(hair.geometry, desc);
  const clampK = opts.clampK ?? 1; const root = new THREE.Bone(); root.name = 'hair_root'; attach.add(root);
  const bones = [root]; const inv = [new THREE.Matrix4()];
  const chains: ChainState[] = desc.chains.map((c) => {
    const b = new THREE.Bone(); b.name = 'hair_' + c.name; b.position.set(...c.pivot); attach.add(b); bones.push(b);
    inv.push(new THREE.Matrix4().makeTranslation(-c.pivot[0], -c.pivot[1], -c.pivot[2]));
    const pivot = new THREE.Vector3(...c.pivot), tip = new THREE.Vector3(...c.tip); const rest = tip.clone().sub(pivot); const len = rest.length(); rest.normalize();
    const L = c.limit; const side = Math.min(L.side * clampK, opts.sideMax ?? Infinity);
    return { c, bone: b, pivot, tip, rest, len, lim: { side, back: L.back * clampK, fwd: L.fwd * clampK, up: L.up * clampK },
      e: new THREE.Vector3(), ev: new THREE.Vector3(), prevT: new THREE.Vector3(), vT: new THREE.Vector3(), drag: new THREE.Vector3(), init: false, fresh: true };
  });
  const mesh = new THREE.SkinnedMesh(geo, hair.material); mesh.name = 'hair_skinned'; mesh.castShadow = hair.castShadow; mesh.receiveShadow = hair.receiveShadow;
  mesh.frustumCulled = false; mesh.userData.hairMotion = true;
  mesh.bind(new THREE.Skeleton(bones, inv), new THREE.Matrix4());
  attach.add(mesh); hair.visible = false; // the rigid mesh stays in place (untouched) for an instant static fallback
  return { id: desc.id, mesh, rigid: hair, attach, chains, bones, enabled: true, stiff: opts.stiff ?? 1, ties: [], peak: chains.map(() => 0) };
}

/** Carry a hair tie (authored in Head-attachment space at `pos`) on the chain whose root is closest, so it follows the
 *  tail it ties instead of staying on the head. Keeps its exact rest transform. Returns the chain name, or null. */
export function attachTie(rig: HairRig, tie: THREE.Object3D, maxDist = 0.06): string | null {
  let best: ChainState | null = null, bd = maxDist;
  for (const s of rig.chains) { const d = s.pivot.distanceTo(tie.position); if (d < bd) { bd = d; best = s; } }
  if (!best) return null;
  tie.position.sub(best.pivot); best.bone.add(tie); rig.ties.push(tie); return best.c.name;
}

/** Snap every chain to rest (teleport, sit / stand, rebuild, culled). */
export function resetRig(rig: HairRig) {
  for (const s of rig.chains) { s.init = false; s.bone.quaternion.identity(); }
}
/** Static fallback on/off: the rigid mesh is drawn instead of the skinned copy (identical at rest). */
export function setRigEnabled(rig: HairRig, on: boolean) {
  if (rig.enabled === on) return; rig.enabled = on; resetRig(rig); rig.mesh.visible = on; rig.rigid.visible = !on;
  // ties follow the visible mesh: back on the head attachment when static (bone at identity = same transform anyway)
}
export const chainAngleDeg = (s: ChainState) => (2 * Math.acos(Math.min(1, Math.abs(s.bone.quaternion.w))) * 180) / Math.PI;
export function resetPeaks(rig: HairRig) { rig.peak.fill(0); }

// ---- allocation-free stepping ----
const _M = new THREE.Matrix4(), _iM = new THREE.Matrix4(), _P = new THREE.Vector3(), _T = new THREE.Vector3(), _vp = new THREE.Vector3(), _a = new THREE.Vector3(),
  _d = new THREE.Vector3(), _dl = new THREE.Vector3();
const SUB_DT = 1 / 60, MAX_SUB = 4, ACC_MAX = 12, TELEPORT_V = 12;

/** Advance the springs of one rig by dt (call AFTER the animation mixer / sit pose of its avatar, BEFORE render). */
export function stepRig(r: HairRig, dt: number) {
  if (dt <= 0 || !r.enabled) return;
  r.attach.updateWorldMatrix(true, false); _M.copy(r.attach.matrixWorld); _iM.copy(_M).invert();
  for (let i = 0; i < r.chains.length; i++) { const s = r.chains[i]; step(s, dt, r.stiff); const a = chainAngleDeg(s); if (a > r.peak[i]) r.peak[i] = a; }
}

function step(s: ChainState, dt: number, stiff: number) {
  // spring on the OFFSET e = tip − target (world). The target tip T is the rest tip carried rigidly by the head;
  // e is driven by −(target acceleration): inertia → lag on acceleration, smooth return on stop, lag on turns.
  const c = s.c; _P.copy(s.pivot).applyMatrix4(_M); _T.copy(s.tip).applyMatrix4(_M); const lenW = _T.distanceTo(_P);
  // (re)initialise: first frame, long hitch, or a jump faster than any gait (teleport / travel / seat snap)
  if (!s.init || dt > 0.25 || _T.distanceTo(s.prevT) / dt > TELEPORT_V) {
    s.e.set(0, 0, 0); s.ev.set(0, 0, 0); s.prevT.copy(_T); s.vT.set(0, 0, 0); s.drag.set(0, 0, 0); s.init = true; s.fresh = true; s.bone.quaternion.identity(); return;
  }
  _vp.copy(_T).sub(s.prevT).divideScalar(dt); s.prevT.copy(_T);              // target velocity
  if (s.fresh) { s.vT.copy(_vp); s.fresh = false; }
  _a.copy(_vp).sub(s.vT).divideScalar(dt); s.vT.copy(_vp);                    // target acceleration
  _a.multiplyScalar(c.inertia); const am = _a.length(); if (am > ACC_MAX) _a.multiplyScalar(ACC_MAX / am); // clamp spikes
  // air drag: gentle backward lean proportional to the horizontal speed, smoothed (τ ≈ 0.25 s)
  const hv = Math.hypot(_vp.x, _vp.z); const off = hv > 1e-3 ? (Math.min(c.dragMax, c.drag * hv) * lenW) / hv : 0;
  const kd = 1 - Math.exp(-dt / 0.25); s.drag.x += (-_vp.x * off - s.drag.x) * kd; s.drag.z += (-_vp.z * off - s.drag.z) * kd; s.drag.y = 0;
  const w = 2 * Math.PI * c.freq * stiff, k = w * w, cd = 2 * c.zeta * w;
  const n = Math.min(MAX_SUB, Math.ceil(dt / SUB_DT)); const h = Math.min(dt, n * SUB_DT) / n;
  for (let i = 0; i < n; i++) { _d.copy(s.e).multiplyScalar(-k).addScaledVector(s.ev, -cd).sub(_a); s.ev.addScaledVector(_d, h); s.e.addScaledVector(s.ev, h); }
  // desired tip = target + drag + offset → head space, clamp per axis, back to a world offset
  _d.copy(_T).add(s.drag).add(s.e);
  _dl.copy(_d).applyMatrix4(_iM).sub(s.pivot).normalize(); _d.copy(_dl).sub(s.rest);
  const L = s.lim; let clamped = false;
  if (_d.x > L.side) { _d.x = L.side; clamped = true; } else if (_d.x < -L.side) { _d.x = -L.side; clamped = true; }
  if (_d.z > L.back) { _d.z = L.back; clamped = true; } else if (_d.z < -L.fwd) { _d.z = -L.fwd; clamped = true; }
  if (_d.y > L.up) { _d.y = L.up; clamped = true; }
  _dl.copy(s.rest).add(_d).normalize();
  if (clamped) { _d.copy(_dl).multiplyScalar(s.len).add(s.pivot).applyMatrix4(_M).sub(_T).sub(s.drag); s.e.copy(_d); s.ev.multiplyScalar(0.5); }
  // no idle jitter: sub-0.05° deflections are snapped to the exact rest pose
  if (1 - _dl.dot(s.rest) < 4e-7) { s.bone.quaternion.identity(); return; }
  s.bone.quaternion.setFromUnitVectors(s.rest, _dl);
}
