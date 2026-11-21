import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AccModel } from '../../../fashion/types';
import { PART } from './parts';
import type { Prepared } from './source';
/** Glam glasses (approved 2026-11-21) + the temple (arm) fix for EVERY pair of glasses.
 *  Ported from art/proposals/fashion/proto (main.js buildGlasses/lensShape, temples.js, goth2.js P1-B).
 *  Temples: the old in-game arm was a straight box at eye height ending at the CENTRE of the ear (inside it).
 *  Now each temple is a tube on a path hinge -> along the side of the head -> ~4 mm ABOVE the ear top -> bends down
 *  behind the ear, projected outside the head skin and pushed out to >= 1.5 mm clearance (exact point-triangle distance).
 *  Fitted once per body + hinge position (cached), all in Head-bone bind space. */
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clean = (g: THREE.BufferGeometry, keep = ['position', 'normal']) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!keep.includes(k)) n.deleteAttribute(k); return n; };
const paint = (g: THREE.BufferGeometry, c: string) => { const n = clean(g); const cc = new THREE.Color(c); const a = new Float32Array(n.getAttribute('position').count * 3); for (let i = 0; i < a.length; i += 3) a.set([cc.r, cc.g, cc.b], i); n.setAttribute('color', new THREE.BufferAttribute(a, 3)); return n; };

// ---------------- temples ----------------
interface HeadFit { side: Record<number, { tri: Float32Array; mesh: THREE.Mesh; box: THREE.Box3; n: number }> }
const headFits = new WeakMap<Prepared, HeadFit>();
function headFit(t: Prepared): HeadFit {
  const hit = headFits.get(t); if (hit) return hit;
  const g = t.mesh.geometry; const pos = g.getAttribute('position'); const idx = g.getIndex()!; const vp = t.parts.vertexPart; const f = t.parts.features;
  const side: HeadFit['side'] = {};
  for (const sd of [-1, 1]) {
    const ear = sd > 0 ? f.earP : f.earN; const ex = Math.abs(ear[0]);
    const T: number[] = []; const v = new THREE.Vector3();
    for (let k = 0; k < idx.count; k += 3) { const a = idx.getX(k), b = idx.getX(k + 1), c = idx.getX(k + 2); if (vp[a] !== PART.SKIN_HEAD || vp[b] !== PART.SKIN_HEAD || vp[c] !== PART.SKIN_HEAD) continue;
      v.fromBufferAttribute(pos, a).add(new THREE.Vector3().fromBufferAttribute(pos, b)).add(new THREE.Vector3().fromBufferAttribute(pos, c)).multiplyScalar(1 / 3);
      if (sd * v.x < ex * 0.35 || Math.abs(v.y - ear[1]) > 0.14) continue; for (const q of [a, b, c]) T.push(pos.getX(q), pos.getY(q), pos.getZ(q)); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(T, 3)); geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.updateMatrixWorld(true);
    const box = new THREE.Box3(); let n = 0;
    for (let i = 0; i < vp.length; i++) { if (vp[i] !== PART.SKIN_HEAD) continue; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (sd * x < ex - 0.022 || Math.abs(z - ear[2]) > 0.06 || Math.abs(y - ear[1]) > 0.075) continue; box.expandByPoint(new THREE.Vector3(x, y, z)); n++; }
    if (!n) box.set(new THREE.Vector3(ear[0] - 0.02, ear[1] - 0.05, ear[2] - 0.026), new THREE.Vector3(ear[0] + 0.02, ear[1] + 0.05, ear[2] + 0.026)); // no ear vertices found: landmark box
    side[sd] = { tri: new Float32Array(T), mesh, box, n };
  }
  const out = { side }; headFits.set(t, out); return out;
}
export interface TempleMeasure { side: number; earTop: number; earBack: number; ride: number; minClearance: number; insideSamples: number; samples: number }
/** Last fitted measures per key (read by tests / e2e through window.__glassesFit). */
export const TEMPLE_FITS = new Map<string, TempleMeasure[]>();
const templeCache = new Map<string, { geo: THREE.BufferGeometry; measures: TempleMeasure[] }>();
export function fitTemples(t: Prepared, hingeX: number, yH: number, zH: number, r = 0.0032): { geo: THREE.BufferGeometry; measures: TempleMeasure[] } {
  const key = [t.parts.vertexCount, hingeX.toFixed(4), yH.toFixed(4), zH.toFixed(4), r].join(','); const hit = templeCache.get(key); if (hit) return hit;
  const H = headFit(t); const ray = new THREE.Raycaster(); const tris: THREE.BufferGeometry[] = []; const measures: TempleMeasure[] = [];
  const Tr = new THREE.Triangle(), cp = new THREE.Vector3();
  for (const sd of [-1, 1]) {
    const S = H.side[sd]; const B = S.box; const zF = B.min.z, zB = B.max.z, top = B.max.y; const ride = top + r + 0.004; const zEnd = zB + 0.05; const ex = Math.abs(sd > 0 ? B.max.x : B.min.x);
    const surface = (y: number, z: number) => { ray.set(new THREE.Vector3(sd, y, z), new THREE.Vector3(-sd, 0, 0)); const h = ray.intersectObject(S.mesh, false); return h.length ? Math.max(0, sd * h[0].point.x) : 0; };
    const anchors = [new THREE.Vector3(sd * hingeX, yH, zH), new THREE.Vector3(sd * (hingeX + 0.008), yH + 0.004, zH + 0.02), new THREE.Vector3(sd * ex, ride, zF - 0.015), new THREE.Vector3(sd * ex, ride, zB + 0.006),
      new THREE.Vector3(sd * ex, ride - 0.004, zB + 0.02), new THREE.Vector3(sd * (ex - 0.005), ride - 0.018, zB + 0.036), new THREE.Vector3(sd * (ex - 0.01), top - 0.028, zEnd)];
    const cv = new THREE.CatmullRomCurve3(anchors, false, 'centripetal'); const gap = r + 0.003;
    // samples every ~2 mm, kept outside the head silhouette (the front part keeps the hinge position)
    const P: THREE.Vector3[] = []; const N = 90;
    for (let k = 0; k <= N; k++) { const p = cv.getPoint(k / N); const sx = surface(p.y, p.z); const u = THREE.MathUtils.smoothstep(p.z, zH, zH + 0.05);
      const x0 = sd * p.x; let x = x0 * (1 - u) + (sx > 0 ? sx + gap : x0) * u; x = Math.max(x, sx + gap); p.x = sd * x; P.push(p); }
    // push-out passes: exact point-to-triangle distance, clearance >= r + 1.5 mm
    const tri = S.tri; const dist = (p: THREE.Vector3, best?: THREE.Vector3) => { let bd = 1e9; for (let q = 0; q < tri.length; q += 9) { Tr.a.set(tri[q], tri[q + 1], tri[q + 2]); Tr.b.set(tri[q + 3], tri[q + 4], tri[q + 5]); Tr.c.set(tri[q + 6], tri[q + 7], tri[q + 8]);
      Tr.closestPointToPoint(p, cp); const d = p.distanceTo(cp); if (d < bd) { bd = d; best?.copy(cp); } } return bd; };
    const need = r + 0.0015; const best = new THREE.Vector3();
    for (let pass = 0; pass < 4; pass++) { let moved = 0; for (const p of P) { const bd = dist(p, best); if (bd < need) { const dir = p.clone().sub(best); if (dir.lengthSq() < 1e-12) dir.set(sd, 0, 0); p.addScaledVector(dir.normalize(), need - bd + 0.0002); moved++; } } if (!moved) break;
      for (let k = 1; k < P.length - 1; k++) P[k].lerp(P[k - 1].clone().add(P[k + 1]).multiplyScalar(0.5), 0.3); }
    let minC = 1e9, inside = 0; for (const p of P) { minC = Math.min(minC, dist(p) - r); if (sd * p.x < surface(p.y, p.z)) inside++; }
    const path = new THREE.CatmullRomCurve3(P.filter((_, k) => k % 3 === 0 || k === P.length - 1), false, 'centripetal');
    tris.push(clean(new THREE.TubeGeometry(path, 36, r, 6, false)));
    // round end caps
    tris.push(clean(new THREE.SphereGeometry(r, 6, 4).translate(P[P.length - 1].x, P[P.length - 1].y, P[P.length - 1].z)));
    measures.push({ side: sd, earTop: top, earBack: zB, ride, minClearance: minC, insideSamples: inside, samples: P.length });
  }
  const out = { geo: mergeGeometries(tris)!, measures }; templeCache.set(key, out); TEMPLE_FITS.set(key, measures); return out;
}

// ---------------- glam frames ----------------
type Kind = 'round' | 'cateye' | 'oversize' | 'aviator' | 'hexa' | 'heart2' | 'yoville' | 'wayfarer';
interface GDef { kind: Kind; r: number; th: number; depth?: number; wire?: boolean; gems?: boolean; bridgeR?: number; puffy?: boolean; rim?: number; rimDepth?: number; dz?: number;
  /** P1-B speckle material */ speck?: boolean; /** half-rim: tube on the upper part of the outline only */ half?: boolean; /** brow bar across the top (pilot) */ brow?: boolean }
export const GLAM_GLASSES: Partial<Record<AccModel, GDef>> = {
  glasses_biba: { kind: 'round', r: 0.05, th: 0.011, depth: 0.007 },
  glasses_cateye: { kind: 'cateye', r: 0.046, th: 0.01, gems: true },
  glasses_70s: { kind: 'oversize', r: 0.052, th: 0.009, dz: -0.004 },
  glasses_aviator: { kind: 'aviator', r: 0.049, th: 0.0032, wire: true },
  glasses_hexa: { kind: 'hexa', r: 0.05, th: 0.0045, wire: true },
  glasses_heart2: { kind: 'heart2', r: 0.05, th: 0.009 },
  glasses_yoville: { kind: 'yoville', r: 0.056, th: 0.0125, depth: 0.008, bridgeR: 0.0055 },
  glasses_yoville_p1: { kind: 'yoville', r: 0.056, th: 0.0125, depth: 0.008, bridgeR: 0.0055, puffy: true, rim: 0.0105, speck: true },
  glasses_terrazzo_wayfarer: { kind: 'wayfarer', r: 0.05, th: 0.0165, depth: 0.011, bridgeR: 0.005, speck: true },
  glasses_terrazzo_pilote: { kind: 'aviator', r: 0.05, th: 0.0075, depth: 0.0065, bridgeR: 0.0035, brow: true, speck: true },
  glasses_terrazzo_demilune: { kind: 'round', r: 0.05, th: 0.0125, puffy: true, half: true, rim: 0.0095, bridgeR: 0.0045, speck: true },
};
function lensPts(kind: Kind, r: number): THREE.Vector2[] {
  const pts: THREE.Vector2[] = []; const N = 40;
  for (let i = 0; i < N; i++) { const a = (i / N) * Math.PI * 2; let x = Math.cos(a), y = Math.sin(a);
    if (kind === 'cateye') { x *= 1.18; y *= 0.78; if (x > 0.0 && y > -0.2) { const k = ss(0.0, 1.1, x) * ss(-0.2, 0.7, y); y += 0.55 * k; x += 0.25 * k; } if (y < 0) y *= 0.85; }
    else if (kind === 'oversize') { const p = 4; x = Math.sign(x) * Math.abs(x) ** (2 / p) * 1.15; y = Math.sign(y) * Math.abs(y) ** (2 / p) * 1.02; if (y < 0) x *= 1 - 0.12 * -y; }
    else if (kind === 'aviator') { x *= 1.12; y *= 0.95; if (y < 0) { x *= 1 - 0.25 * -y; y *= 1.12; x -= 0.18 * -y; } else y *= 0.8; }
    else if (kind === 'hexa') { const k = Math.PI / 3; const aa = ((a % k) + k) % k - k / 2; const rr = Math.cos(Math.PI / 6) / Math.cos(aa); x = Math.cos(a) * rr * 1.08; y = Math.sin(a) * rr * 0.95; }
    else if (kind === 'yoville') { const p = 2.7; let xx = Math.sign(x) * Math.abs(x) ** (2 / p), yy = Math.sign(y) * Math.abs(y) ** (2 / p); xx *= 1.22; yy *= 0.86; if (yy > 0) yy += 0.1 * ss(0.1, 1.2, xx) * yy; else xx *= 1 - 0.1 * -yy * ss(0.2, -1.2, xx) * 1.5; x = xx; y = yy; }
    else if (kind === 'wayfarer') { const p = 3.6; let xx = Math.sign(x) * Math.abs(x) ** (2 / p), yy = Math.sign(y) * Math.abs(y) ** (2 / p); xx *= 1.2; yy *= 0.8;
      if (yy < 0) xx = xx * (1 - 0.3 * -yy) + (xx > 0 ? -0.06 : 0.04) * -yy; else yy += 0.26 * ss(0, 1.2, xx) * yy; x = xx; y = yy; }
    else if (kind === 'heart2') { x = Math.sin(a) ** 3; y = (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 16; }
    pts.push(new THREE.Vector2(x * r, y * r)); }
  return pts;
}
export interface GlamGlassesBuild { solid: THREE.BufferGeometry; lens: THREE.BufferGeometry; speck: boolean; tris: number }
export function buildGlamGlasses(model: AccModel, frame: string, lens: string, lens2: string, accent: string | undefined, t: Prepared): GlamGlassesBuild | null {
  const gl = GLAM_GLASSES[model]; if (!gl) return null;
  const fe = t.parts.features; const eyes = [new THREE.Vector3(...fe.eyeP), new THREE.Vector3(...fe.eyeN)]; const eyeY = eyes[0].y;
  const fz = Math.min(t.faceZ(eyes[0].x, eyeY, 0.03), t.faceZ(0, eyeY, 0.02)) - 0.016 + (gl.dz ?? 0);
  const r = gl.r, th = gl.th; const solid: THREE.BufferGeometry[] = []; const lensG: THREE.BufferGeometry[] = []; const acc = accent ?? frame;
  const pts = lensPts(gl.kind, r); const ly = eyeY - 0.004;
  for (const e of eyes) { const mirror = e.x < 0 ? -1 : 1; const cx = e.x * 1.02;
    if (gl.puffy) { let W = pts.map((q) => { const l = q.length(); const k = (l + th * 0.45) / l; return new THREE.Vector3(cx + q.x * mirror * k, ly + q.y * k, fz - 0.001); });
      // half-rim: keep the upper arc (from a bit below the equator on each side), the lower edge of the lens stays bare
      if (gl.half) { const top = W.map((p, i) => ({ p, a: (i / W.length) * Math.PI * 2 })).filter((q) => q.a <= Math.PI + 0.22 || q.a >= Math.PI * 2 - 0.22);
        const k0 = top.findIndex((q) => q.a >= Math.PI * 2 - 0.22); W = [...top.slice(k0), ...top.slice(0, k0)].map((q) => q.p); }
      const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(W, !gl.half, 'centripetal'), gl.half ? 26 : 44, gl.rim ?? 0.009, 8, !gl.half); const pa = tg.getAttribute('position');
      for (let i = 0; i < pa.count; i++) pa.setZ(i, fz - 0.001 + (pa.getZ(i) - fz + 0.001) * (gl.rimDepth ?? 0.85)); tg.computeVertexNormals(); solid.push(paint(tg, frame)); }
    else { const outer = new THREE.Shape(pts.map((p) => { const l = p.length(); return new THREE.Vector2((p.x * (l + th)) / l * -mirror, (p.y * (l + th)) / l); }));
      outer.holes.push(new THREE.Path(pts.map((p) => new THREE.Vector2(p.x * -mirror, p.y)).reverse()));
      const fr = new THREE.ExtrudeGeometry(outer, { depth: gl.depth ?? 0.006, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0012, bevelSegments: 1, curveSegments: 4 });
      fr.translate(0, 0, -0.003); fr.rotateY(Math.PI); fr.translate(cx, ly, fz); solid.push(paint(fr, frame)); }
    if (gl.half) { for (const q of [0, 1]) { const end = q ? pts[Math.round(pts.length / 2 + 2)] : pts[pts.length - 2]; const l = end.length(); const k = (l + th * 0.45) / l;
      solid.push(paint(new THREE.SphereGeometry(gl.rim ?? 0.009, 8, 6).translate(cx + end.x * mirror * k, ly + end.y * k, fz - 0.001), frame)); } }
    if (gl.brow) { const W = pts.filter((p) => p.y > r * 0.25).sort((a, b) => a.x - b.x).map((q) => new THREE.Vector3(cx + q.x * mirror, ly + q.y + th * 0.9, fz - 0.004));
      if (W.length > 2) solid.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(W), 16, th * 0.6, 6, false), frame)); }
    if (gl.gems) { solid.push(paint(new THREE.IcosahedronGeometry(0.0055, 0).translate(cx + Math.sign(e.x) * r * 1.05, ly + r * 0.55, fz - 0.003), acc)); }
    const ls = new THREE.ShapeGeometry(new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * -mirror, p.y))), 1);
    const lc = new THREE.Color(lens), lc2 = new THREE.Color(lens2); const cols: number[] = []; const pp = ls.getAttribute('position');
    for (let i = 0; i < pp.count; i++) { const c = lc2.clone().lerp(lc, ss(-r, r, pp.getY(i))); cols.push(c.r, c.g, c.b); }
    ls.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); ls.rotateY(Math.PI); ls.translate(cx, ly, fz + 0.0015); lensG.push(clean(ls, ['position', 'normal', 'color']));
  }
  // bridge
  const span = Math.abs(eyes[0].x - eyes[1].x) * 1.02;
  if (gl.puffy) { const ix = Math.abs(eyes[0].x) * 1.02 - r * 1.15; const by = ly + r * 0.42;
    const cv = new THREE.CatmullRomCurve3([new THREE.Vector3(ix, by - 0.004, fz - 0.001), new THREE.Vector3(ix * 0.45, by + 0.006, fz - 0.006), new THREE.Vector3(0, by + 0.009, fz - 0.008), new THREE.Vector3(-ix * 0.45, by + 0.006, fz - 0.006), new THREE.Vector3(-ix, by - 0.004, fz - 0.001)]);
    solid.push(paint(new THREE.TubeGeometry(cv, 16, (gl.rim ?? 0.009) * 0.75, 8, false), frame)); }
  else for (const by of gl.kind === 'aviator' ? [0.012, 0.03] : [0.008]) { const br = gl.bridgeR ?? (gl.wire ? 0.0022 : 0.0035);
    solid.push(paint(new THREE.CylinderGeometry(br, br, span - 2 * r * (gl.kind === 'aviator' ? 1.0 : 0.95), 6).rotateZ(Math.PI / 2).translate(0, eyeY + by - 0.004, fz), frame)); }
  // temples (fitted over the ears)
  const outerX = Math.max(...pts.map((p) => Math.abs(p.x))) + th * 0.72; const hingeX = Math.abs(fe.eyeP[0]) * 1.02 + outerX;
  solid.push(paint(fitTemples(t, hingeX, eyeY + 0.008, fz, 0.0032).geo.clone(), frame));
  const s = mergeGeometries(solid)!; const l = mergeGeometries(lensG)!;
  return { solid: s, lens: l, speck: !!gl.speck, tris: (s.getAttribute('position').count + l.getAttribute('position').count) / 3 };
}
const speckCache = new Map<string, THREE.Material>();
/** P1-B "Terrazzo bleu": pink acetate with softened plum marbling (25 %), large blue chips + light flecks, slight glow on the
 *  blue chips only. Procedural (object-space value noise), 0 texture, 1 material. */
export function speckMaterial(frame: string, speck: string): THREE.Material {
  const key = frame + speck; const hit = speckCache.get(key); if (hit) return hit;
  const m = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 110, specular: new THREE.Color('#8a7a88'), emissive: new THREE.Color('#2a1c22') });
  const sc = new THREE.Color(speck), mc = new THREE.Color('#c66a9e'), sc2 = new THREE.Color('#d4f3ff');
  m.onBeforeCompile = (sh) => { sh.uniforms.sc = { value: sc }; sh.uniforms.mc = { value: mc }; sh.uniforms.sc2 = { value: sc2 };
    sh.vertexShader = 'varying vec3 vO;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vO = position;');
    sh.fragmentShader = 'uniform vec3 sc; uniform vec3 mc; uniform vec3 sc2; varying vec3 vO; float ywSp = 0.0;\nfloat h3(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}\nfloat vn(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}\n'
      + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float mt = vn(vO * 260.0); diffuseColor.rgb = mix(diffuseColor.rgb, mc, smoothstep(0.45, 0.85, mt) * 0.25);
        float sp = vn(vO * 165.0); float sp2 = vn(vO * 280.5 + 7.3);
        ywSp = smoothstep(0.58, 0.63, sp); diffuseColor.rgb = mix(diffuseColor.rgb, sc, ywSp);
        diffuseColor.rgb = mix(diffuseColor.rgb, sc2, smoothstep(0.86, 0.9, sp2) * 0.9);`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += sc * ywSp * 0.45;'); };
  m.customProgramCacheKey = () => 'yw-speck'; speckCache.set(key, m); return m;
}
