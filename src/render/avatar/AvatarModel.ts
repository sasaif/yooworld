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

/** Rim light (fresnel) + a gentle self-lit lift so faces stay readable in shade: the characters pop
 *  out of the room and become the visual focus. One extra line of shader math, no extra pass. */
function addRim(m: THREE.MeshLambertMaterial, color = new THREE.Color('#fff0f6'), strength = 0.55) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rimColor = { value: color }; sh.uniforms.rimStrength = { value: strength };
    sh.fragmentShader = 'uniform vec3 rimColor; uniform float rimStrength;\n' + sh.fragmentShader.replace('#include <opaque_fragment>', `
      vec3 rimView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float rim = pow(1.0 - clamp(dot(normalize(normal), rimView), 0.0, 1.0), 2.6);
      outgoingLight += rimColor * rim * rimStrength;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'yw-rim';
}
/** Inverted-hull outline: a back-face, slightly inflated copy of the skinned mesh (1 extra draw call per avatar).
 *  Gives the stylised "cartoon" read of YoWorld-like games and separates the silhouette from the floor. */
function addOutline(mesh: THREE.SkinnedMesh, color = '#4a2c45', width = 0.004) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide });
  mat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>\n transformed += normalize(normal) * ${width.toFixed(4)};`); };
  mat.customProgramCacheKey = () => 'yw-outline';
  const o = new THREE.SkinnedMesh(mesh.geometry, mat); o.name = mesh.name + '_outline';
  o.bind(mesh.skeleton, mesh.bindMatrix); o.frustumCulled = false; o.castShadow = false; o.renderOrder = -1;
  if (mesh.morphTargetInfluences) o.morphTargetInfluences = mesh.morphTargetInfluences; // blink on the outline too
  o.morphTargetDictionary = mesh.morphTargetDictionary;
  mesh.parent!.add(o); o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
}

/** Lit, mobile-friendly material: Lambert keeps the painted texture look but reacts to room lights. */
export function litAvatarMaterials(root: THREE.Object3D, opts: { rim?: boolean; outline?: boolean } = { rim: true, outline: true }) {
  const skinned: THREE.SkinnedMesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.SkinnedMesh; if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
    const src = m.material as THREE.MeshStandardMaterial;
    if (src.map) { src.map.anisotropy = 4; src.map.needsUpdate = true; }
    const mat = new THREE.MeshLambertMaterial({ map: src.map, color: 0xffffff, vertexColors: !!m.geometry.getAttribute('color'), name: src.name,
      emissive: new THREE.Color('#3b2a30'), emissiveMap: src.map ?? null });
    if (opts.rim) addRim(mat);
    m.material = mat; if (m.isSkinnedMesh) skinned.push(m);
  });
  if (opts.outline) skinned.forEach((m) => addOutline(m));
  return skinned;
}

export function buildAvatar(body: GLTFLike, lib: GLTFLike, def: AvatarDef) {
  const root = skeletonClone(body.scene) as THREE.Group;
  const skinned = litAvatarMaterials(root);
  const faces = skinned.filter((m) => m.morphTargetDictionary && !m.name.endsWith('_outline'));
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
  return { holder, root, mixer, actions, faces };
}
