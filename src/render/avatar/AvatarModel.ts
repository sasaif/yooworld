import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MIXAMO, QUATERNIUS_23, type RigMap } from './boneMaps';
import { retargetClip } from './retarget';
import { CLIPS, type AvatarDef, type ClipKey } from '../../data/avatars';

type GLTFLike = { scene: THREE.Group; animations: THREE.AnimationClip[] };
const RIGS: Record<string, RigMap> = { mixamo: MIXAMO };
const clipCache = new WeakMap<object, Record<ClipKey, THREE.AnimationClip>>();
const ARM = /(Shoulder|Arm|ForeArm|Hand)/;

/** Remove horizontal root motion: the controller moves the character. */
function inPlace(clip: THREE.AnimationClip) {
  clip.tracks.forEach((t) => {
    if (!t.name.endsWith('.position')) return;
    const v = t.values; const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  });
  return clip;
}

/** Retarget the shared library once per avatar body (cached). */
export function avatarClips(body: GLTFLike, lib: GLTFLike, def: AvatarDef) {
  const hit = clipCache.get(body); if (hit) return hit;
  const out = {} as Record<ClipKey, THREE.AnimationClip>;
  (Object.keys(CLIPS) as ClipKey[]).forEach((k) => {
    const src = lib.animations.find((a) => a.name === CLIPS[k]);
    if (!src) throw new Error('missing clip ' + CLIPS[k]);
    const { clip } = retargetClip(skeletonClone(lib.scene), src, QUATERNIUS_23, skeletonClone(body.scene), RIGS[def.rig], { name: k });
    out[k] = ['idle', 'walk', 'run', 'emote'].includes(k) ? inPlace(clip) : clip;
  });
  // Sitting: the library SitDown ends with an arm reaching for an armrest. Keep its legs/hips/spine
  // and take the arms from Idle so the pose reads as "relaxed on the sofa".
  const armsFromIdle = out.idle.tracks.filter((t) => ARM.test(t.name.split('.')[0]));
  for (const k of ['sit', 'stand'] as const) {
    const c = out[k];
    const keep = c.tracks.filter((t) => !ARM.test(t.name.split('.')[0]));
    out[k] = new THREE.AnimationClip(k, c.duration, [...keep, ...armsFromIdle.map((t) => t.clone())]);
  }
  clipCache.set(body, out);
  return out;
}

/** Lit, mobile-friendly material: Lambert keeps the painted texture look but reacts to room lights. */
export function litAvatarMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh; if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    const src = m.material as THREE.MeshStandardMaterial;
    m.material = new THREE.MeshLambertMaterial({ map: src.map, color: 0xffffff, vertexColors: !!m.geometry.getAttribute('color'), name: src.name });
  });
}

export function buildAvatar(body: GLTFLike, lib: GLTFLike, def: AvatarDef) {
  const root = skeletonClone(body.scene) as THREE.Group;
  litAvatarMaterials(root);
  const holder = new THREE.Group(); holder.add(root);
  if (def.facing === 'negZ') holder.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(root);
  const clips = avatarClips(body, lib, def);
  const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  (Object.keys(clips) as ClipKey[]).forEach((k) => {
    const a = mixer.clipAction(clips[k]);
    if (k === 'sit' || k === 'stand') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
    actions[k] = a;
  });
  return { holder, root, mixer, actions };
}
