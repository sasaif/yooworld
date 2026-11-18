import * as THREE from 'three';
import { PART, type PartsData } from './parts';
import { buildFaceMorphs, FACE_MORPHS } from './faceMorphs';
import { computeStats, type LabelStats } from './composite';
/** One-time preparation of an avatar GLB for the fashion system (cached per loaded GLTF):
 *  - splits the single skinned mesh into body / native hair cap / native buns / native backpack
 *  - adds the procedural face morph targets to the body geometry
 *  - reads the painted atlas once (for the CPU compositor) and precomputes per-label stats
 *  - exposes geometric probes (face depth, head radius per direction, neck radius) for fitted attachments. */
type GLTFLike = { scene: THREE.Group; animations: THREE.AnimationClip[] };
export interface Prepared {
  gltf: GLTFLike; parts: PartsData; mesh: THREE.SkinnedMesh; body: THREE.BufferGeometry;
  hairCap: THREE.BufferGeometry; buns: THREE.BufferGeometry | null; bag: THREE.BufferGeometry | null;
  base: ImageData | null; stats: LabelStats | null; ibmHead: THREE.Matrix4;
  /** probes, mesh space */ faceZ(x: number, y: number, r?: number): number; headRadius(az: number, y: number): number; neckR: number; cranium: THREE.Vector3;
}
const cache = new WeakMap<object, Prepared>();
const HIDE = new Set<number>([PART.HAIR, PART.HAIR_BUN, PART.BAG, PART.BAG_STRAP]);

function subset(src: THREE.BufferGeometry, tris: number[], keep = ['position', 'normal', 'uv']): THREE.BufferGeometry {
  const idx = src.getIndex()!; const map = new Map<number, number>(); const order: number[] = []; const ni: number[] = [];
  for (const t of tris) for (let k = 0; k < 3; k++) { const v = idx.getX(t * 3 + k); let m = map.get(v); if (m === undefined) { m = order.length; map.set(v, m); order.push(v); } ni.push(m); }
  const g = new THREE.BufferGeometry();
  for (const name of keep) { const a = src.getAttribute(name) as THREE.BufferAttribute; if (!a) continue; const arr = new Float32Array(order.length * a.itemSize);
    order.forEach((v, i) => { for (let c = 0; c < a.itemSize; c++) arr[i * a.itemSize + c] = a.getComponent(v, c); }); g.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize)); }
  g.setIndex(ni); g.userData.srcIndex = order; return g;
}
function readImage(tex: THREE.Texture | null): ImageData | null {
  const img = tex?.image as (CanvasImageSource & { width: number; height: number }) | undefined; if (!img || typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d', { willReadFrequently: true })!; x.drawImage(img, 0, 0);
  return x.getImageData(0, 0, img.width, img.height);
}
export function prepareSource(gltf: GLTFLike, parts: PartsData, mask: { size: number; data: Uint8Array } | null): Prepared {
  const hit = cache.get(gltf); if (hit) return hit;
  let mesh: THREE.SkinnedMesh | null = null; gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = o as THREE.SkinnedMesh; });
  if (!mesh) throw new Error('no skinned mesh'); const m = mesh as THREE.SkinnedMesh; const g0 = m.geometry;
  if (g0.getAttribute('position').count !== parts.vertexCount) throw new Error('parts/vertex mismatch');
  const tp = parts.triPart; const keepTris: number[] = [], hair: number[] = [], buns: number[] = [], bag: number[] = [];
  for (let t = 0; t < tp.length; t++) { const l = tp[t]; if (!HIDE.has(l)) keepTris.push(t); else if (l === PART.HAIR) hair.push(t); else if (l === PART.HAIR_BUN) buns.push(t); else bag.push(t); }
  // body: same vertex buffers (skinning + morphs intact), filtered index, no vertex colours (male hair tint lived there)
  const body = g0.clone(); body.deleteAttribute('color'); const idx = g0.getIndex()!; const ni = new Uint32Array(keepTris.length * 3);
  keepTris.forEach((t, i) => { ni[i * 3] = idx.getX(t * 3); ni[i * 3 + 1] = idx.getX(t * 3 + 1); ni[i * 3 + 2] = idx.getX(t * 3 + 2); }); body.setIndex(new THREE.BufferAttribute(ni, 1));
  // keep morph names, then append the procedural face morphs
  const dict = m.morphTargetDictionary ?? {}; const names = Object.keys(dict).sort((a, b) => dict[a] - dict[b]);
  const mp = body.morphAttributes.position ?? []; const mn = body.morphAttributes.normal;
  mp.forEach((a, i) => (a.name = names[i] ?? String(i))); mn?.forEach((a, i) => (a.name = names[i] ?? String(i)));
  const pos = g0.getAttribute('position') as THREE.BufferAttribute;
  const fm = buildFaceMorphs(pos.array as Float32Array, parts.vertexPart, parts.features);
  for (const k of FACE_MORPHS) { const a = new THREE.BufferAttribute(fm[k], 3); a.name = 'yw_' + k; mp.push(a); if (mn) { const z = new THREE.BufferAttribute(new Float32Array(fm[k].length), 3); z.name = 'yw_' + k; mn.push(z); } }
  body.morphAttributes.position = mp; if (mn) body.morphAttributes.normal = mn; body.morphTargetsRelative = true;
  const base = readImage((m.material as THREE.MeshStandardMaterial).map);
  const stats = base && mask ? computeStats(base.data, mask.data, mask.size) : null;
  // probes
  const vp = parts.vertexPart; const head: THREE.Vector3[] = [];
  for (let i = 0; i < vp.length; i++) if (vp[i] === PART.SKIN_HEAD) head.push(new THREE.Vector3().fromBufferAttribute(pos, i));
  const f = parts.features; const cranium = new THREE.Vector3(0, (f.earP[1] + f.eyeP[1]) / 2 + 0.05, f.headCenter[2] + 0.01);
  const faceZ = (x: number, y: number, r = 0.015) => { let z = 0; let found = false; for (const h of head) if (Math.abs(h.x - x) < r && Math.abs(h.y - y) < r && (!found || h.z < z)) { z = h.z; found = true; } return found ? z : -0.15; };
  const headRadius = (az: number, y: number) => { let best = 0.12; const dx = Math.sin(az), dz = -Math.cos(az); for (const h of head) { if (Math.abs(h.y - y) > 0.03) continue; const rx = h.x - cranium.x, rz = h.z - cranium.z; const d = Math.hypot(rx, rz); if (d < 1e-4) continue; if ((rx * dx + rz * dz) / d > 0.97) best = Math.max(best, d); } return best; };
  let nr = 0, nc = 0; for (const h of head) if (h.y > f.neck[1] && h.y < f.neck[1] + 0.03) { nr += Math.hypot(h.x, h.z - f.neck[2]); nc++; }
  const ibm = new THREE.Matrix4().fromArray(parts.ibm.Head);
  const p: Prepared = { gltf, parts, mesh: m, body, hairCap: subset(g0, hair), buns: buns.length ? subset(g0, buns) : null, bag: bag.length ? subset(g0, bag) : null,
    base, stats, ibmHead: ibm, faceZ, headRadius, neckR: nc ? nr / nc : 0.05, cranium };
  cache.set(gltf, p); return p;
}
