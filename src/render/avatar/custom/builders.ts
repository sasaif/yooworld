import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AccModel, BeardStyle, HairStyle } from '../../../fashion/types';
import { PART } from './parts';
import type { Prepared } from './source';
/** Geometry builders for customisable parts. Everything is authored in the TARGET avatar's bind-pose
 *  mesh space and parented to a bone attachment group (see CustomAvatar.attach), so it follows animation.
 *  Hair & beards are textured from the hair island of the shared atlas (recoloured by the compositor). */
const HAIR_UV = { u0: 0.425, u1: 0.545, v0: 0.4, v1: 0.6 }; // safely inside the hair "leaf" island
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hairUV = (a: number, b: number) => [HAIR_UV.u0 + (HAIR_UV.u1 - HAIR_UV.u0) * (((a % 1) + 1) % 1), HAIR_UV.v0 + (HAIR_UV.v1 - HAIR_UV.v0) * Math.min(1, Math.max(0, b))];

/** Move a geometry from a source avatar's mesh space to the target's (head-bone aligned). */
export function transferHead(g: THREE.BufferGeometry, from: Prepared, to: Prepared) {
  if (from === to) return g;
  const m = new THREE.Matrix4().copy(to.ibmHead).invert().multiply(from.ibmHead); const c = g.clone(); c.applyMatrix4(m); return c;
}
/** Scalp shell from the target head skin above a hairline, offset along normals (taper to 0 at the hairline). */
function scalp(t: Prepared, thick: number | ((az: number, el: number, w: number) => number), back = -32, frontAboveBrow = 9): THREE.BufferGeometry {
  const br = t.parts.features.browP; const bdy = br[1] - t.cranium.y, bdh = Math.hypot(br[0] - t.cranium.x, br[2] - t.cranium.z);
  const front = (Math.atan2(bdy, bdh) * 180) / Math.PI + frontAboveBrow;
  const g = t.mesh.geometry; const pos = g.getAttribute('position'); const nor = g.getAttribute('normal'); const idx = g.getIndex()!; const vp = t.parts.vertexPart; const C = t.cranium;
  const info = new Map<number, { p: THREE.Vector3; w: number; az: number; el: number }>();
  const thr = (az: number) => { const c = Math.cos(az); /* +1 front (-Z) … -1 back */ return c > 0 ? -6 + (front + 6) * ss(0.25, 0.85, c) : -6 + (back + 6) * ss(0.1, 0.8, -c); };
  for (let i = 0; i < vp.length; i++) {
    if (vp[i] !== PART.SKIN_HEAD) continue; const p = new THREE.Vector3().fromBufferAttribute(pos, i); const d = p.clone().sub(C);
    const az = Math.atan2(d.x, -d.z); const el = (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI; const th = thr(az);
    if (el < th - 1) continue; info.set(i, { p, w: ss(th - 1, th + 9, el), az, el });
  }
  const P: number[] = [], N: number[] = [], U: number[] = [], I: number[] = []; const remap = new Map<number, number>();
  for (let tI = 0; tI < idx.count / 3; tI++) {
    const vs = [idx.getX(tI * 3), idx.getX(tI * 3 + 1), idx.getX(tI * 3 + 2)]; if (!vs.every((v) => info.has(v))) continue;
    for (const v of vs) {
      let k = remap.get(v);
      if (k === undefined) { const o = info.get(v)!; const n = new THREE.Vector3().fromBufferAttribute(nor, v).normalize(); const h = typeof thick === 'number' ? thick * o.w : thick(o.az, o.el, o.w);
        const q = o.p.clone().addScaledVector(n, 0.0008 + h); k = P.length / 3; P.push(q.x, q.y, q.z); N.push(n.x, n.y, n.z); const uv = hairUV(o.az / (Math.PI * 2) + 0.5, 1 - (o.el + 40) / 130); U.push(uv[0], uv[1]); remap.set(v, k); }
      I.push(k);
    }
  }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); out.setIndex(I);
  out.computeVertexNormals(); return out;
}
/** Tube along a curve with a radius profile (ponytails, pigtails), hair-textured. */
function tube(curve: THREE.Curve<THREE.Vector3>, radius: (t: number) => number, seg = 18, rad = 10, squash = 1): THREE.BufferGeometry {
  const g = new THREE.TubeGeometry(curve, seg, 1, rad, false); const pos = g.getAttribute('position'); const uv = g.getAttribute('uv'); const frames = curve.computeFrenetFrames(seg, false);
  for (let i = 0; i <= seg; i++) { const t = i / seg; const c = curve.getPointAt(t); for (let j = 0; j <= rad; j++) { const k = i * (rad + 1) + j; const v = new THREE.Vector3().fromBufferAttribute(pos, k).sub(c);
    const nn = frames.normals[i], bb = frames.binormals[i]; const a = v.dot(nn), b = v.dot(bb) * squash; const r = radius(t); pos.setXYZ(k, c.x + (nn.x * a + bb.x * b) * r, c.y + (nn.y * a + bb.y * b) * r, c.z + (nn.z * a + bb.z * b) * r);
    const h = hairUV(j / rad, t); uv.setXY(k, h[0], h[1]); } }
  g.computeVertexNormals(); return g;
}
/** Curtain of hair hanging behind/around the head (bob, long). */
function curtain(t: Prepared, yTop: number, yBot: number, az0: number, az1: number, extra: number, flare: number, wave = 0): THREE.BufferGeometry {
  const C = t.cranium; const cols = 28, rows = 10; const P: number[] = [], U: number[] = [], I: number[] = [];
  for (let r = 0; r <= rows; r++) { const v = r / rows; const y = yTop + (yBot - yTop) * v;
    for (let c = 0; c <= cols; c++) { const u = c / cols; const az = az0 + (az1 - az0) * u; const edge = Math.min(1, Math.min(u, 1 - u) / 0.14); const R = t.headRadius(az, Math.max(y, C.y - 0.02)) + (extra + flare * v * v) * (0.25 + 0.75 * edge * edge) + Math.sin(u * 22) * wave * v;
      const inward = v > 0.85 ? (v - 0.85) * 0.12 : 0; P.push(C.x + Math.sin(az) * (R - inward), y, C.z - Math.cos(az) * (R - inward)); const h = hairUV(u * 0.999, v); U.push(h[0], h[1]); } }
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const a = r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1; I.push(a, d, b, b, d, e); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}
function hairBall(c: THREE.Vector3, r: number) { const g = new THREE.IcosahedronGeometry(r, 2); const uv: number[] = []; const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i).normalize(); const h = hairUV(Math.atan2(v.x, v.z) / (Math.PI * 2) + 0.5, v.y * 0.5 + 0.5); uv.push(h[0], h[1]); }
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.translate(c.x, c.y, c.z); return g; }
const strip = (g: THREE.BufferGeometry) => { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv'].includes(k)) o.deleteAttribute(k); if (!o.getAttribute('normal')) o.computeVertexNormals(); return o; };
/** distance from C to the farthest vertex of g lying within ~12° of direction d */
function rayR(g: THREE.BufferGeometry, C: THREE.Vector3, d: THREE.Vector3) { const p = g.getAttribute('position'); let best = 0.15; const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(C); const l = v.length(); if (l > 1e-4 && v.dot(d) / l > 0.978) best = Math.max(best, l); } return best; }
const dirAt = (C: THREE.Vector3, az: number, el: number, r: number) => new THREE.Vector3(C.x + Math.sin(az) * Math.cos(el) * r, C.y + Math.sin(el) * r, C.z - Math.cos(az) * Math.cos(el) * r);
/** Hair-textured ellipsoid (low poly; braid lobes, high bun). */
function hairEgg(c: THREE.Vector3, r: THREE.Vector3, w = 10, h = 7, rot?: THREE.Euler) { const g = new THREE.SphereGeometry(1, w, h); const p = g.getAttribute('position'); const uv = g.getAttribute('uv');
  for (let i = 0; i < p.count; i++) { const hh = hairUV(uv.getX(i), 1 - uv.getY(i)); uv.setXY(i, hh[0], hh[1]); }
  g.scale(r.x, r.y, r.z); if (rot) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(rot)); g.translate(c.x, c.y, c.z); return g; }
/** Hair-textured torus (bun wrap, braid ties) merged into the hair mesh: no extra draw call. */
function hairRing(c: THREE.Vector3, axis: THREE.Vector3, R: number, r: number, seg = 16, rad = 6) { const g = new THREE.TorusGeometry(R, r, rad, seg); const uv = g.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) { const hh = hairUV(uv.getX(i), 0.15 + 0.7 * uv.getY(i)); uv.setXY(i, hh[0], hh[1]); }
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis.clone().normalize())); g.translate(c.x, c.y, c.z); return g; }
/** Phase B: high doll bun on the crown + two thin face strands. Sizes scale with the target head (k), positions
 *  are found on the target's own cap (rayR), so it fits Juanita and Juan alike. */
function bunHigh(t: Prepared, cap: THREE.BufferGeometry, parts: THREE.BufferGeometry[]) {
  const C = t.cranium; const k = t.headRadius(Math.PI, C.y) / 0.2424; const up = new THREE.Vector3(0, 1, 0.12).normalize(); const top = C.clone().addScaledVector(up, rayR(cap, C, up));
  parts.push(hairEgg(top.clone().add(new THREE.Vector3(0, 0.062 * k, 0.012 * k)), new THREE.Vector3(0.105, 0.088, 0.1).multiplyScalar(k), 14, 9));
  parts.push(hairRing(top.clone().add(new THREE.Vector3(0, 0.004 * k, 0.004 * k)), new THREE.Vector3(0, 1, 0.18), 0.082 * k, 0.02 * k));
  for (const sd of [1, -1]) {
    const a0 = sd * 1.0, a1 = sd * 1.22; const d0 = new THREE.Vector3(Math.sin(a0) * Math.cos(0.5), Math.sin(0.5), -Math.cos(a0) * Math.cos(0.5));
    const s = C.clone().addScaledVector(d0, rayR(cap, C, d0) - 0.004 * k); const yEnd = C.y - 0.1 * k; const e = dirAt(C, a1, 0, t.headRadius(a1, yEnd) + 0.026 * k); e.y = yEnd;
    const m = s.clone().lerp(e, 0.45); const out = new THREE.Vector3(m.x - C.x, 0, m.z - C.z).normalize(); m.addScaledVector(out, 0.03 * k);
    parts.push(tube(new THREE.CatmullRomCurve3([s, m, e]), (x) => (0.016 - 0.008 * x) * k, 6, 5));
  }
}
/** Phase B: two braids from behind the ears falling forward over the shoulders (7 lobes + a tie each). */
function braids(t: Prepared, parts: THREE.BufferGeometry[]) {
  const C = t.cranium; const k = t.headRadius(Math.PI, C.y) / 0.2424;
  for (const sd of [1, -1]) {
    const a0 = sd * 2.09; const y0 = C.y + 0.036 * k; const s = dirAt(C, a0, 0, t.headRadius(a0, y0) - 0.004 * k); s.y = y0;
    const e = new THREE.Vector3(C.x + sd * 0.17 * k, C.y - 0.234 * k, C.z - 0.054 * k);
    const cur = new THREE.CatmullRomCurve3([s, s.clone().lerp(e, 0.5).add(new THREE.Vector3(sd * 0.022 * k, 0, 0.02 * k)), e]);
    parts.push(tube(new THREE.CatmullRomCurve3([s.clone().add(new THREE.Vector3(-sd * 0.02 * k, 0.03 * k, -0.01 * k)), s]), () => 0.024 * k, 4, 6));
    for (let i = 0; i < 7; i++) { const u = i / 6; const p = cur.getPointAt(u * 0.94);
      parts.push(hairEgg(p, new THREE.Vector3(0.028 - 0.006 * u, 0.026, 0.024).multiplyScalar(k), 8, 5, new THREE.Euler(0, 0, sd * (i % 2 ? 0.55 : -0.55)))); }
    const end = cur.getPointAt(1); parts.push(hairRing(end, cur.getTangentAt(1), 0.016 * k, 0.006 * k, 12, 5));
    parts.push(tube(new THREE.CatmullRomCurve3([end, end.clone().add(new THREE.Vector3(0, -0.035 * k, -0.006 * k))]), (x) => (0.016 - 0.01 * x) * k, 4, 6));
  }
}

export interface HairBuild { hair: THREE.BufferGeometry; ties: { pos: THREE.Vector3; r: number; axis: THREE.Vector3 }[]; /** geometry the hats are fitted on */ under: THREE.BufferGeometry }
const hairCache = new Map<string, HairBuild>();
export function buildHair(style: HairStyle, hat: boolean, t: Prepared, f: Prepared, m: Prepared): HairBuild {
  const key = `${style}|${hat}|${t.parts.vertexCount}|${t.parts.features.headTop[1]}`; const hit = hairCache.get(key); if (hit) return hit;
  const C = t.cranium; const fe = t.parts.features; const fCap = transferHead(f.hairCap, f, t); const mCap = transferHead(m.hairCap, m, t);
  const parts: THREE.BufferGeometry[] = []; const ties: HairBuild['ties'] = []; let under = fCap;
  const R = t.headRadius(Math.PI, C.y);
  const buzz = () => scalp(t, 0.0045);
  switch (hat && ['buns', 'afro', 'mohawk', 'manbun', 'quiff', 'bun_high'].includes(style) ? (style === 'buns' || style === 'bun_high' ? 'bob0' : 'buzz') : style) {
    case 'buns': parts.push(fCap); if (f.buns) parts.push(transferHead(f.buns, f, t)); break;
    case 'bob0': parts.push(fCap); break;
    case 'bun_high': parts.push(fCap); bunHigh(t, fCap, parts); break;
    case 'braids': parts.push(fCap); braids(t, parts); break;
    case 'quiff': parts.push(mCap); under = mCap; break;
    case 'buzz': { const g = buzz(); parts.push(g); under = g; break; }
    case 'bob': parts.push(fCap, curtain(t, C.y + 0.02, fe.mouth[1] - 0.012, Math.PI - 1.85, Math.PI + 1.85, 0.012, 0.01)); break;
    case 'long': parts.push(fCap, curtain(t, C.y + 0.03, fe.neck[1] - 0.025, Math.PI - 1.95, Math.PI + 1.95, 0.014, 0.03, 0.004)); break;
    case 'pony': { parts.push(fCap); const s = dirAt(C, Math.PI, 0.32, R + 0.03);
      const cur = new THREE.CatmullRomCurve3([s, s.clone().add(new THREE.Vector3(0, -0.01, 0.06)), s.clone().add(new THREE.Vector3(0, -0.09, 0.09)), new THREE.Vector3(0, fe.mouth[1] - 0.07, s.z + 0.07)]);
      parts.push(tube(cur, (x) => 0.026 + Math.sin(Math.min(1, x * 1.6) * Math.PI) * 0.018 - x * 0.016, 20, 10)); ties.push({ pos: s.clone().add(new THREE.Vector3(0, 0, 0.012)), r: 0.024, axis: new THREE.Vector3(0, 0.3, 1).normalize() }); break; }
    case 'pigtails': { parts.push(fCap); for (const sd of [1, -1]) { const s = dirAt(C, sd * 1.95, 0.1, t.headRadius(sd * 1.95, C.y) + 0.02);
      const cur = new THREE.CatmullRomCurve3([s, s.clone().add(new THREE.Vector3(sd * 0.05, -0.03, 0.01)), s.clone().add(new THREE.Vector3(sd * 0.075, -0.1, 0.0)), s.clone().add(new THREE.Vector3(sd * 0.06, -0.17, -0.01))]);
      parts.push(tube(cur, (x) => 0.022 + Math.sin(Math.min(1, x * 1.4) * Math.PI) * 0.014 - x * 0.014, 16, 9)); ties.push({ pos: s.clone().add(new THREE.Vector3(sd * 0.012, -0.004, 0)), r: 0.021, axis: new THREE.Vector3(sd, -0.4, 0).normalize() }); } break; }
    case 'manbun': { const g = scalp(t, 0.007); parts.push(g); under = g; const c = dirAt(C, Math.PI, 0.95, R + 0.035); parts.push(hairBall(c, 0.05)); ties.push({ pos: dirAt(C, Math.PI, 0.95, R + 0.0), r: 0.03, axis: c.clone().sub(C).normalize() }); break; }
    case 'afro': { const g = scalp(t, (az, el, w) => w * (0.05 + 0.012 * Math.sin(az * 9) * Math.sin(el * 0.2) + 0.006 * Math.sin(az * 23 + el)), -45, 12); parts.push(g); under = g; break; }
    case 'mohawk': { const g = scalp(t, 0.0022); parts.push(g); under = g;
      for (let i = 0; i < 7; i++) {
        const a = Math.PI / 2 + 0.95 - i * 0.32; const d = new THREE.Vector3(0, Math.sin(a), -Math.cos(a)); const rr = rayR(g, C, d);
        const cone = new THREE.ConeGeometry(0.03, 0.078 - Math.abs(i - 3) * 0.008, 8, 1); cone.scale(0.42, 1, 1); cone.translate(0, 0.039, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d)); const pp = C.clone().addScaledVector(d, rr - 0.006); cone.translate(pp.x, pp.y, pp.z);
        const uv: number[] = []; const p = cone.getAttribute('position'); for (let k = 0; k < p.count; k++) { const h = hairUV(k / p.count, p.getY(k) - pp.y > 0 ? 0.2 : 0.8); uv.push(h[0], h[1]); } cone.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); parts.push(cone);
      }
      break; }
  }
  const hair = mergeGeometries(parts.map(strip), false)!; const out = { hair, ties, under }; hairCache.set(key, out); return out;
}
/** Beard: skinned shell over the jaw region of the head skin (copies skin weights AND morph targets,
 *  so it follows talking/smiling and the face-shape morphs). Stubble-only = texture layer. */
export function buildBeard(style: BeardStyle, t: Prepared): THREE.BufferGeometry | null {
  if (style === 'none' || style === 'stubble') return null;
  const g = t.body; const pos = g.getAttribute('position'); const nor = g.getAttribute('normal'); const idx = g.getIndex()!; const vp = t.parts.vertexPart; const fe = t.parts.features;
  const [, ym] = fe.mouth; const yc = fe.chin[1]; const hz = fe.headCenter[2]; const earY = fe.earP[1];
  const thick = { goatee: 0.006, short: 0.0035, full: 0.008, mustache: 0.0045 }[style];
  const W = new Float32Array(vp.length);
  for (let i = 0; i < vp.length; i++) {
    if (vp[i] !== PART.SKIN_HEAD) continue; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); if (z > hz + 0.03) continue;
    const lip = (x / 0.03) ** 2 + ((y - ym) / 0.012) ** 2; const ax = Math.abs(x);
    const must = ss(0.042, 0.03, ax) * ss(ym + 0.004, ym + 0.009, y) * ss(ym + 0.026, ym + 0.019, y);
    let w = 0;
    if (style === 'mustache') w = must;
    else if (style === 'goatee') w = Math.max(must, ss(0.042, 0.028, ax) * ss(ym - 0.006, ym - 0.016, y) * ss(fe.neck[1] + 0.035, fe.neck[1] + 0.05, y));
    else { const top = ax > 0.11 ? earY - 0.004 : ym + 0.024 + (ax / 0.11) * (earY - ym - 0.03); w = Math.max(must, ss(top + 0.002, top - 0.012, y) * ss(fe.neck[1] + 0.02, fe.neck[1] + 0.045, y) * ss(1, 1.6, lip) * ss(0.235, 0.2, ax)); }
    W[i] = w;
  }
  const tris: number[] = [];
  for (let k = 0; k < idx.count / 3; k++) { const a = idx.getX(k * 3), b = idx.getX(k * 3 + 1), c = idx.getX(k * 3 + 2); if (W[a] > 0.02 || W[b] > 0.02 || W[c] > 0.02) tris.push(a, b, c); }
  if (!tris.length) return null;
  const map = new Map<number, number>(); const order: number[] = []; const I = tris.map((v) => { let m = map.get(v); if (m === undefined) { m = order.length; map.set(v, m); order.push(v); } return m; });
  const P = new Float32Array(order.length * 3), N = new Float32Array(order.length * 3), U = new Float32Array(order.length * 2), SI = new Uint16Array(order.length * 4), SW = new Float32Array(order.length * 4);
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  order.forEach((v, j) => { const n = new THREE.Vector3().fromBufferAttribute(nor, v).normalize(); const w = W[v]; let h = 0.0006 + w * thick;
    const y = pos.getY(v); const chin = style === 'full' ? ss(yc + 0.03, yc - 0.01, y) * 0.012 : style === 'goatee' ? ss(yc + 0.02, yc - 0.01, y) * 0.008 : 0; h += chin * w;
    P[j * 3] = pos.getX(v) + n.x * h; P[j * 3 + 1] = y + n.y * h - chin * w * 0.6; P[j * 3 + 2] = pos.getZ(v) + n.z * h; N[j * 3] = n.x; N[j * 3 + 1] = n.y; N[j * 3 + 2] = n.z;
    const uv = hairUV(0.5 + pos.getX(v) * 3, (ym + 0.03 - y) * 6); U[j * 2] = uv[0]; U[j * 2 + 1] = uv[1];
    for (let c = 0; c < 4; c++) { SI[j * 4 + c] = si.getComponent(v, c); SW[j * 4 + c] = sw.getComponent(v, c); } });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); out.setIndex(I);
  // copy all morph targets for those vertices (same order as the body => same influences array)
  for (const kind of ['position', 'normal'] as const) { const list = g.morphAttributes[kind]; if (!list) continue;
    out.morphAttributes[kind] = list.map((a) => { const arr = new Float32Array(order.length * 3); order.forEach((v, j) => { arr[j * 3] = a.getX(v); arr[j * 3 + 1] = a.getY(v); arr[j * 3 + 2] = a.getZ(v); }); const b = new THREE.BufferAttribute(arr, 3); b.name = a.name; return b; }); }
  out.morphTargetsRelative = true; return out;
}
/** Skinned shell over the lower legs (boots / high-tops): copies skin weights, offset along normals. */
export function buildLegShell(t: Prepared, shaft: 'boot' | 'high'): THREE.BufferGeometry {
  const g = t.body; const pos = g.getAttribute('position'); const nor = g.getAttribute('normal'); const idx = g.getIndex()!; const vp = t.parts.vertexPart; const [y0, y1] = t.parts.features.legY;
  const top = shaft === 'boot' ? y0 + (y1 - y0) * 0.62 : y0 + (y1 - y0) * 0.3; const tris: number[] = [];
  for (let k = 0; k < idx.count / 3; k++) { const v = [idx.getX(k * 3), idx.getX(k * 3 + 1), idx.getX(k * 3 + 2)]; if (v.every((a) => vp[a] === PART.LEG && pos.getY(a) < top + 0.012)) tris.push(...v); }
  const map = new Map<number, number>(); const order: number[] = []; const I = tris.map((v) => { let m = map.get(v); if (m === undefined) { m = order.length; map.set(v, m); order.push(v); } return m; });
  const P = new Float32Array(order.length * 3), N = new Float32Array(order.length * 3), SI = new Uint16Array(order.length * 4), SW = new Float32Array(order.length * 4); const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  order.forEach((v, j) => { const n = new THREE.Vector3().fromBufferAttribute(nor, v).normalize(); const y = Math.min(pos.getY(v), top); const h = 0.0045 + (pos.getY(v) > top - 0.01 ? 0.0015 : 0);
    P[j * 3] = pos.getX(v) + n.x * h; P[j * 3 + 1] = y; P[j * 3 + 2] = pos.getZ(v) + n.z * h; N.set([n.x, n.y, n.z], j * 3); for (let c = 0; c < 4; c++) { SI[j * 4 + c] = si.getComponent(v, c); SW[j * 4 + c] = sw.getComponent(v, c); } });
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); out.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4)); out.setIndex(I); return out;
}
// ---------------- accessories (vertex-coloured, merged: 1 draw call each + optional lens) ----------------
const col = (g: THREE.BufferGeometry, c: string) => { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (k !== 'position' && k !== 'normal') o.deleteAttribute(k);
  const cc = new THREE.Color(c); const a = new Float32Array(o.getAttribute('position').count * 3); for (let i = 0; i < a.length; i += 3) { a[i] = cc.r; a[i + 1] = cc.g; a[i + 2] = cc.b; } o.setAttribute('color', new THREE.BufferAttribute(a, 3)); return o; };
const at = (g: THREE.BufferGeometry, p: THREE.Vector3 | [number, number, number], rot?: [number, number, number], s?: [number, number, number]) => { if (s) g.scale(...s); if (rot) g.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot))); const v = Array.isArray(p) ? p : [p.x, p.y, p.z]; g.translate(v[0], v[1], v[2]); return g; };
function heartShape(s: number) { const h = new THREE.Shape(); h.moveTo(0, -0.9 * s); h.bezierCurveTo(-1.4 * s, 0.1 * s, -0.7 * s, 1.1 * s, 0, 0.4 * s); h.bezierCurveTo(0.7 * s, 1.1 * s, 1.4 * s, 0.1 * s, 0, -0.9 * s); return h; }
export interface AccBuild { bone: 'Head' | 'Spine2' | 'Hips' | 'LeftHand' | 'RightHand' | 'Neck'; solid: THREE.BufferGeometry; lens?: { geo: THREE.BufferGeometry; color: string; opacity: number }; /** uses the avatar atlas (native backpack) */ textured?: boolean }
export function buildAccessory(model: AccModel, c1: string, c2: string | undefined, t: Prepared, f: Prepared, hairUnder: THREE.BufferGeometry | null): AccBuild | null {
  const fe = t.parts.features; const C = t.cranium; const parts: THREE.BufferGeometry[] = []; const c2_ = c2 ?? c1;
  const eyes = [new THREE.Vector3(...fe.eyeP), new THREE.Vector3(...fe.eyeN)]; const eyeY = eyes[0].y; const fz = Math.min(t.faceZ(eyes[0].x, eyeY, 0.03), t.faceZ(0, eyeY, 0.02)) - 0.016;
  /** ellipsoid fitted on the hair under the hat: horizontal radius R, vertical extent H above the cranium centre */
  /** box-fitted ellipsoid over the hair (or scalp) above y0 */
  const hatFit = (y0 = fe.browP[1] + 0.02) => { let top = fe.headTop[1]; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const add = (x: number, y: number, z: number) => { if (y < y0) return; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); top = Math.max(top, y); };
    const hp = t.mesh.geometry.getAttribute('position'); const vp = t.parts.vertexPart; for (let i = 0; i < vp.length; i++) if (vp[i] === PART.SKIN_HEAD) add(hp.getX(i), hp.getY(i), hp.getZ(i));
    if (hairUnder) { const p = hairUnder.getAttribute('position'); for (let i = 0; i < p.count; i++) add(p.getX(i), p.getY(i), p.getZ(i)); }
    const R = (x1 - x0) / 2 * 1.13 + 0.006; return { R, Rz: (z1 - z0) / 2 * 1.13 + 0.006, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, H: (top - y0) * 1.12 + 0.01, top, y0 }; };
  switch (model) {
    case 'glasses_round': case 'sunglasses': case 'glasses_heart': {
      const lensGeo: THREE.BufferGeometry[] = []; const r = model === 'sunglasses' ? 0.047 : 0.044;
      for (const e of eyes) { const z = fz; const p = new THREE.Vector3(e.x * 1.02, eyeY - 0.004, z);
        if (model === 'glasses_heart') { const sh = heartShape(0.036); parts.push(col(at(new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: false, curveSegments: 10 }).translate(0, 0, -0.003), p, [0, 0, 0], [1.25, -1.25, 1]), c1));
          const inner = heartShape(0.028); lensGeo.push(at(new THREE.ShapeGeometry(inner, 10), p.clone().add(new THREE.Vector3(0, 0, -0.004)), [0, Math.PI, 0], [1.25, -1.25, 1])); }
        else { const torus = new THREE.TorusGeometry(r, model === 'sunglasses' ? 0.0055 : 0.0042, 6, 28); if (model === 'sunglasses') torus.scale(1.08, 0.82, 1); parts.push(col(at(torus, p), c1));
          const disc = new THREE.CircleGeometry(r, 28); if (model === 'sunglasses') disc.scale(1.08, 0.82, 1); lensGeo.push(at(disc, p.clone().add(new THREE.Vector3(0, 0, -0.001)), [0, Math.PI, 0])); }
      }
      parts.push(col(at(new THREE.CylinderGeometry(0.004, 0.004, Math.abs(eyes[0].x - eyes[1].x) * 1.02 - 2 * r + 0.012, 6), [0, eyeY + 0.006, fz], [0, 0, Math.PI / 2]), c1));
      for (const sd of [1, -1]) { const ex = C.x + sd * Math.min(Math.abs(fe.earP[0]) - 0.004, t.headRadius(sd * Math.PI / 2, eyeY) + 0.007); const z0 = fz, z1 = fe.earP[2] - 0.01; const len = Math.abs(z1 - z0);
        parts.push(col(at(new THREE.BoxGeometry(0.006, 0.007, len), [ex, eyeY, (z0 + z1) / 2]), c1)); parts.push(col(at(new THREE.BoxGeometry(Math.abs(ex) - Math.abs(eyes[0].x) - r + 0.006, 0.007, 0.006), [sd * (Math.abs(eyes[0].x) + r + (Math.abs(ex) - Math.abs(eyes[0].x) - r) / 2), eyeY, z0]), c1)); }
      const solid = mergeGeometries(parts)!; const lens = mergeGeometries(lensGeo.map((g) => strip(g)))!;
      return { bone: 'Head', solid, lens: { geo: lens, color: model === 'sunglasses' ? c1 : c2_, opacity: model === 'sunglasses' ? 0.82 : model === 'glasses_heart' ? 0.6 : 0.18 } };
    }
    case 'earrings_pearl': case 'earrings_hoops': case 'earrings_diamond':
      for (const e of [fe.earP, fe.earN]) { const sd = Math.sign(e[0]); const p = new THREE.Vector3(e[0] + sd * 0.004, e[1] - 0.014, e[2]);
        if (model === 'earrings_pearl') parts.push(col(at(new THREE.SphereGeometry(0.0085, 12, 8), p), c1));
        else if (model === 'earrings_hoops') parts.push(col(at(new THREE.TorusGeometry(0.016, 0.0028, 6, 20), p.clone().add(new THREE.Vector3(0, -0.012, 0)), [0, Math.PI / 2, 0]), c1));
        else { parts.push(col(at(new THREE.OctahedronGeometry(0.0095, 0), p, [0, 0.4, 0], [1, 1.25, 1]), c1)); parts.push(col(at(new THREE.SphereGeometry(0.003, 6, 4), p.clone().add(new THREE.Vector3(0, 0.011, 0))), '#e6e6ee')); } }
      return { bone: 'Head', solid: mergeGeometries(parts)! };
    case 'necklace_chain': case 'necklace_heart': {
      const ny = fe.neck[1] - 0.026; const R = t.neckR + 0.034; const ring = new THREE.TorusGeometry(R, model === 'necklace_chain' ? 0.004 : 0.0028, 6, 40); ring.scale(1, 1.05, 1.15);
      parts.push(col(at(ring, [0, ny - 0.004, fe.neck[2] - 0.008], [Math.PI / 2 - 0.4, 0, 0]), c1));
      if (model === 'necklace_heart') parts.push(col(at(new THREE.ExtrudeGeometry(heartShape(0.016), { depth: 0.006, bevelEnabled: false }), [0, ny - 0.052, fe.chestFront - 0.012], [0, 0, 0], [1, -1, 1]), c2_));
      else parts.push(col(at(new THREE.SphereGeometry(0.008, 10, 8), [0, ny - 0.05, fe.chestFront - 0.01]), c1));
      return { bone: 'Spine2', solid: mergeGeometries(parts)! };
    }
    case 'scarf': { const ny = fe.neck[1] - 0.004; const ring = new THREE.TorusGeometry(t.neckR + 0.028, 0.022, 10, 32); ring.scale(1.1, 1, 1.05); parts.push(col(at(ring, [0, ny, fe.neck[2] - 0.004], [Math.PI / 2 - 0.15, 0, 0]), c1));
      parts.push(col(at(new THREE.BoxGeometry(0.045, 0.11, 0.016), [0.04, ny - 0.065, fe.chestFront - 0.016], [0.1, 0, -0.12]), c2_)); parts.push(col(at(new THREE.BoxGeometry(0.045, 0.012, 0.018), [0.046, ny - 0.118, fe.chestFront - 0.024], [0.1, 0, -0.12]), c1));
      return { bone: 'Spine2', solid: mergeGeometries(parts)! }; }
    case 'cap': case 'beanie': case 'strawhat': case 'crown': {
      const { R, top } = hatFit(); const cy = C.y; void cy; const tilt = -0.18; // front up
      if (model === 'crown') { const r = Math.min(R * 0.6, 0.12); const y = top - 0.035; const band = new THREE.CylinderGeometry(r, r * 0.92, 0.05, 24, 1, true); parts.push(col(at(band, [0, y + 0.02, C.z + 0.01], [0.12, 0, 0]), c1));
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; parts.push(col(at(new THREE.ConeGeometry(0.016, 0.045, 6), [Math.sin(a) * r, y + 0.065 - Math.cos(a) * 0.006, C.z + 0.01 - Math.cos(a) * r], [0.12, 0, 0]), c1));
          parts.push(col(at(new THREE.SphereGeometry(0.009, 8, 6), [Math.sin(a) * r * 1.02, y + 0.02, C.z + 0.01 - Math.cos(a) * r * 1.02]), i % 2 ? c2_ : '#7fe0ff')); }
        return { bone: 'Head', solid: mergeGeometries(parts)! }; }
      const fit = hatFit(fe.browP[1] + (model === 'beanie' ? 0.012 : 0.024)); const H = fit.H; const th = model === 'beanie' ? 1.66 : 1.57; const R2 = fit.R; const cy2 = fit.y0; const hz = fit.cz;
      const dome = new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, th); dome.scale(R2, H, fit.Rz); parts.push(col(at(dome, [0, cy2, hz], [tilt, 0, 0]), c1));
      const rimY = cy2 + Math.cos(th) * H; const rimR = R2 * Math.sin(th);
      if (model === 'cap') { const brim = new THREE.CylinderGeometry(rimR * 0.95, rimR * 0.95, 0.01, 24, 1, false, -0.95, 1.9); brim.scale(1, 1, 1.35); parts.push(col(at(brim, [0, rimY + 0.01, hz - 0.03], [tilt - 0.05, Math.PI, 0]), c2_));
        parts.push(col(at(new THREE.SphereGeometry(0.014, 8, 6), [0, cy2 + H, hz + Math.sin(-tilt) * H * 0.2]), c2_)); }
      if (model === 'beanie') { const band = new THREE.TorusGeometry(1, 0.02, 8, 32); band.scale(rimR + 0.006, rimR * 1.04 + 0.006, 1); parts.push(col(at(band, [0, rimY + 0.012, hz], [Math.PI / 2 + tilt, 0, 0]), c2_)); parts.push(col(at(new THREE.IcosahedronGeometry(0.035, 1), [0, cy2 + H + 0.025, hz + Math.sin(-tilt) * H * 0.2]), c2_)); }
      if (model === 'strawhat') { const brim = new THREE.RingGeometry(rimR * 0.95, rimR * 1.7, 36, 1); parts.push(col(at(brim, [0, rimY, hz], [-Math.PI / 2 + tilt, 0, 0]), c1)); const brimB = new THREE.RingGeometry(rimR * 0.95, rimR * 1.7, 36, 1); parts.push(col(at(brimB, [0, rimY - 0.002, hz], [Math.PI / 2 + tilt, 0, 0]), c1));
        const band = new THREE.CylinderGeometry(rimR * 0.99, rimR * 1.0, 0.03, 32, 1, true); parts.push(col(at(band, [0, rimY + 0.017, hz], [tilt, 0, 0]), c2_)); }
      return { bone: 'Head', solid: mergeGeometries(parts)! };
    }
    case 'headphones': { const { R } = hatFit(); const band = new THREE.TorusGeometry(R + 0.012, 0.009, 6, 32, Math.PI); parts.push(col(at(band, [0, C.y - 0.02, C.z + 0.01], [0, 0, 0], [1.02, 1, 1]), c1));
      for (const sd of [1, -1]) { const x = sd * (Math.abs(fe.earP[0]) + 0.012); parts.push(col(at(new THREE.CylinderGeometry(0.04, 0.04, 0.024, 20), [x, fe.earP[1] + 0.01, fe.earP[2] - 0.01], [0, 0, Math.PI / 2]), c2_)); parts.push(col(at(new THREE.CylinderGeometry(0.03, 0.03, 0.026, 16), [x * 1.04, fe.earP[1] + 0.01, fe.earP[2] - 0.01], [0, 0, Math.PI / 2]), c1)); }
      return { bone: 'Head', solid: mergeGeometries(parts)! }; }
    case 'backpack': if (!f.bag) return null; return { bone: 'Spine2', solid: transferSpine(f.bag, f, t), textured: true };
    case 'beltbag': { const y = fe.hipsY - 0.015; const rx = fe.hipsHalfW + 0.006, rz = (fe.hipsBack - fe.hipsFront) / 2 + 0.006, cz = (fe.hipsBack + fe.hipsFront) / 2;
      const belt = new THREE.TorusGeometry(1, 0.006, 6, 40); belt.scale(rx, rz, 1); parts.push(col(at(belt, [0, y, cz], [Math.PI / 2, 0, 0]), c2_));
      const bag = new THREE.CapsuleGeometry(0.03, 0.07, 4, 10); parts.push(col(at(bag, [0.02, y - 0.012, fe.hipsFront - 0.025], [0, 0, Math.PI / 2 + 0.25], [1, 1, 0.65]), c1));
      parts.push(col(at(new THREE.BoxGeometry(0.08, 0.004, 0.004), [0.02, y + 0.0, fe.hipsFront - 0.045], [0, 0, 0.25]), c2_));
      return { bone: 'Hips', solid: mergeGeometries(parts)! }; }
    case 'tote': { // authored in bind (A-pose) space beyond the hand along the arm, so it hangs below the hand when the arm is down
      const w = fe.wristN; const sd = Math.sign(w[0]); const p = new THREE.Vector3(w[0] + sd * 0.13, w[1] - 0.004, w[2]);
      parts.push(col(at(new THREE.BoxGeometry(0.12, 0.035, 0.125), p), c1)); parts.push(col(at(new THREE.BoxGeometry(0.014, 0.037, 0.127), p.clone().add(new THREE.Vector3(-sd * 0.04, 0, 0))), c2_));
      parts.push(col(at(new THREE.TorusGeometry(0.036, 0.0045, 6, 16, Math.PI), p.clone().add(new THREE.Vector3(-sd * 0.06, 0, 0)), [Math.PI / 2, 0, sd * Math.PI / 2]), c2_));
      return { bone: w[0] < 0 ? 'LeftHand' : 'RightHand', solid: mergeGeometries(parts)! }; }
    case 'watch': { const w = fe.wristP; const sd = Math.sign(w[0]); const p = new THREE.Vector3(w[0] - sd * 0.014, w[1], w[2]); const band = new THREE.TorusGeometry(0.02, 0.005, 6, 18); parts.push(col(at(band, p, [0, Math.PI / 2, 0]), c1));
      parts.push(col(at(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 16), p.clone().add(new THREE.Vector3(0, 0.022, 0))), '#f2f2f2')); parts.push(col(at(new THREE.CylinderGeometry(0.008, 0.008, 0.0065, 16), p.clone().add(new THREE.Vector3(0, 0.0225, 0))), c2_));
      return { bone: w[0] < 0 ? 'LeftHand' : 'RightHand', solid: mergeGeometries(parts)! }; }
  }
  return null;
}
function transferSpine(g: THREE.BufferGeometry, from: Prepared, to: Prepared) {
  if (from === to) return g.clone(); const a = new THREE.Matrix4().fromArray(from.parts.ibm.Spine2), b = new THREE.Matrix4().fromArray(to.parts.ibm.Spine2);
  const c = g.clone(); c.applyMatrix4(new THREE.Matrix4().copy(b).invert().multiply(a)); const sx = to.parts.features.torsoHalfW / from.parts.features.torsoHalfW; const p = c.getAttribute('position'); for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) * sx); return c;
}
/** Jacket extras (rigid on Spine2): hood or fur collar. */
export function buildJacketExtra(kind: 'hood' | 'fur', c1: string, c2: string, t: Prepared): THREE.BufferGeometry {
  const fe = t.parts.features; const parts: THREE.BufferGeometry[] = []; const ny = fe.neck[1];
  if (kind === 'hood') { const h = new THREE.TorusGeometry(t.neckR + 0.05, 0.034, 10, 26, Math.PI * 1.25); parts.push(col(at(h, [0, ny - 0.0, fe.neck[2] + 0.025], [Math.PI / 2 - 0.35, 0, Math.PI * 0.875 + Math.PI], [1.05, 1.12, 0.8]), c1));
    const inner = new THREE.TorusGeometry(t.neckR + 0.05, 0.026, 8, 22, Math.PI * 1.1); parts.push(col(at(inner, [0, ny + 0.006, fe.neck[2] + 0.03], [Math.PI / 2 - 0.35, 0, Math.PI * 0.95 + Math.PI], [1.0, 1.06, 0.8]), c2));
    for (const sd of [1, -1]) parts.push(col(at(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 5), [sd * 0.025, ny - 0.05, fe.chestFront - 0.006]), '#ffffff')); }
  else { const fur = new THREE.TorusGeometry(t.neckR + 0.04, 0.026, 10, 32); const p = fur.getAttribute('position'); for (let i = 0; i < p.count; i++) { const n = 1 + 0.18 * Math.sin(i * 1.7) * Math.sin(i * 0.37); p.setXYZ(i, p.getX(i), p.getY(i), p.getZ(i) * n); } fur.computeVertexNormals();
    parts.push(col(at(fur, [0, ny - 0.006, fe.neck[2] - 0.004], [Math.PI / 2 - 0.2, 0, 0], [1.12, 1.05, 1]), '#f5ead8')); }
  return mergeGeometries(parts)!;
}
