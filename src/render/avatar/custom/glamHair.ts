import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { HairStyle } from '../../../fashion/types';
import { col, hairUV } from './builders';
import { PART } from './parts';
import type { Prepared } from './source';
/** Gothic v2 hair (approved 2026-11-21), MOBILE LOD of the proto strand-clump hair (art/proposals/fashion/proto main.js buildHair2):
 *  4-sided clumps (instead of 6), ~9 rings (instead of 15–24), fewer/wider clumps, low-res scalp shell, no outline hull.
 *  Target <= 5 k triangles per hairstyle (proto: 12.9–13.9 k). Rigid on the Head bone like every in-game hairstyle.
 *  Hair clumps use the shared hair-island UVs, so the existing hair material (atlas recolour + sheen) colours them;
 *  the streak / band are a second vertex-coloured mesh (shared accessory material). Female body only (absolute heights). */
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PI = Math.PI;
interface Probe { C: THREE.Vector3; Rh: (az: number, y: number) => number }
const probes = new WeakMap<Prepared, Probe>();
function probe(t: Prepared): Probe {
  const hit = probes.get(t); if (hit) return hit; const pos = t.mesh.geometry.getAttribute('position'); const vp = t.parts.vertexPart; const C = t.cranium.clone();
  const NA = 72, y0 = 0.40, y1 = 0.92, NY = 52; const grid = new Float32Array(NA * NY);
  for (let i = 0; i < vp.length; i++) { if (vp[i] !== PART.SKIN_HEAD) continue; const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i); const yi = Math.round(((y - y0) / (y1 - y0)) * (NY - 1)); if (yi < 0 || yi >= NY) continue;
    const az = Math.atan2(x - C.x, z - C.z); const ai = ((Math.round((az / (PI * 2)) * NA) % NA) + NA) % NA; const r = Math.hypot(x - C.x, z - C.z); for (const da of [-1, 0, 1]) { const k = yi * NA + ((ai + da + NA) % NA); grid[k] = Math.max(grid[k], r); } }
  for (let pass = 0; pass < 6; pass++) { const g2 = grid.slice(); for (let yi = 0; yi < NY; yi++) for (let ai = 0; ai < NA; ai++) { let sum = 0, n = 0, mx = 0;
    for (let dy = -1; dy <= 1; dy++) for (let da = -1; da <= 1; da++) { const yy = yi + dy; if (yy < 0 || yy >= NY) continue; const v = grid[yy * NA + ((ai + da + NA) % NA)]; if (v > 0) { sum += v; n++; mx = Math.max(mx, v); } }
    g2[yi * NA + ai] = n ? (pass < 2 ? Math.max(grid[yi * NA + ai], sum / n) : 0.5 * mx + 0.5 * sum / n) : 0; } grid.set(g2); }
  const G = (ai: number, yi: number) => grid[Math.min(NY - 1, Math.max(0, yi)) * NA + (((ai % NA) + NA) % NA)];
  const R = (az: number, y: number) => { const fa = (az / (PI * 2)) * NA, fy = ((y - y0) / (y1 - y0)) * (NY - 1); const a0 = Math.floor(fa), b0 = Math.floor(fy), ta = fa - a0, ty = fy - b0;
    return (G(a0, b0) * (1 - ta) + G(a0 + 1, b0) * ta) * (1 - ty) + (G(a0, b0 + 1) * (1 - ta) + G(a0 + 1, b0 + 1) * ta) * ty; };
  const Rh = (az: number, y: number) => { let m = 0; for (let yy = y1; yy >= Math.max(y, y0); yy -= 0.01) m = Math.max(m, R(az, yy)); return m; };
  const out = { C, Rh }; probes.set(t, out); return out;
}
/** flattened tapered tube along pts (RS sides), hair-island UVs */
function clump(pts: THREE.Vector3[], w: number, th: number, out: (p: THREE.Vector3) => THREE.Vector3, taper = 0.15, RS = 4) {
  const N = pts.length; const P: number[] = [], U: number[] = [], I: number[] = []; const T = new THREE.Vector3(), Nn = new THREE.Vector3(), B = new THREE.Vector3();
  for (let i = 0; i < N; i++) { const p = pts[i]; T.subVectors(pts[Math.min(N - 1, i + 1)], pts[Math.max(0, i - 1)]).normalize(); Nn.copy(out(p)); Nn.addScaledVector(T, -Nn.dot(T)).normalize(); B.crossVectors(T, Nn).normalize();
    const u = i / (N - 1); const k = (u > 1 - taper ? Math.max(0.12, (1 - u) / taper) : 1) * (u < 0.06 ? 0.75 + u * 4 : 1);
    for (let j = 0; j < RS; j++) { const a = (j / RS) * PI * 2 + PI / RS; P.push(p.x + B.x * Math.cos(a) * w * k + Nn.x * Math.sin(a) * th * k, p.y + B.y * Math.cos(a) * w * k + Nn.y * Math.sin(a) * th * k, p.z + B.z * Math.cos(a) * w * k + Nn.z * Math.sin(a) * th * k);
      const h = hairUV(j / RS, u); U.push(h[0], h[1]); } }
  for (let i = 0; i < N - 1; i++) for (let j = 0; j < RS; j++) { const a = i * RS + j, b = i * RS + ((j + 1) % RS), c = a + RS, d = b + RS; I.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); return g;
}
export interface GothHairBuild { hair: THREE.BufferGeometry; accent: THREE.BufferGeometry | null; under: THREE.BufferGeometry; tris: number }
const cache = new Map<string, GothHairBuild>();
export const isGothHair = (s: HairStyle) => s === 'goth_long' || s === 'goth_bob' || s === 'goth_pony';
export function buildGothHair(style: HairStyle, t: Prepared, accentColor?: string, bandColor?: string): GothHairBuild {
  const key = [style, t.parts.vertexCount, accentColor, bandColor].join('|'); const hit = cache.get(key); if (hit) return hit;
  const { C, Rh } = probe(t); const f = t.parts.features; const brow = f.browP[1];
  const out = (p: THREE.Vector3) => new THREE.Vector3(p.x - C.x, 0, p.z - C.z).normalize().add(new THREE.Vector3(0, 0.15, 0)).normalize();
  const hairG: THREE.BufferGeometry[] = []; const accG: THREE.BufferGeometry[] = []; const streakAt = (b: boolean) => b && !!accentColor;
  const add = (g: THREE.BufferGeometry, accent = false) => { if (accent) accG.push(col(g, accentColor!)); else hairG.push(g); };
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const surf = (az: number, y: number, off: number) => { const r = Math.max(Rh(az, y), 0.05) + off; return new THREE.Vector3(C.x + Math.sin(az) * r, y, C.z + Math.cos(az) * r); };
  const dome = (p: THREE.Vector3, yy: number) => { if (yy > 0.86) { const k = Math.sqrt(Math.max(0.02, 1 - ((yy - 0.86) / 0.075) ** 2)); p.x = C.x + (p.x - C.x) * k; p.z = C.z + (p.z - C.z) * k; p.y = yy; } return p; };
  // scalp shell (fills the gaps between clumps): 24 x 10 grid
  { const NA = 24, NY = 10; const P: number[] = [], U: number[] = [], I: number[] = []; const bot = style === 'goth_pony' ? 0.56 : 0.62;
    for (let j = 0; j <= NY; j++) for (let i = 0; i <= NA; i++) { const az = -PI + (2 * PI * i) / NA; const tt = j / NY; const fr = Math.cos(az) < -0.5; const yb = fr ? brow + 0.04 : style === 'goth_pony' ? 0.56 + 0.06 * Math.abs(Math.sin(az)) : bot;
      const y = 0.93 + (yb - 0.93) * tt; const r = (Math.max(Rh(az, Math.min(y, 0.875)), 0.05) + 0.008) * (y > 0.86 ? Math.sqrt(Math.max(0, 1 - ((y - 0.86) / 0.07) ** 2)) : 1);
      P.push(C.x + Math.sin(az) * r, y, C.z + Math.cos(az) * r); const h = hairUV(i / NA, tt); U.push(h[0], h[1]); }
    for (let j = 0; j < NY; j++) for (let i = 0; i < NA; i++) { const a = j * (NA + 1) + i, b = a + NA + 1; I.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I); g.computeVertexNormals(); hairG.push(g); }
  const under = hairG[0];
  const strand = (az0: number, yEnd: number, o: { n?: number; off?: number; flare?: number; curlIn?: boolean; w?: number; t?: number; taper?: number; sway?: number } = {}) => {
    const pts: THREE.Vector3[] = []; const n = o.n ?? 9; const sway = (rnd() - 0.5) * (o.sway ?? 0.03);
    for (let i = 0; i < n; i++) { const tt = i / (n - 1); const yy = 0.928 + (yEnd - 0.928) * tt; const az = az0 + sway * tt * tt;
      const p = dome(surf(az, Math.min(yy, 0.87), (o.off ?? 0.014) + 0.004 * Math.sin(tt * PI) + (o.flare ?? 0) * tt * tt), yy); p.y = yy;
      if (o.curlIn) { const k = ss(0.78, 1, tt); p.addScaledVector(out(p), -k * 0.03); p.y += k * 0.018; } pts.push(p); }
    return clump(pts, o.w ?? 0.017, o.t ?? 0.007, out, o.taper ?? 0.15); };
  if (style === 'goth_long' || style === 'goth_bob') { const long = style === 'goth_long'; const bot = long ? 0.29 : f.mouth[1] - 0.025; const N = long ? 22 : 20;
    for (let k = 0; k < N; k++) { const az = -(PI - 0.9) + 2 * (PI - 0.9) * (k / (N - 1)); const yE = bot - 0.012 * Math.cos(az) + (rnd() - 0.5) * 0.008;
      add(strand(az, yE, { n: long ? 10 : 8, w: 0.029, t: 0.008, taper: long ? 0.1 : 0.05, curlIn: !long, flare: long ? 0.012 : 0.006 }), streakAt(k >= 1 && k <= 2)); }
    const N2 = long ? 12 : 11; for (let k = 0; k < N2; k++) { const az = -(PI - 1.05) + 2 * (PI - 1.05) * ((k + 0.5) / N2); add(strand(az, bot + 0.02 - 0.01 * Math.cos(az), { n: long ? 10 : 8, off: 0.022, w: 0.03, t: 0.006, taper: 0.08, curlIn: !long, flare: 0.008 })); }
    // blunt fringe
    for (let k = 0; k < 10; k++) { const az = PI - 1.12 + 2.24 * (k / 9); const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 8; i++) { const tt = i / 7; const yy = 0.92 + (brow + 0.004 - 0.92) * tt; pts.push(dome(surf(az, Math.min(yy, 0.87), 0.013 + 0.007 * Math.sin(tt * PI * 0.8)), yy)); }
      add(clump(pts, 0.024, 0.006, out, 0.03), streakAt(k === 2)); }
  } else if (style === 'goth_pony') { const zb = C.z + Rh(0, 0.84); const band = new THREE.Vector3(0, 0.875, zb);
    for (let k = 0; k < 20; k++) { const az = -PI + (2 * PI * k) / 20; const pts: THREE.Vector3[] = [];
      for (let i = 0; i < 8; i++) { const tt = i / 7; const start = surf(az, Math.cos(az) < -0.3 ? brow + 0.045 : 0.56 + 0.06 * Math.abs(Math.sin(az)), 0.011); const top = surf(az * 0.2, 0.89, 0.012);
        const p = start.clone().lerp(top, ss(0, 0.6, tt)).lerp(band, ss(0.55, 1, tt)); const rr = Math.max(Rh(Math.atan2(p.x - C.x, p.z - C.z), p.y), 0.05) + 0.011; const o = new THREE.Vector3(p.x - C.x, 0, p.z - C.z);
        if (o.length() < rr && tt < 0.85) { o.setLength(rr); p.x = C.x + o.x; p.z = C.z + o.z; } pts.push(p); }
      add(clump(pts, 0.023, 0.006, out, 0.02), streakAt(k >= 9 && k <= 10)); }
    for (let k = 0; k < 16; k++) { const a0 = (k / 16) * PI * 2; const pts: THREE.Vector3[] = []; const L = 0.5 + rnd() * 0.08;
      for (let i = 0; i < 13; i++) { const tt = i / 12; const y = 0.88 + 0.06 * Math.sin(tt * PI * 0.9) - L * ss(0.1, 1, tt); const spread = 0.014 + 0.05 * ss(0.1, 0.5, tt) - 0.012 * ss(0.7, 1, tt);
        const ph = tt * 3.0 * PI * 2 + a0; const cr = 0.02 * ss(0.25, 0.5, tt);
        pts.push(new THREE.Vector3(Math.cos(a0) * spread + Math.cos(ph) * cr, y, zb + 0.03 + 0.09 * Math.sin(Math.min(1, tt * 1.6) * PI * 0.5) - 0.03 * tt + Math.sin(a0) * spread * 0.7 + Math.sin(ph) * cr)); }
      add(clump(pts, 0.019, 0.009, (p) => new THREE.Vector3(p.x, 0, p.z - zb - 0.08).normalize(), 0.2), streakAt(k < 2)); }
    accG.push(col(new THREE.TorusGeometry(0.026, 0.011, 6, 14).rotateX(-1.1).translate(0, 0.878, zb + 0.008), bandColor ?? '#100d14'));
    for (const sd of [-1, 1]) { const pts: THREE.Vector3[] = []; for (let i = 0; i < 10; i++) { const tt = i / 9; const az = sd * (PI - 1.25); const p = surf(az, 0.72 - 0.2 * tt, 0.016 + 0.02 * tt); const ph = tt * 2.5 * PI * 2;
      p.x += sd * Math.cos(ph) * 0.008 * tt; p.z += Math.sin(ph) * 0.008 * tt; pts.push(p); } add(clump(pts, 0.011, 0.005, out, 0.3)); }
  }
  const hair = mergeGeometries(hairG)!; // indexed merge keeps the smooth per-clump normals
  const accent = accG.length ? mergeGeometries(accG)! : null;
  const tris = hair.getIndex()!.count / 3 + (accent ? accent.getAttribute('position').count / 3 : 0);
  const res = { hair, accent, under, tris }; cache.set(key, res); return res;
}
