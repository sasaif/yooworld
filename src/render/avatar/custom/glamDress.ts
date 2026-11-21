import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DressId, Pattern } from '../../../fashion/types';
import { PART } from './parts';
import type { Prepared } from './source';
/** Glam dresses (approved 2026-11-21), ported from art/proposals/fashion/proto (designs.js, goth2.js, main.js buildDress).
 *  A dress = ONE skinned "dress cage" lofted around the torso/hips/legs (the garment owns the glam silhouette:
 *  bust, marked waist, curved hips, lifted rear) + its details (bows, straps, lacing, chokers, chains) merged into the
 *  same mesh with rigid bone weights, + an inverted-hull outline of the cage. The body triangles the cage covers are
 *  hidden with a per-avatar index (the body asset is never modified). Bind-pose mesh space of the female body. */
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const bump = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
type V = [number, number, number];
const tube = (pts: V[], r = 0.004, closed = false, seg = 24) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), closed), seg, r, 6, closed);
type Extra = { bone: string; color: 'c1' | 'c2' | 'lacing' | string; geo: THREE.BufferGeometry };
type F = Prepared['parts']['features'];
export interface DressDef {
  hem: number; train?: number; rear?: number; waist?: number; hips?: number; bust?: number; sil2?: number; highlow?: number; points?: number;
  shine: number; spec: string; rim?: number; rimColor?: string;
  topY: (sx: number, cz: number) => number; skirt: (y: number) => number; extras?: (f: F) => Extra[]; lacing?: boolean;
}
const bow = (bone: string, y: number, z: number, s: number, back: boolean): Extra[] => {
  const L: Extra[] = []; for (const sd of [-1, 1]) L.push({ bone, color: 'c2', geo: new THREE.SphereGeometry(1, 10, 7).scale(0.034 * s, 0.018 * s, 0.012 * s).rotateZ(sd * 0.3).translate(sd * 0.03 * s, y, z) });
  L.push({ bone, color: 'c2', geo: new THREE.SphereGeometry(0.013 * s, 8, 6).translate(0, y, z + (back ? 0.004 : -0.004)) });
  for (const sd of [-1, 1]) L.push({ bone, color: 'c2', geo: new THREE.BoxGeometry(0.012 * s, 0.06 * s, 0.004).rotateZ(sd * 0.25).translate(sd * 0.012 * s, y - 0.032 * s, z) }); return L; };
const strapPts = (x: number): V[] => [[x, 0.405, -0.062], [x, 0.455, -0.05], [x * 1.1, 0.478, -0.005], [x, 0.455, 0.06], [x, 0.38, 0.072]];
const sweet = (sx: number, cz: number) => { const wf = ss(0.2, -0.6, cz); const front = 0.428 - 0.014 * bump(sx, 0, 0.13) + 0.004 * bump(Math.abs(sx), 0.45, 0.2); return 0.408 * (1 - wf) + front * wf; };
const heart = (sx: number, cz: number) => { const wf = ss(0.2, -0.6, cz); const front = 0.432 - 0.02 * bump(sx, 0, 0.1) + 0.006 * bump(Math.abs(sx), 0.42, 0.18); return 0.41 * (1 - wf) + front * wf; };
const choker = (gem: boolean, c: Extra['color'] = 'c1', gc: Extra['color'] = 'c2'): Extra[] => { const L: Extra[] = [{ bone: 'Neck', color: c, geo: new THREE.TorusGeometry(0.052, 0.007, 6, 28).rotateX(Math.PI / 2).scale(1, 1, 0.9).translate(0, 0.478, 0.004) }];
  if (gem) L.push({ bone: 'Neck', color: gc, geo: new THREE.OctahedronGeometry(0.009, 0).scale(1, 1.3, 0.6).translate(0, 0.466, -0.046) }); return L; };
const belt = (y: number, buckle: string, sx: number, sz: number): Extra[] => [{ bone: 'Spine1', color: 'c2', geo: new THREE.TorusGeometry(1, 0.008, 6, 40).rotateX(Math.PI / 2).scale(sx, 1, sz).translate(0, y, 0) },
  { bone: 'Spine1', color: buckle, geo: new THREE.TorusGeometry(0.012, 0.0032, 4, 4).rotateZ(Math.PI / 4).translate(0, y, -sz - 0.002) }];
const LAT = { shine: 150, spec: '#c8c0d8', rim: 0.28, rimColor: '#cfc0ff', sil2: 1 };
export const DRESSES: Record<DressId, DressDef> = {
  d1: { hem: 0.008, train: 0.05, rear: 1.2, shine: 70, spec: '#7a5e64', topY: sweet, skirt: (y) => 0.075 * Math.pow(ss(0.14, 0.0, y), 1.4),
    extras: () => [{ bone: 'Spine2', color: 'c2', geo: tube([[0.11, 0.425, 0.0], [0.08, 0.432, -0.055], [0, 0.418, -0.075], [-0.08, 0.432, -0.055], [-0.11, 0.425, 0]], 0.0045) }] },
  d2: { hem: 0.07, shine: 90, spec: '#b0b0c8', rim: 0.6, topY: (sx, cz) => (cz > 0.15 ? 0.355 : 0.40 + 0.072 * ss(0.5, 0.12, Math.abs(sx)) * ss(0.15, -0.5, cz)), skirt: (y) => 0.004 + 0.014 * ss(0.11, 0.07, y),
    extras: () => [{ bone: 'Spine2', color: 'c2', geo: tube([[0.028, 0.468, -0.052], [0.05, 0.49, -0.01], [0.0, 0.505, 0.04], [-0.05, 0.49, -0.01], [-0.028, 0.468, -0.052]], 0.0055) }] },
  d3: { hem: 0.115, shine: 14, spec: '#2a2228', rim: 0.5, waist: 1.15, topY: (sx) => 0.398 + 0.07 * ss(-0.2, 0.95, sx), skirt: () => 0.002,
    extras: () => [{ bone: 'Spine2', color: 'c1', geo: tube([[0.055, 0.44, -0.066], [0.075, 0.478, -0.03], [0.08, 0.482, 0.02], [0.07, 0.45, 0.07]], 0.012) },
      { bone: 'Spine2', color: 'c2', geo: new THREE.SphereGeometry(0.016, 10, 8).scale(1, 1, 0.6).translate(0.07, 0.455, -0.068) }] },
  d4: { hem: 0.045, highlow: 0.045, shine: 90, spec: '#8a7a70', topY: (sx, cz) => 0.385 + 0.02 * ss(0.3, -0.5, cz) - 0.01 * bump(sx, 0, 0.3) * ss(0, -0.7, cz), skirt: (y) => 0.006 + 0.03 * ss(0.2, 0.04, y),
    extras: () => [{ bone: 'Spine2', color: 'c1', geo: tube(strapPts(0.058), 0.0032) }, { bone: 'Spine2', color: 'c1', geo: tube(strapPts(-0.058), 0.0032) }] },
  d5: { hem: 0.165, shine: 70, spec: '#4a3a40', rear: 1.1, topY: () => 0.415, skirt: () => 0.003, extras: () => bow('Hips', 0.285, 0.122, 1.15, true) },
  d6: { hem: 0.01, shine: 50, spec: '#4a3a40', waist: 1.35, topY: sweet, skirt: (y) => 0.012 + 0.1 * Math.pow(ss(0.27, 0.0, y), 0.9), extras: () => bow('Spine1', 0.35, -0.083, 0.55, false) },
  gv1: { ...LAT, hem: 0.11, waist: 1.55, rear: 1.0, topY: heart, skirt: (y) => 0.004 + 0.05 * Math.pow(ss(0.25, 0.11, y), 1.2), lacing: true,
    extras: () => [...choker(true, 'c1', 'lacing'),
      { bone: 'Spine1', color: 'lacing', geo: new THREE.TorusGeometry(0.008, 0.0028, 6, 12).translate(0.008, 0.318, -0.084) }, { bone: 'Spine1', color: 'lacing', geo: new THREE.TorusGeometry(0.008, 0.0028, 6, 12).translate(-0.008, 0.318, -0.084) },
      { bone: 'Spine2', color: 'lacing', geo: tube([[0.105, 0.43, 0.0], [0.07, 0.44, -0.06], [0, 0.418, -0.08], [-0.07, 0.44, -0.06], [-0.105, 0.43, 0]], 0.0035) }] },
  gv2: { ...LAT, hem: 0.16, points: 0.04, waist: 1.45, rear: 1.0, topY: heart, skirt: (y) => 0.006 + 0.04 * ss(0.25, 0.16, y),
    extras: (f) => [...belt(0.338, '#c9ccd6', 0.104, 0.094), ...choker(true, 'c2', '#c9ccd6'),
      { bone: 'Spine2', color: 'c2', geo: tube([[0.06, 0.475, -0.02], [0.03, 0.44, -0.07], [0, 0.42, -0.082], [-0.03, 0.44, -0.07], [-0.06, 0.475, -0.02]], 0.0035) },
      { bone: 'Spine2', color: 'c2', geo: tube([[0.085, 0.432, -0.03], [0.04, 0.428, -0.077], [0, 0.42, -0.082], [-0.04, 0.428, -0.077], [-0.085, 0.432, -0.03]], 0.004) },
      { bone: 'LeftUpLeg', color: 'c2', geo: new THREE.TorusGeometry(0.036, 0.0045, 6, 20).rotateX(Math.PI / 2).translate(f.hipsHalfW * 0.48, 0.16, 0.0) },
      { bone: 'RightUpLeg', color: 'c2', geo: new THREE.TorusGeometry(0.036, 0.0045, 6, 20).rotateX(Math.PI / 2).translate(-f.hipsHalfW * 0.48, 0.16, 0.0) }] },
  gv3: { ...LAT, hem: 0.006, train: 0.09, waist: 1.5, rear: 1.05, topY: (sx, cz) => (cz > 0.3 ? 0.335 : heart(sx, cz)), skirt: (y) => 0.11 * Math.pow(ss(0.13, 0.0, y), 1.5),
    extras: () => [...choker(false),
      { bone: 'Spine1', color: 'c2', geo: tube([[0.09, 0.34, -0.06], [0.04, 0.31, -0.085], [0, 0.3, -0.09], [-0.04, 0.31, -0.085], [-0.09, 0.34, -0.06]], 0.0025) },
      { bone: 'Hips', color: 'c2', geo: tube([[0.05, 0.29, -0.09], [0.06, 0.22, -0.085], [0.04, 0.15, -0.09], [0.07, 0.08, -0.1], [0.05, 0.02, -0.12]], 0.0022) },
      { bone: 'Hips', color: 'c2', geo: tube([[-0.05, 0.29, -0.09], [-0.03, 0.2, -0.085], [-0.06, 0.13, -0.095], [-0.04, 0.06, -0.11], [-0.07, 0.015, -0.13]], 0.0022) },
      { bone: 'Spine2', color: 'c2', geo: tube([[0.045, 0.46, 0.05], [0.03, 0.4, 0.075], [0, 0.36, 0.085], [-0.03, 0.4, 0.075], [-0.045, 0.46, 0.05]], 0.0022) }] },
};
const isBodyCloth = (l: number) => l === PART.LEG || l === PART.TOP_TORSO || l === PART.TOP_COLLAR || l === PART.TOP_HEM || l === PART.TEE || l === PART.SHORTS;
interface Cage { pos: Float32Array; skinIndex: Uint16Array; skinWeight: Float32Array; index: number[]; cageTris: number; prof: (y: number, a: number) => { rx: number; rzF: number; rzB: number }; hz: number }
const cageCache = new Map<string, Cage>(); const hideCache = new Map<string, { index: THREE.BufferAttribute; hidden: number }>();
const SEG = 40, RINGS = 30;
function cage(id: DressId, t: Prepared): Cage {
  const key = id + '|' + t.parts.vertexCount; const hit = cageCache.get(key); if (hit) return hit; const d = DRESSES[id];
  const g = t.mesh.geometry; const pos = g.getAttribute('position'), si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  const vp = t.parts.vertexPart; const f = t.parts.features; const hz = (f.hipsFront + f.hipsBack) / 2;
  // torso extents per 1 cm slice (arms excluded), smoothed, chest capped
  const ext = (y: number) => { let x0 = 0, z0 = 0, z1 = 0; for (let i = 0; i < vp.length; i++) { if (!isBodyCloth(vp[i])) continue; const py = pos.getY(i); if (Math.abs(py - y) > 0.012) continue; const px = pos.getX(i); if (Math.abs(px) > 0.112) continue;
    x0 = Math.max(x0, Math.abs(px)); z0 = Math.min(z0, pos.getZ(i) - hz); z1 = Math.max(z1, pos.getZ(i) - hz); } return { rx: x0, rzF: -z0, rzB: z1 }; };
  const E0 = Array.from({ length: 51 }, (_, k) => ext(k * 0.01)); type E = { rx: number; rzF: number; rzB: number };
  const E: E[] = E0.map((e, k) => { const w = [E0[k - 1] ?? e, e, E0[k + 1] ?? e]; const m = (q: keyof E) => (w[0][q] + 2 * w[1][q] + w[2][q]) / 4; return { rx: m('rx'), rzF: m('rzF'), rzB: m('rzB') }; });
  for (let k = 37; k <= 50; k++) E[k] = { rx: Math.min(E[k].rx, E[36].rx * 1.12), rzF: Math.min(E[k].rzF, E[36].rzF * 1.12), rzB: Math.min(E[k].rzB, E[36].rzB * 1.1) };
  const ex = (y: number) => { const k = Math.min(49.999, Math.max(0, y * 100)); const i = Math.floor(k), u = k - i; const a = E[i], b = E[i + 1]; return { rx: a.rx + (b.rx - a.rx) * u, rzF: a.rzF + (b.rzF - a.rzF) * u, rzB: a.rzB + (b.rzB - a.rzB) * u }; };
  const prof = (y: number, a: number) => { const e = ex(Math.max(y, 0.26)); let rx: number, rzF: number, rzB: number;
    if (y >= 0.26) { rx = Math.max(e.rx, 0.085) + 0.006; rzF = Math.max(e.rzF, 0.06) + 0.006; rzB = Math.max(e.rzB, 0.06) + 0.006; }
    else { const k = (0.26 - y) / 0.26; rx = 0.118 - 0.028 * k; rzF = 0.098 - 0.03 * k; rzB = 0.098 - 0.03 * k; }
    const wst = bump(y, 0.335, 0.03) * (d.waist ?? 1); rx *= 1 - 0.13 * wst; rzF *= 1 - 0.1 * wst; rzB *= 1 - 0.12 * wst;
    rx += 0.016 * bump(y, 0.262, 0.04) * (d.hips ?? 1); rzF += 0.008 * bump(y, 0.405, 0.022) * (d.bust ?? 1);
    rzB += 0.03 * Math.exp(-(((y - 0.25) / (y < 0.25 ? 0.026 : 0.04)) ** 2)) * (d.rear ?? 1) * (0.55 + 0.45 * Math.cos(a) ** 2);
    if (d.sil2) { const lift = Math.exp(-(((y - 0.243) / (y < 0.243 ? 0.019 : 0.042)) ** 2)); const back = Math.max(0, Math.cos(a)); rzB += 0.036 * d.sil2 * lift * Math.pow(back, 0.55);
      rx += 0.011 * d.sil2 * Math.exp(-(((y - 0.25) / 0.05) ** 2)); const w2 = bump(y, 0.335, 0.035); rx -= 0.005 * d.sil2 * w2; rzB -= 0.005 * d.sil2 * w2; }
    const s = d.skirt(y); rx += s; rzF += s * 0.9; rzB += s * 0.95 + (d.train ? d.train * ss(0.08, 0.0, y) : 0); return { rx, rzF, rzB }; };
  const cols = Array.from({ length: SEG + 1 }, (_, s) => { const a = (s / SEG) * Math.PI * 2; return { a, top: d.topY(Math.sin(a), Math.cos(a)), hem: d.hem + (d.highlow ?? 0) * (1 - Math.cos(a)) * 0.5 + (d.points ? d.points * Math.abs(Math.sin(a * 3)) : 0) }; });
  const P: number[] = [], I: number[] = [];
  for (let r = 0; r <= RINGS; r++) for (let s = 0; s <= SEG; s++) { const { a, top, hem } = cols[s]; const u = Math.min(r, RINGS - 1) / (RINGS - 1); const y = hem + (top - hem) * u; const p = prof(y, a); const cz = Math.cos(a);
    const tuck = r === RINGS ? 0.9 : 1; P.push(Math.sin(a) * p.rx * tuck, y + (r === RINGS ? 0.003 : 0), hz + (cz > 0 ? cz * p.rzB : cz * p.rzF) * tuck); }
  for (let r = 0; r < RINGS; r++) for (let s = 0; s < SEG; s++) { const a = r * (SEG + 1) + s, b = a + SEG + 1; I.push(a, a + 1, b, a + 1, b + 1, b); }
  // skin weights: nearest torso/leg/shoe body vertex (squeezed toward the body axis), blended with Hips below the crotch (skirts swing as one)
  const nV = P.length / 3; const SI = new Uint16Array(nV * 4), SW = new Float32Array(nV * 4); const cand: number[] = [];
  for (let i = 0; i < vp.length; i++) if (isBodyCloth(vp[i]) || vp[i] === PART.SHOE) { if (vp[i] === PART.TOP_TORSO && Math.abs(pos.getX(i)) > 0.112) continue; cand.push(i); }
  const cx = new Float32Array(cand.length * 3); cand.forEach((i, k) => { cx[k * 3] = pos.getX(i); cx[k * 3 + 1] = pos.getY(i); cx[k * 3 + 2] = pos.getZ(i); });
  const hipsI = t.mesh.skeleton.bones.findIndex((b) => b.name === 'Hips');
  for (let j = 0; j < nV; j++) { const x = P[j * 3] * 0.7, y = P[j * 3 + 1], z = hz + (P[j * 3 + 2] - hz) * 0.7; let best = 0, bd = 1e9;
    for (let k = 0; k < cand.length; k++) { const dx = cx[k * 3] - x, dy = (cx[k * 3 + 1] - y) * 1.5, dz = cx[k * 3 + 2] - z; const dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; best = cand[k]; } }
    const k = ss(0.25, 0.08, y) * 0.55; const wm = new Map<number, number>();
    for (let q = 0; q < 4; q++) { const bi = si.getComponent(best, q), w = sw.getComponent(best, q); if (w > 0) wm.set(bi, (wm.get(bi) ?? 0) + w * (1 - k)); } wm.set(hipsI, (wm.get(hipsI) ?? 0) + k);
    const top4 = [...wm.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4); const tot = top4.reduce((a, e) => a + e[1], 0);
    for (let q = 0; q < 4; q++) { SI[j * 4 + q] = top4[q]?.[0] ?? 0; SW[j * 4 + q] = (top4[q]?.[1] ?? 0) / tot; } }
  const c: Cage = { pos: new Float32Array(P), skinIndex: SI, skinWeight: SW, index: I, cageTris: I.length / 3, prof, hz }; cageCache.set(key, c); return c;
}
/** Index of the prepared body with the triangles fully inside the dress removed (cached per dress). */
export function dressHideIndex(id: DressId, t: Prepared): { index: THREE.BufferAttribute; hidden: number } {
  const key = id + '|' + t.parts.vertexCount; const hit = hideCache.get(key); if (hit) return hit; const d = DRESSES[id];
  const pos = t.mesh.geometry.getAttribute('position'); const vp = t.parts.vertexPart; const f = t.parts.features; const hz = (f.hipsFront + f.hipsBack) / 2;
  const inside = (i: number) => { const l = vp[i]; if (!(isBodyCloth(l) || ((l === PART.SHOE || l === PART.SOLE) && d.hem < 0.03))) return false; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (Math.abs(x) > 0.114 && y > 0.34) return false;
    const a = Math.atan2(x, z - hz); return y < d.topY(Math.sin(a), Math.cos(a)) + 0.003 && y > d.hem + 0.012; };
  const src = t.body.getIndex()!; const keep: number[] = []; let hidden = 0;
  for (let k = 0; k < src.count; k += 3) { const a = src.getX(k), b = src.getX(k + 1), c = src.getX(k + 2); if (inside(a) && inside(b) && inside(c)) { hidden++; continue; } keep.push(a, b, c); }
  const out = { index: new THREE.BufferAttribute(new Uint32Array(keep), 1), hidden }; hideCache.set(key, out); return out;
}
const hash = (x: number, y: number, z: number) => Math.abs((Math.sin(x * 1231.1 + y * 3123.7 + z * 2311.3) * 43758.5453) % 1);
export interface DressBuild { geo: THREE.BufferGeometry; outline: THREE.BufferGeometry; cageTris: number; tris: number; material: THREE.Material }
/** Per item: cage (vertex coloured) + all details merged into ONE skinned geometry (details are rigid on their bone). */
export function buildDress(spec: { id: DressId; pattern: Pattern; color: string; color2: string; lacing?: string }, t: Prepared): DressBuild {
  const d = DRESSES[spec.id]; const cg = cage(spec.id, t); const c1 = new THREE.Color(spec.color), c2 = new THREE.Color(spec.color2); const cc = new THREE.Color();
  const n = cg.pos.length / 3; const C = new Float32Array(n * 3);
  for (let j = 0; j < n; j++) { const x = cg.pos[j * 3], y = cg.pos[j * 3 + 1], z = cg.pos[j * 3 + 2]; cc.copy(c1);
    if (spec.pattern === 'sequin') cc.lerp(c2, 0.12 * hash(x, y, z)); else if (spec.pattern === 'ombre') cc.lerp(c2, ss(0.3, 0.02, y)); C.set([cc.r, cc.g, cc.b], j * 3); }
  const body = new THREE.BufferGeometry(); body.setAttribute('position', new THREE.BufferAttribute(cg.pos, 3)); body.setAttribute('color', new THREE.BufferAttribute(C, 3));
  body.setAttribute('skinIndex', new THREE.BufferAttribute(cg.skinIndex, 4)); body.setAttribute('skinWeight', new THREE.BufferAttribute(cg.skinWeight, 4)); body.setIndex(cg.index); body.computeVertexNormals();
  const outline = new THREE.BufferGeometry(); for (const k of ['position', 'normal', 'skinIndex', 'skinWeight']) outline.setAttribute(k, body.getAttribute(k)); outline.setIndex(cg.index);
  const bones = t.mesh.skeleton.bones; const boneI = (name: string) => Math.max(0, bones.findIndex((b) => b.name === name));
  const colorOf = (c: string) => new THREE.Color(c === 'c1' ? spec.color : c === 'c2' ? spec.color2 : c === 'lacing' ? spec.lacing ?? spec.color2 : c);
  const extras: Extra[] = [...(d.extras?.(t.parts.features) ?? [])];
  if (d.lacing) { const zf = (y: number) => cg.hz - cg.prof(y, Math.PI).rzF - 0.0025; const ys = [0.30, 0.322, 0.344, 0.366, 0.388];
    for (let k = 0; k < ys.length - 1; k++) for (const sd of [-1, 1]) { const y0 = ys[k], y1 = ys[k + 1]; extras.push({ bone: 'Spine1', color: 'lacing', geo: new THREE.TubeGeometry(new THREE.LineCurve3(new THREE.Vector3(-sd * 0.012, y0, zf(y0)), new THREE.Vector3(sd * 0.012, y1, zf(y1))), 2, 0.0022, 5, false) }); }
    for (const y of ys) for (const sd of [-1, 1]) extras.push({ bone: 'Spine1', color: 'lacing', geo: new THREE.SphereGeometry(0.0034, 6, 4).translate(sd * 0.013, y, zf(y) - 0.001) }); }
  const parts = [body.index ? body.toNonIndexed() : body];
  for (const e of extras) { const g = e.geo.index ? e.geo.toNonIndexed() : e.geo; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    const m = g.getAttribute('position').count; const col = colorOf(e.color); const ca = new Float32Array(m * 3), sia = new Uint16Array(m * 4), swa = new Float32Array(m * 4); const bi = boneI(e.bone);
    for (let i = 0; i < m; i++) { ca.set([col.r, col.g, col.b], i * 3); sia[i * 4] = bi; swa[i * 4] = 1; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3)); g.setAttribute('skinIndex', new THREE.BufferAttribute(sia, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(swa, 4)); parts.push(g); }
  const geo = mergeGeometries(parts)!;
  return { geo, outline, cageTris: cg.cageTris, tris: geo.getAttribute('position').count / 3, material: fabricMaterial(spec.pattern, d) };
}
const matCache = new Map<string, THREE.Material>();
/** Phong + rim (same idea as the body's addRim) + per-fabric shading: sequin sparkle, velvet soft rim, latex "studio" reflection bands. 0 texture. */
export function fabricMaterial(pattern: Pattern, d: Pick<DressDef, 'shine' | 'spec' | 'rim' | 'rimColor'>): THREE.Material {
  const key = [pattern, d.shine, d.spec, d.rim, d.rimColor].join('|'); const hit = matCache.get(key); if (hit) return hit;
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide, shininess: d.shine, specular: new THREE.Color(d.spec), emissive: new THREE.Color('#2a1c22') });
  const rimC = new THREE.Color(d.rimColor ?? '#fff0f6'); const rimS = d.rim ?? 0.45; const seq = pattern === 'sequin', vel = pattern === 'velvet', lat = pattern === 'latex';
  mat.onBeforeCompile = (sh) => { sh.uniforms.rimColor = { value: rimC }; sh.uniforms.rimStrength = { value: rimS };
    sh.vertexShader = 'varying vec3 vObj;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vObj = position;');
    sh.fragmentShader = 'uniform vec3 rimColor; uniform float rimStrength; varying vec3 vObj;\n' + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        ${seq ? 'float hs = fract(sin(dot(floor(vObj*190.0), vec3(12.9898,78.233,37.719)))*43758.5453); diffuseColor.rgb *= 0.96 + 0.55*step(0.86, hs) + 0.5*step(0.965,hs);' : ''}`)
      .replace('#include <opaque_fragment>', `
      vec3 rimView = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
      float rim = pow(1.0 - clamp(abs(dot(normalize(normal), rimView)), 0.0, 1.0), ${vel ? '1.6' : '2.6'});
      outgoingLight += rimColor * rim * rimStrength;
      ${lat ? 'vec3 Rv = reflect(-normalize(vViewPosition), normalize(normal)); float band = pow(max(0.0, dot(Rv, normalize(vec3(0.25, 0.9, 0.35)))), 10.0) + 0.55*pow(max(0.0, dot(Rv, normalize(vec3(-0.8, 0.2, 0.5)))), 24.0); outgoingLight += vec3(0.95, 0.9, 1.0) * band * 0.75;' : ''}
      #include <opaque_fragment>`); };
  mat.customProgramCacheKey = () => 'yw-fab' + +seq + +vel + +lat + rimS; matCache.set(key, mat); return mat;
}
let outlineMat: THREE.Material | null = null;
/** Same inverted hull as the body outline (AvatarModel addOutline), slightly thinner. */
export function dressOutlineMaterial() {
  if (outlineMat) return outlineMat; const m = new THREE.MeshBasicMaterial({ color: '#4a2c45', side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed += normalize(normal) * 0.0032;'); };
  m.customProgramCacheKey = () => 'yw-outline-dress'; outlineMat = m; return m;
}
