import * as THREE from 'three';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { AvatarDef, ClipKey } from '../../../data/avatars';
import type { Look } from '../../../fashion/types';
import { avatarClips, litAvatarMaterials } from '../AvatarModel';
import { compositePixels } from './composite';
import { paintDecals } from './decals';
import { FACE_MORPHS } from './faceMorphs';
import { resolveLook, hasHat, type RenderSpec } from './spec';
import { buildAccessory, buildBeard, buildHair, buildJacketExtra, buildLegShell } from './builders';
import type { Prepared } from './source';
type GLTFLike = { scene: THREE.Group; animations: THREE.AnimationClip[] };
/** A customisable avatar instance: the animated body (shared geometry + procedural face morphs, per-instance
 *  composited texture) plus fitted attachments rebuilt by applyLook(). Used by the game and the studio preview. */
export interface CustomAvatar {
  holder: THREE.Group; root: THREE.Group; mixer: THREE.AnimationMixer; actions: Record<ClipKey, THREE.AnimationAction>; faces: THREE.SkinnedMesh[];
  applyLook(look: Look): void; spec(): RenderSpec | null; dispose(): void;
}
const mask = { current: null as { size: number; data: Uint8Array } | null };
export const setAtlasMask = (m: { size: number; data: Uint8Array }) => { mask.current = m; };

export function buildCustomAvatar(src: Prepared, fem: Prepared, mal: Prepared, lib: GLTFLike, def: AvatarDef): CustomAvatar {
  const root = skeletonClone(src.gltf.scene) as THREE.Group;
  let body: THREE.SkinnedMesh | null = null; root.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !body) body = o as THREE.SkinnedMesh; });
  const bm = body! as THREE.SkinnedMesh; bm.geometry = src.body; bm.updateMorphTargets();
  const skinned = litAvatarMaterials(root); const faces = skinned.filter((m) => m.morphTargetDictionary && !m.name.endsWith('_outline'));
  const mat = bm.material as THREE.MeshLambertMaterial;
  // per-instance composited texture
  const size = src.base?.width ?? 1024; const canvas = document.createElement('canvas'); canvas.width = canvas.height = size; const ctx = canvas.getContext('2d', { willReadFrequently: false })!;
  const tex = new THREE.CanvasTexture(canvas); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.generateMipmaps = true;
  if (mat.map) { tex.wrapS = mat.map.wrapS; tex.wrapT = mat.map.wrapT; }
  if (src.base) { mat.map = tex; mat.emissiveMap = tex; mat.needsUpdate = true; }
  const holder = new THREE.Group(); holder.add(root); if (def.facing === 'negZ') holder.rotation.y = Math.PI;
  const mixer = new THREE.AnimationMixer(root); const clips = avatarClips(src.gltf, lib, def); const actions = {} as Record<ClipKey, THREE.AnimationAction>;
  (Object.keys(clips) as ClipKey[]).forEach((k) => { const a = mixer.clipAction(clips[k]); if (k === 'sit' || k === 'stand') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; } actions[k] = a; });
  // bone attachment groups: children are authored in bind-pose mesh space
  const groups = new Map<string, THREE.Group>();
  const attach = (bone: string) => { let g = groups.get(bone); if (g) return g; const i = bm.skeleton.bones.findIndex((b) => b.name === bone); const b = bm.skeleton.bones[i];
    g = new THREE.Group(); g.name = 'attach_' + bone; g.matrixAutoUpdate = false; g.matrix.copy(bm.skeleton.boneInverses[i]).premultiply(new THREE.Matrix4()).multiply(bm.bindMatrix); b.add(g); groups.set(bone, g); return g; };
  const hairMat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: new THREE.Color('#3b2a30'), emissiveMap: tex });
  const beardMat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#3b2a30'), emissiveMap: tex, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const bagMat = new THREE.MeshLambertMaterial({ map: tex, emissive: new THREE.Color('#3b2a30'), emissiveMap: tex });
  const accMat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: new THREE.Color('#5a4a50'), emissive: new THREE.Color('#2a1c22') });
  let live: THREE.Object3D[] = []; let ownGeo: THREE.BufferGeometry[] = []; let ownMat: THREE.Material[] = []; let cur: RenderSpec | null = null; let lastKey = '';
  const clear = () => { live.forEach((o) => o.removeFromParent()); ownGeo.forEach((g) => g.dispose()); ownMat.forEach((m) => m.dispose()); live = []; ownGeo = []; ownMat = []; };
  const add = (parent: THREE.Object3D, o: THREE.Object3D) => { o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.frustumCulled = false; } }); parent.add(o); live.push(o); return o; };
  function applyLook(look: Look) {
    const spec = resolveLook(look); cur = spec;
    // 1) texture
    if (src.base && src.stats && mask.current) {
      const img = ctx.createImageData(size, size); compositePixels(src.base.data, mask.current.data, mask.current.size, spec, src.stats, img.data);
      ctx.putImageData(img, 0, 0); paintDecals(ctx, spec, src.parts.features, size); tex.needsUpdate = true;
    }
    // 2) face morphs (shared influences array: outline + beard follow)
    const dict = bm.morphTargetDictionary!; const inf = bm.morphTargetInfluences!;
    for (const k of FACE_MORPHS) { const i = dict['yw_' + k]; if (i !== undefined) inf[i] = spec.morph[k] ?? 0; }
    // 3) attachments (rebuild only when their inputs changed)
    const key = JSON.stringify([spec.hair, spec.beard, spec.jacket?.extra, spec.jacket?.color, spec.jacket?.trim, spec.shoes.shaft, spec.shoes.color, spec.acc]);
    if (key === lastKey) return; lastKey = key; clear();
    const hat = hasHat(spec); const hb = buildHair(spec.hair, hat, src, fem, mal);
    add(attach('Head'), new THREE.Mesh(hb.hair, hairMat));
    for (const t of hb.ties) { const g = new THREE.TorusGeometry(t.r, 0.006, 6, 16); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: spec.hairColor === '#ff4fb0' ? '#ffd23f' : '#ff4f9a' })); m.position.copy(t.pos); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t.axis); ownGeo.push(g); ownMat.push(m.material as THREE.Material); add(attach('Head'), m); }
    const bg = buildBeard(spec.beard, src);
    if (bg) { const m = new THREE.SkinnedMesh(bg, beardMat); m.bind(bm.skeleton, bm.bindMatrix); m.morphTargetInfluences = bm.morphTargetInfluences; m.morphTargetDictionary = bm.morphTargetDictionary; bm.parent!.add(m); live.push(m); ownGeo.push(bg); m.frustumCulled = false; m.castShadow = true; }
    if (spec.jacket && spec.jacket.extra !== 'none') { const g = buildJacketExtra(spec.jacket.extra, spec.jacket.color, spec.jacket.trim, src); ownGeo.push(g); add(attach('Spine2'), new THREE.Mesh(g, accMat)); }
    if (spec.shoes.shaft) { const g = buildLegShell(src, spec.shoes.shaft); const m = new THREE.SkinnedMesh(g, new THREE.MeshLambertMaterial({ color: new THREE.Color(spec.shoes.color).multiplyScalar(0.92) })); m.bind(bm.skeleton, bm.bindMatrix); bm.parent!.add(m); live.push(m); ownGeo.push(g); ownMat.push(m.material as THREE.Material); m.frustumCulled = false; m.castShadow = true; }
    for (const a of spec.acc) {
      const b = buildAccessory(a.model, a.color, a.color2, src, fem, hb.under); if (!b) continue; ownGeo.push(b.solid);
      add(attach(b.bone), new THREE.Mesh(b.solid, b.textured ? bagMat : accMat));
      if (b.lens) { ownGeo.push(b.lens.geo); const lm = new THREE.MeshPhongMaterial({ color: b.lens.color, transparent: true, opacity: b.lens.opacity, shininess: 90, side: THREE.DoubleSide, depthWrite: false }); ownMat.push(lm); add(attach(b.bone), new THREE.Mesh(b.lens.geo, lm)); }
    }
  }
  return { holder, root, mixer, actions, faces, applyLook, spec: () => cur,
    dispose() { clear(); tex.dispose(); hairMat.dispose(); bagMat.dispose(); beardMat.dispose(); accMat.dispose(); mixer.stopAllAction(); } };
}
