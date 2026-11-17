import * as THREE from 'three';
import type { Canon, RigMap } from './boneMaps';

/**
 * Runtime retargeting of a clip authored for one humanoid rig onto another.
 * Method: world-space rotation deltas from the source rest pose, with a per-bone
 * "rest alignment" (swing) so that a T-pose source drives an A-pose target correctly.
 *   W_t(t) = G·W_s(t) · (G·W_s0)^-1 · C · W_t0
 * Hips translation is scaled by the ratio of hip heights. Output: a plain AnimationClip
 * with local quaternion tracks (+ hips position) for the target skeleton.
 */
// Bones whose absolute direction is matched to the source (limbs: fixes T-pose vs A-pose).
// Spine, neck, head and clavicles only receive the rotation *delta* from rest, so the target keeps its own posture.
const ALIGN = new Set<Canon>(['upperArmL', 'lowerArmL', 'upperArmR', 'lowerArmR', 'upperLegL', 'lowerLegL', 'upperLegR', 'lowerLegR', 'handL', 'handR', 'footL', 'footR']);
const NEXT: Partial<Record<Canon, Canon[]>> = {
  spine: ['chest', 'upperChest', 'neck'], chest: ['upperChest', 'neck', 'head'], upperChest: ['neck', 'head'], neck: ['head'],
  shoulderL: ['upperArmL'], upperArmL: ['lowerArmL'], lowerArmL: ['handL'],
  shoulderR: ['upperArmR'], upperArmR: ['lowerArmR'], lowerArmR: ['handR'],
  upperLegL: ['lowerLegL'], lowerLegL: ['footL'], upperLegR: ['lowerLegR'], lowerLegR: ['footR'],
};
const LEAF_PARENT: Partial<Record<Canon, Canon[]>> = {
  head: ['neck', 'upperChest', 'chest'], handL: ['lowerArmL'], handR: ['lowerArmR'], footL: ['lowerLegL'], footR: ['lowerLegR'],
};

export interface RetargetReport { clip: string; bones: number; frames: number; meanErrDeg: number; maxErrDeg: number; }

const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
function rootSpace(o: THREE.Object3D, rootInv: THREE.Matrix4) {
  _m.multiplyMatrices(rootInv, o.matrixWorld).decompose(_p, _q, _s);
  return { p: _p.clone(), q: _q.clone() };
}
function depth(o: THREE.Object3D) { let d = 0; while (o.parent) { d++; o = o.parent; } return d; }

export function retargetClip(
  srcRoot: THREE.Object3D, srcClip: THREE.AnimationClip, srcMap: RigMap,
  dstRoot: THREE.Object3D, dstMap: RigMap, opts: { fps?: number; name?: string } = {},
): { clip: THREE.AnimationClip; report: RetargetReport } {
  const fps = opts.fps ?? 30;
  srcRoot.updateMatrixWorld(true); dstRoot.updateMatrixWorld(true);
  const srcInv = srcRoot.matrixWorld.clone().invert(), dstInv = dstRoot.matrixWorld.clone().invert();
  const S: Partial<Record<Canon, THREE.Object3D>> = {}, D: Partial<Record<Canon, THREE.Object3D>> = {};
  const canons: Canon[] = [];
  (Object.keys(dstMap) as Canon[]).forEach((c) => {
    const s = srcMap[c] && srcRoot.getObjectByName(srcMap[c]!); const d = dstRoot.getObjectByName(dstMap[c]!);
    if (s && d) { S[c] = s; D[c] = d; canons.push(c); }
  });
  if (!canons.includes('hips')) throw new Error('retarget: hips not mapped');
  // rest data (both rigs must be in rest/bind pose here: pass fresh clones)
  const sR = {} as Record<Canon, { p: THREE.Vector3; q: THREE.Quaternion }>, dR = {} as typeof sR;
  canons.forEach((c) => { sR[c] = rootSpace(S[c]!, srcInv); dR[c] = rootSpace(D[c]!, dstInv); });
  // global yaw frame G from the leg axis (handles rigs facing different directions)
  const yaw = (r: typeof sR) => { const v = r.upperLegR && r.upperLegL ? r.upperLegR.p.clone().sub(r.upperLegL.p) : new THREE.Vector3(1, 0, 0); return Math.atan2(v.z, v.x); };
  const G = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw(sR) - yaw(dR));
  canons.forEach((c) => { sR[c].p.applyQuaternion(G); sR[c].q.premultiply(G); });
  // per-bone rest alignment C (swing from target rest direction onto source rest direction)
  const C = {} as Record<Canon, THREE.Quaternion>;
  const order = [...canons].sort((a, b) => depth(D[a]!) - depth(D[b]!));
  const dirPair = (c: Canon) => (NEXT[c] || []).find((n) => canons.includes(n));
  order.forEach((c) => {
    const n = dirPair(c); let q = new THREE.Quaternion();
    if (!ALIGN.has(c)) { C[c] = q; return; }
    if (n) {
      const ds = sR[n].p.clone().sub(sR[c].p), dt = dR[n].p.clone().sub(dR[c].p);
      if (ds.length() > 1e-5 && dt.length() > 1e-5) q.setFromUnitVectors(dt.normalize(), ds.normalize());
    } else if (!n) {
      const par = (LEAF_PARENT[c] || []).find((p) => C[p]); if (par) q = C[par].clone();
    }
    C[c] = q;
  });
  const hipK = dR.hips.p.y / Math.max(1e-6, sR.hips.p.y);
  const mixer = new THREE.AnimationMixer(srcRoot); const action = mixer.clipAction(srcClip); action.play();
  const frames = Math.max(2, Math.round(srcClip.duration * fps) + 1);
  const times = new Float32Array(frames);
  const qv: Record<string, Float32Array> = {}; canons.forEach((c) => (qv[c] = new Float32Array(frames * 4)));
  const pv = new Float32Array(frames * 3);
  const restLocal = canons.map((c) => ({ c, q: D[c]!.quaternion.clone(), p: D[c]!.position.clone() }));
  let errSum = 0, errMax = 0, errN = 0;
  const invSrcRest = {} as Record<Canon, THREE.Quaternion>; canons.forEach((c) => (invSrcRest[c] = sR[c].q.clone().invert()));
  for (let f = 0; f < frames; f++) {
    const t = Math.min(srcClip.duration, f / fps); times[f] = t;
    mixer.setTime(t); srcRoot.updateMatrixWorld(true);
    const sNow = {} as typeof sR; canons.forEach((c) => { const r = rootSpace(S[c]!, srcInv); r.p.applyQuaternion(G); r.q.premultiply(G); sNow[c] = r; });
    for (const c of order) {
      const bone = D[c]!;
      const Wt = sNow[c].q.clone().multiply(invSrcRest[c]).multiply(C[c]).multiply(dR[c].q);
      const par = bone.parent!; const pq = rootSpace(par, dstInv).q;
      const local = pq.invert().multiply(Wt).normalize();
      if (f > 0) { const o = f * 4 - 4; if (local.x * qv[c][o] + local.y * qv[c][o + 1] + local.z * qv[c][o + 2] + local.w * qv[c][o + 3] < 0) local.set(-local.x, -local.y, -local.z, -local.w); }
      bone.quaternion.copy(local); local.toArray(qv[c], f * 4);
      if (c === 'hips') {
        const want = dR.hips.p.clone().add(sNow.hips.p.clone().sub(sR.hips.p).multiplyScalar(hipK));
        par.updateMatrixWorld(true); const pm = _m.multiplyMatrices(dstInv, par.matrixWorld).invert();
        want.applyMatrix4(pm); bone.position.copy(want); want.toArray(pv, f * 3);
      }
      bone.updateMatrixWorld(true);
    }
    // quality metric: angle between source and target bone directions
    for (const c of canons) {
      const n = dirPair(c); if (!n || !ALIGN.has(c)) continue;
      const ds = sNow[n].p.clone().sub(sNow[c].p), dt = rootSpace(D[n]!, dstInv).p.sub(rootSpace(D[c]!, dstInv).p);
      if (ds.length() < 1e-5 || dt.length() < 1e-5) continue;
      const a = THREE.MathUtils.radToDeg(ds.normalize().angleTo(dt.normalize())); errSum += a; errN++; errMax = Math.max(errMax, a);
    }
  }
  restLocal.forEach(({ c, q, p }) => { D[c]!.quaternion.copy(q); D[c]!.position.copy(p); });
  action.stop(); mixer.uncacheRoot(srcRoot);
  const tracks: THREE.KeyframeTrack[] = canons.map((c) => new THREE.QuaternionKeyframeTrack(`${D[c]!.name}.quaternion`, times, qv[c]));
  tracks.push(new THREE.VectorKeyframeTrack(`${D.hips!.name}.position`, times, pv));
  const name = opts.name ?? srcClip.name;
  return { clip: new THREE.AnimationClip(name, srcClip.duration, tracks), report: { clip: name, bones: canons.length, frames, meanErrDeg: errN ? errSum / errN : 0, maxErrDeg: errMax } };
}
