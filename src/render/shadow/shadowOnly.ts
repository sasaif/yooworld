import * as THREE from 'three';

/**
 * Shadow-only objects: drawn into the shadow maps, never in the main (colour) pass.
 *
 * three r170 builds the main render list (`projectObject`, which skips `visible === false`) BEFORE it renders the
 * shadow maps (`shadowMap.render`, which skips `visible === false` too). So an object kept hidden, and made visible only
 * while `shadowMap.render` runs, costs shadow-pass draws and zero main-pass draws. Used to replace dozens of per-part
 * shadow casters (one per InstancedMesh / material) by one merged, position-only caster: the shadow map gets the same
 * depth, in one draw call instead of one per part.
 */
type ShadowMapLike = { render: (...a: never[]) => unknown };
type RendererLike = { shadowMap: ShadowMapLike };

const casters = new Set<THREE.Object3D>();
const installs = new WeakMap<object, { refs: number; active: boolean; orig: ShadowMapLike['render']; wrapped: ShadowMapLike['render'] }>();

/** Register an object as shadow-only (it is hidden right away and shown only during the shadow pass). */
export function addShadowOnly(o: THREE.Object3D): () => void {
  o.visible = false; casters.add(o);
  return () => { casters.delete(o); };
}

/** Number of registered shadow-only objects (tests / debug). */
export const shadowOnlyCount = () => casters.size;

/** Wrap `gl.shadowMap.render` once per renderer (ref-counted). Returns the release function. */
export function installShadowOnly(gl: RendererLike): () => void {
  const sm = gl.shadowMap; let rec = installs.get(sm);
  if (!rec) {
    const orig = sm.render;
    const r = { refs: 0, active: true, orig, wrapped: orig };
    r.wrapped = function (this: unknown, ...a: never[]) {
      if (!r.active || casters.size === 0) return orig.apply(this, a);
      casters.forEach((o) => { o.visible = true; });
      try { return orig.apply(this, a); } finally { casters.forEach((o) => { o.visible = false; }); }
    };
    sm.render = r.wrapped; installs.set(sm, r); rec = r;
  }
  const r = rec; r.refs++;
  let released = false;
  return () => {
    if (released) return; released = true;
    if (--r.refs > 0) return;
    // restore only if nobody wrapped on top of us; otherwise stay in the chain as a pass-through
    if (sm.render === r.wrapped) { sm.render = r.orig; installs.delete(sm); } else r.active = false;
  };
}

/**
 * Merge (geometry, world matrix) pairs into ONE position-only indexed geometry for a shadow caster.
 * Normals / uvs / colours are dropped: the depth pass only reads positions.
 */
export function mergeForShadow(items: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[]): THREE.BufferGeometry {
  let nv = 0, ni = 0;
  for (const { geometry: g } of items) { const n = g.attributes.position.count; nv += n; ni += g.index ? g.index.count : n; }
  const pos = new Float32Array(nv * 3); const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  const v = new THREE.Vector3(); let vo = 0, io = 0;
  for (const { geometry: g, matrix } of items) {
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i).applyMatrix4(matrix); pos[(vo + i) * 3] = v.x; pos[(vo + i) * 3 + 1] = v.y; pos[(vo + i) * 3 + 2] = v.z; }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo;
    else for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
    vo += P.count; io += g.index ? g.index.count : P.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere(); return out;
}
