import * as THREE from 'three';
import { PALETTE, S } from '../../data/style';

export interface Part { geometry: THREE.BufferGeometry; material: THREE.Material }
const matCache = new Map<string, THREE.Material>();
/** One shared Lambert material per palette name: fewer shader programs / state changes. */
export function paletteMaterial(src: THREE.MeshStandardMaterial, tint?: Record<string, string>) {
  const color = tint?.[src.name] ?? PALETTE[src.name] ?? '#' + src.color.getHexString();
  const key = src.name + color + (src.transparent ? 't' : '');
  let m = matCache.get(key);
  if (!m) { m = new THREE.MeshLambertMaterial({ color, name: src.name, transparent: src.transparent, opacity: src.opacity }); matCache.set(key, m); }
  return m;
}
const partCache = new Map<string, Part[]>();
/** Flatten a kit GLB into baked parts (node transforms + kit scale applied, centred on the footprint,
 *  resting on y = 0). Parts are then drawn with InstancedMesh: 1 draw call per part, whatever the count. */
export function flattenModel(key: string, scene: THREE.Object3D, tint?: Record<string, string>): Part[] {
  const ck = key + JSON.stringify(tint ?? {}); if (partCache.has(ck)) return partCache.get(ck)!;
  const root = scene.clone(true); root.scale.setScalar(S); root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root); const c = box.getCenter(new THREE.Vector3());
  const off = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y, -c.z);
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(off, m.matrixWorld));
    const mat = paletteMaterial(m.material as THREE.MeshStandardMaterial, tint);
    (byMat.get(mat) ?? byMat.set(mat, []).get(mat)!).push(g);
  });
  const parts: Part[] = [];
  byMat.forEach((gs, material) => { const geometry = gs.length === 1 ? gs[0] : mergeSimple(gs); geometry.computeBoundingSphere(); parts.push({ geometry, material }); });
  partCache.set(ck, parts); return parts;
}
/** Merge geometries keeping only position/normal (kit models are untextured). */
export function mergeSimple(gs: THREE.BufferGeometry[], uvFn?: (p: THREE.Vector3, n: THREE.Vector3) => [number, number]) {
  let nv = 0, ni = 0; const ng = gs.map((g) => (g.index ? g : g.toNonIndexed()));
  ng.forEach((g) => { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; });
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = uvFn ? new Float32Array(nv * 2) : null; const idx = new Uint32Array(ni);
  let vo = 0, io = 0; const p = new THREE.Vector3(), n = new THREE.Vector3();
  for (const g of ng) {
    const P = g.attributes.position, N = g.attributes.normal;
    for (let i = 0; i < P.count; i++) {
      pos.set([P.getX(i), P.getY(i), P.getZ(i)], (vo + i) * 3); if (N) nor.set([N.getX(i), N.getY(i), N.getZ(i)], (vo + i) * 3);
      if (uv) { p.fromBufferAttribute(P, i); if (N) n.fromBufferAttribute(N, i); uv.set(uvFn!(p, n), (vo + i) * 2); }
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io + i] = g.index.getX(i) + vo; else for (let i = 0; i < P.count; i++) idx[io + i] = vo + i;
    vo += P.count; io += g.index ? g.index.count : P.count;
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1)); return out;
}
