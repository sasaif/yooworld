import * as THREE from 'three';
import type { HairStyle } from '../../../fashion/types';
import type { Prepared } from '../custom/source';
import { transferHead } from '../custom/builders';
import type { ChainDesc, HairRigDesc, RigOpts, V3 } from './hairRig';
/** Per-hairstyle spring descriptors, built from the same probes as the hair builders (cranium, features, native bun
 *  mesh), so they fit Juanita and Juan alike. Tuned by eye on art/proposals/hair_motion (subtle, not cartoonish).
 *  Short styles (quiff, afro, mohawk, buzz) have no descriptor: they stay static. */
const v3 = (v: THREE.Vector3): V3 => [v.x, v.y, v.z];
export const deg = (d: number) => (d * Math.PI) / 180;
const dirAt = (C: THREE.Vector3, az: number, el: number, r: number) => new THREE.Vector3(C.x + Math.sin(az) * Math.cos(el) * r, C.y + Math.sin(el) * r, C.z - Math.cos(az) * Math.cos(el) * r);

/** Juanita's native twin buns (transferred to the target head like the builder does): one spring per bun. */
export function bunsDesc(t: Prepared, f: Prepared): HairRigDesc | null {
  if (!f.buns) return null; const C = t.cranium; const g = t === f ? f.buns : transferHead(f.buns, f, t); const p = g.getAttribute('position'); const chains: ChainDesc[] = [];
  for (const sd of [1, -1]) {
    const c = new THREE.Vector3(); let n = 0; const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (Math.sign(v.x) === sd) { c.add(v); n++; } }
    if (!n) continue; c.divideScalar(n); let r = 0; for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); if (Math.sign(v.x) === sd) r = Math.max(r, v.distanceTo(c)); }
    const out = c.clone().sub(C).normalize(); const pivot = c.clone().addScaledVector(out, -r * 0.75); const tip = c.clone().addScaledVector(out, r * 0.6);
    chains.push({ name: sd > 0 ? 'bunL' : 'bunR', pivot: v3(pivot), tip: v3(tip), region: { kind: 'sphere', center: v3(c), radius: r * 1.35, inner: 0.8, out: v3(out), ramp: r * 0.5 },
      freq: 3.0, zeta: 0.6, inertia: 0.4, drag: deg(1.8), dragMax: deg(3.5), limit: { side: deg(8), back: deg(8), fwd: deg(5), up: deg(5) } });
  }
  if (g !== f.buns) g.dispose();
  return { id: 'buns', chains };
}
/** Long loose hair: three soft hinges (left / back / right) at ear height, blended by azimuth and height. The top cap stays rigid. */
export function longDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const fe = t.parts.features; const yStart = C.y - 0.035, yEnd = fe.neck[1] - 0.025; const chains: ChainDesc[] = [];
  const parts: [string, number, number, number][] = [['L', Math.PI - 1.35, 0.95, 1], ['B', Math.PI, 0.95, 0], ['R', Math.PI + 1.35, 0.95, -1]];
  for (const [nm, az, half, sd] of parts) {
    const R = t.headRadius(az, C.y) * 0.9; const px = C.x + Math.sin(az) * R, pz = C.z - Math.cos(az) * R;
    const pivot: V3 = [px, yStart, pz]; const tip: V3 = [px + Math.sin(az) * 0.012, yEnd, pz - Math.cos(az) * 0.012];
    chains.push({ name: 'long' + nm, pivot, tip, region: { kind: 'curtain', cranium: v3(C), azC: az, azHalf: half * 1.7, yStart: yStart + 0.01, yEnd, group: 'long' },
      freq: sd ? 2.0 : 1.8, zeta: 0.7, inertia: 0.35, drag: deg(4), dragMax: deg(8), limit: { side: deg(sd ? 9 : 6), back: deg(12), fwd: deg(2.5), up: deg(4) } });
  }
  return { id: 'long', chains };
}
/** a hanging piece (tail, pigtail, braid, bun): one hinge at its root, weights = sphere around the piece × ramp from the root */
function piece(name: string, root: THREE.Vector3, end: THREE.Vector3, radius: number, o: Partial<ChainDesc> & { ramp?: number }): ChainDesc {
  const out = end.clone().sub(root).normalize(); const mid = root.clone().lerp(end, 0.5); const r = Math.max(radius, root.distanceTo(end) * 0.5 + radius * 0.6);
  const { ramp, ...rest } = o;
  return { name, pivot: v3(root), tip: v3(end), region: { kind: 'sphere', center: v3(mid), radius: r * 1.15, inner: 0.85, out: v3(out), ramp: ramp ?? 0.025 },
    freq: 2.4, zeta: 0.65, inertia: 0.4, drag: deg(3), dragMax: deg(6), limit: { side: deg(8), back: deg(10), fwd: deg(4), up: deg(4) }, ...rest };
}
export function ponyDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const fe = t.parts.features; const R = t.headRadius(Math.PI, C.y); const s = dirAt(C, Math.PI, 0.32, R + 0.03);
  const end = new THREE.Vector3(0, fe.mouth[1] - 0.07, s.z + 0.07);
  return { id: 'pony', chains: [piece('pony', s.clone().add(new THREE.Vector3(0, -0.005, 0.01)), end, 0.045, { freq: 2.2, zeta: 0.62, drag: deg(4), dragMax: deg(8), limit: { side: deg(10), back: deg(12), fwd: deg(3), up: deg(4) } })] };
}
export function pigtailsDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const chains: ChainDesc[] = [];
  for (const sd of [1, -1]) { const s = dirAt(C, sd * 1.95, 0.1, t.headRadius(sd * 1.95, C.y) + 0.02); const end = s.clone().add(new THREE.Vector3(sd * 0.06, -0.17, -0.01));
    chains.push(piece(sd > 0 ? 'tailL' : 'tailR', s.clone().add(new THREE.Vector3(sd * 0.012, -0.004, 0)), end, 0.04, { freq: 2.5, limit: { side: deg(8), back: deg(10), fwd: deg(6), up: deg(4) } })); }
  return { id: 'pigtails', chains };
}
export function braidsDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const k = t.headRadius(Math.PI, C.y) / 0.2424; const chains: ChainDesc[] = [];
  for (const sd of [1, -1]) { const a0 = sd * 2.09; const y0 = C.y + 0.036 * k; const s = dirAt(C, a0, 0, t.headRadius(a0, y0) - 0.004 * k); s.y = y0;
    const e = new THREE.Vector3(C.x + sd * 0.17 * k, C.y - 0.27 * k, C.z - 0.06 * k);
    // braids rest over the shoulders / chest: very little forward room, swing mostly back and sideways
    chains.push(piece(sd > 0 ? 'braidL' : 'braidR', s, e, 0.035, { freq: 2.3, zeta: 0.7, ramp: 0.04, limit: { side: deg(6), back: deg(9), fwd: deg(2), up: deg(3) } })); }
  return { id: 'braids', chains };
}
export function manbunDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const R = t.headRadius(Math.PI, C.y); const base = dirAt(C, Math.PI, 0.95, R); const c = dirAt(C, Math.PI, 0.95, R + 0.035); const out = c.clone().sub(C).normalize();
  return { id: 'manbun', chains: [piece('manbun', base, c.clone().addScaledVector(out, 0.05), 0.055, { freq: 3.2, zeta: 0.6, drag: deg(1.5), dragMax: deg(3), ramp: 0.015, limit: { side: deg(6), back: deg(6), fwd: deg(4), up: deg(4) } })] };
}
export function bunHighDesc(t: Prepared): HairRigDesc {
  const C = t.cranium; const fe = t.parts.features; const base = new THREE.Vector3(C.x, fe.headTop[1] + 0.012, C.z); const top = base.clone().add(new THREE.Vector3(0, 0.07, 0));
  return { id: 'bun_high', chains: [{ ...piece('bunTop', base, top, 0.13, { freq: 3.2, zeta: 0.6, drag: deg(1.2), dragMax: deg(2.5), ramp: 0.03, limit: { side: deg(4), back: deg(4), fwd: deg(3), up: deg(3) } }),
    region: { kind: 'sphere', center: v3(base.clone().add(new THREE.Vector3(0, 0.035, 0))), radius: 0.14, inner: 0.85, out: [0, 1, 0], ramp: 0.03 } }] };
}
export function bobDesc(t: Prepared): HairRigDesc {
  const d = longDesc(t); const fe = t.parts.features; const C = t.cranium; const yEnd = fe.mouth[1] - 0.012;
  return { id: 'bob', chains: d.chains.map((c) => ({ ...c, tip: [c.tip[0], yEnd, c.tip[2]] as V3, region: { ...c.region, yStart: C.y - 0.025, yEnd } as ChainDesc['region'], freq: 2.6, inertia: 0.3, drag: deg(2.5), dragMax: deg(5), limit: { ...c.limit, side: deg(5), back: deg(8) } })) };
}

/** Styles that get springs (all others stay static). */
export const MOVING_STYLES: readonly HairStyle[] = ['buns', 'long', 'bob', 'pony', 'pigtails', 'braids', 'bun_high', 'manbun'];
/** Bun-like styles: under a hat their bun is hidden / moved under the brim → static. */
const HAT_STATIC: readonly HairStyle[] = ['buns', 'bun_high', 'manbun'];
/** Headphones: sideways swing capped at 4° (the cups sit at the ears). Hat: 1.3× stiffer, clamps × 0.7. */
export const HEADPHONES_SIDE_MAX = deg(4);
export const HAT_STIFF = 1.3, HAT_CLAMP = 0.7;

export interface HairMotionPlan { desc: HairRigDesc; opts: RigOpts; key: string }
const cache = new Map<string, HairRigDesc | null>();
/** Descriptor + per-instance modifiers for a built hairstyle, or null = static. `hat`: a hat is worn; `phones`: headphones are worn. */
export function hairMotionPlan(style: HairStyle, hat: boolean, phones: boolean, t: Prepared, f: Prepared): HairMotionPlan | null {
  if (!MOVING_STYLES.includes(style)) return null;
  if (hat && HAT_STATIC.includes(style)) return null;
  const ck = `${style}|${t.parts.vertexCount}|${t.parts.features.headTop[1]}`;
  let desc = cache.get(ck);
  if (desc === undefined) {
    desc = style === 'buns' ? bunsDesc(t, f) : style === 'long' ? longDesc(t) : style === 'bob' ? bobDesc(t) : style === 'pony' ? ponyDesc(t)
      : style === 'pigtails' ? pigtailsDesc(t) : style === 'braids' ? braidsDesc(t) : style === 'manbun' ? manbunDesc(t) : bunHighDesc(t);
    cache.set(ck, desc);
  }
  if (!desc) return null;
  const opts: RigOpts = { stiff: hat ? HAT_STIFF : 1, clampK: hat ? HAT_CLAMP : 1, sideMax: phones ? HEADPHONES_SIDE_MAX : undefined };
  return { desc, opts, key: `${desc.id}${hat ? '+hat' : ''}${phones ? '+phones' : ''}` };
}
