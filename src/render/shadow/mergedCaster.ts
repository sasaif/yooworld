import * as THREE from 'three';
import { addShadowOnly, mergeForShadow } from './shadowOnly';

/**
 * Merged shadow caster for STATIC scenery (apartment walls + furniture).
 *
 * Sources keep rendering normally in the main pass (same materials, instancing, picking) but with castShadow = false;
 * this object gathers their world-space triangles (InstancedMesh: every instance) into one position-only mesh per
 * material side, drawn only in the shadow pass (see shadowOnly.ts). Same depth in the shadow map, far fewer draw calls.
 * Call `invalidate()` whenever a source moves / changes / appears / disappears; the rebuild happens once, on `update()`.
 */
export class MergedShadowCaster {
  readonly root = new THREE.Group();
  private sources = new Set<THREE.Mesh>();
  private meshes: THREE.Mesh[] = [];
  private release: (() => void)[] = [];
  private dirty = false;
  private mats = new Map<string, THREE.MeshBasicMaterial>();
  /** rebuilds done (tests / debug) */
  builds = 0;

  constructor() { this.root.name = 'mergedShadowCaster'; }

  track(m: THREE.Mesh): () => void {
    m.castShadow = false; this.sources.add(m); this.dirty = true;
    return () => { if (this.sources.delete(m)) this.dirty = true; };
  }
  invalidate() { this.dirty = true; }
  get isDirty() { return this.dirty; }

  /** Rebuild if needed. Returns true when a rebuild happened. */
  update(): boolean {
    if (!this.dirty) return false;
    this.dirty = false; this.clear(); this.builds++;
    // grouped by (side, shadowSide): the depth material three picks for a caster depends on those two only
    const bySide = new Map<string, { side: THREE.Side; shadowSide: THREE.Side | null; items: { geometry: THREE.BufferGeometry; matrix: THREE.Matrix4 }[] }>();
    const tmp = new THREE.Matrix4();
    for (const m of this.sources) {
      if (!m.parent || !m.visible) continue; // unmounted but not yet untracked, or hidden
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material;
      if (!mat.visible) continue;
      m.updateWorldMatrix(true, false);
      const key = mat.side + '|' + mat.shadowSide;
      const list = (bySide.get(key) ?? bySide.set(key, { side: mat.side, shadowSide: mat.shadowSide, items: [] }).get(key)!).items;
      const im = m as THREE.InstancedMesh;
      if (im.isInstancedMesh) for (let i = 0; i < im.count; i++) { im.getMatrixAt(i, tmp); list.push({ geometry: m.geometry, matrix: m.matrixWorld.clone().multiply(tmp) }); }
      else list.push({ geometry: m.geometry, matrix: m.matrixWorld.clone() });
    }
    bySide.forEach(({ side, shadowSide, items }, key) => {
      if (!items.length) return;
      let mat = this.mats.get(key); if (!mat) { mat = new THREE.MeshBasicMaterial({ side, colorWrite: false }); mat.shadowSide = shadowSide; this.mats.set(key, mat); }
      const mesh = new THREE.Mesh(mergeForShadow(items), mat);
      mesh.castShadow = true; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false; mesh.raycast = () => {};
      this.root.add(mesh); this.meshes.push(mesh); this.release.push(addShadowOnly(mesh));
    });
    return true;
  }

  /** shadow-pass draw calls this caster costs per frame */
  get drawCount() { return this.meshes.length; }

  private clear() {
    this.release.forEach((r) => r()); this.release = [];
    this.meshes.forEach((m) => { this.root.remove(m); m.geometry.dispose(); }); this.meshes = [];
  }
  dispose() { this.clear(); this.mats.forEach((m) => m.dispose()); this.mats.clear(); this.sources.clear(); }
}
