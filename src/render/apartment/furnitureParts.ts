import * as THREE from 'three';
import { PALETTE, S } from '../../data/style';
import { LEG_RESHAPE, reshapeY, type LegReshape } from '../../data/furnitureReshape';

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
  const rs = LEG_RESHAPE[key];
  if (rs) { byMat.forEach((gs) => gs.forEach((g) => reshapeGeometry(g, rs))); if (rs.ring) addFootRing(byMat, rs); }
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
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); out.setIndex(new THREE.BufferAttribute(idx, 1));
  // the merged result owns the data; drop the inputs (and any toNonIndexed() copies) so they are not left on the GPU / in RAM
  for (const g of ng) { if (!gs.includes(g)) g.dispose(); }
  for (const g of gs) g.dispose();
  return out;
}

/** Shorten the legs / base (data/furnitureReshape.ts): vertices below `below` scaled down, the rest moved down. */
export function reshapeGeometry(g: THREE.BufferGeometry, r: LegReshape) {
  const P = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < P.count; i++) P.setY(i, reshapeY(P.getY(i), r));
  P.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox();
}
/** Bar stool foot ring: a horizontal tube around the legs (centre `cz` forward), with 4 short struts to the legs,
 *  in the material of the legs (the part with most geometry below the seat). */
function addFootRing(byMat: Map<THREE.Material, THREE.BufferGeometry[]>, r: LegReshape) {
  const ring = r.ring!; let best: THREE.Material | null = null, bestN = -1; let legX = 0, legZ = 0;
  byMat.forEach((gs, m) => { let n = 0; for (const g of gs) { const P = g.attributes.position; for (let i = 0; i < P.count; i++) { const y = P.getY(i); if (y > 0.02 && y < ring.y) { n++; legX = Math.max(legX, Math.abs(P.getX(i))); legZ = Math.max(legZ, Math.abs(P.getZ(i))); } } } if (n > bestN) { bestN = n; best = m; } });
  if (!best) return;
  const y = ring.y - ring.tube;
  const torus = new THREE.TorusGeometry(ring.r, ring.tube, 8, 40); torus.rotateX(Math.PI / 2); torus.translate(0, y, ring.cz);
  const parts: THREE.BufferGeometry[] = [torus];
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { // strut from each leg (at this height) out to the ring
    const lx = sx * legX * 0.9, lz = sz * legZ * 0.9; const dx = lx, dz = lz - ring.cz, l = Math.hypot(dx, dz) || 1;
    const ex = dx / l * ring.r, ez = ring.cz + dz / l * ring.r; const len = Math.hypot(ex - lx, ez - lz);
    const c = new THREE.CylinderGeometry(ring.tube * 0.8, ring.tube * 0.8, len, 6); c.rotateZ(Math.PI / 2); c.rotateY(-Math.atan2(ez - lz, ex - lx)); c.translate((lx + ex) / 2, y, (lz + ez) / 2); parts.push(c);
  }
  byMat.get(best)!.push(...parts);
}
