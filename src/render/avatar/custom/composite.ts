import { PART } from './parts';
import type { ClothSpec, RenderSpec } from './spec';
/** CPU texture compositor (pure, no DOM): recolours the avatar's own painted atlas per body-part label,
 *  keeping the painted folds/shading (luminance-normalised tint) and adding procedural fabric patterns.
 *  ~1 M texels, single pass; run only when the look changes. Face decals/prints are painted afterwards (decals.ts). */
export type RGB = [number, number, number];
export const hex = (h: string): RGB => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export interface LabelStats { avg: RGB[]; lum: number[]; hairY: [number, number]; irisLum: number }
export const IRIS = { x: 555, y: 150, r: 24, pupil: 9 }; // atlas px @1024 (eyeball island)
const lumOf = (r: number, g: number, b: number) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;

export function computeStats(base: Uint8ClampedArray | Uint8Array, mask: Uint8Array, size: number): LabelStats {
  const sum = Array.from({ length: 32 }, () => [0, 0, 0, 0]); let y0 = size, y1 = 0, il = 0, ic = 0; const k = size / 1024;
  for (let i = 0; i < mask.length; i++) {
    const l = mask[i]; if (!l) continue; const r = base[i * 4], g = base[i * 4 + 1], b = base[i * 4 + 2];
    const s = sum[l]; s[0] += r; s[1] += g; s[2] += b; s[3]++;
    const y = (i / size) | 0;
    if (l === PART.HAIR) { const x = i % size; if (x > 0.33 * size && x < 0.62 * size) { if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    if (l === PART.EYEBALL) { const x = i % size; const d = Math.hypot(x - IRIS.x * k, y - IRIS.y * k); if (d < IRIS.r * k && d > IRIS.pupil * k) { il += lumOf(r, g, b); ic++; } }
  }
  const avg = sum.map((s) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : [128, 128, 128]) as RGB);
  return { avg, lum: avg.map((a) => Math.max(0.05, lumOf(...a))), hairY: [y0, Math.max(y0 + 1, y1)], irisLum: ic ? il / ic : 0.4 };
}
// ---- procedural patterns (atlas pixel space) ----
const hash = (x: number, y: number) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function vnoise(x: number, y: number) { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi; const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }
/** returns [mix toward color2 (0..1), extra brightness multiplier, white sparkle 0..1] */
export function patternAt(p: ClothSpec['pattern'], x: number, y: number, k: number): [number, number, number] {
  x /= k; y /= k;
  switch (p) {
    case 'stripes': return [((y / 7) | 0) % 2 ? 1 : 0, 1, 0];
    case 'dots': { const gx = x % 14 - 7, gy = y % 14 - 7; return [gx * gx + gy * gy < 12 ? 1 : 0, 1, 0]; }
    case 'check': { const a = ((x / 16) | 0) % 2, b = ((y / 16) | 0) % 2; const line = (x % 16 < 2 || y % 16 < 2) ? 0.25 : 0; return [a ^ b ? 0.85 : 0.15 + line, 1, line * 0.5]; }
    case 'tiedye': { const t = Math.sin(x * 0.045 + Math.sin(y * 0.03) * 2.2) * 0.5 + Math.sin(y * 0.05 + x * 0.01) * 0.5; return [smooth(-0.35, 0.35, t), 1, smooth(0.75, 1, Math.abs(t)) * 0.6]; }
    case 'galaxy': { const n = vnoise(x / 22, y / 22) * 0.7 + vnoise(x / 7, y / 7) * 0.3; const st = hash(x | 0, y | 0) > 0.993 ? 1 : 0; return [smooth(0.45, 0.8, n), 1, st]; }
    case 'denim': { const tw = ((x + y) | 0) % 4 === 0 ? 1.08 : 1; return [0, tw * (0.94 + vnoise(x / 3, y / 40) * 0.12), 0]; }
    case 'camo': { const n = vnoise(x / 18, y / 18) * 0.65 + vnoise(x / 6, y / 6) * 0.35; return [n > 0.52 ? 1 : 0, n < 0.3 ? 0.82 : 1, 0]; }
    case 'sequin': { const gx = x % 6 - 3, gy = (y + ((x / 6 | 0) % 2) * 3) % 6 - 3; const on = gx * gx + gy * gy < 6; const h = hash((x / 6) | 0, (y / 6) | 0); return [on ? h * 0.6 : 0, on ? 1.1 + h * 0.25 : 0.85, on && h > 0.85 ? 0.8 : 0]; }
    case 'leather': return [0, 0.92 + vnoise(x / 9, y / 9) * 0.16, 0];
    default: return [0, 1, 0];
  }
}
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

export function compositePixels(base: Uint8ClampedArray | Uint8Array, mask: Uint8Array, size: number, spec: RenderSpec, st: LabelStats, out = new Uint8ClampedArray(base.length)): Uint8ClampedArray {
  out.set(base); const k = size / 1024;
  const skin = hex(spec.skin); const sb = st.avg[PART.SKIN_HEAD]; const skinMul: RGB = [skin[0] / sb[0], skin[1] / sb[1], skin[2] / sb[2]];
  const hair = hex(spec.hairColor), hair2 = spec.hairColor2 ? hex(spec.hairColor2) : null; const eye = hex(spec.eyeColor);
  const top = { c: hex(spec.top.color), c2: hex(spec.top.color2 ?? spec.top.color), p: spec.top.pattern };
  const jk = spec.jacket ? { c: hex(spec.jacket.color), c2: hex(spec.jacket.color2 ?? spec.jacket.color), t: hex(spec.jacket.trim), p: spec.jacket.pattern } : null;
  const pants = { c: hex(spec.pants.color), c2: hex(spec.pants.color2 ?? spec.pants.color), p: spec.pants.pattern };
  const shoeA = hex(spec.shoes.color), shoeB = hex(spec.shoes.color2); const glow = spec.shoes.glow ?? 0;
  const keepCheese = spec.top.print === 'cheese';
  const cloth = (i: number, c: RGB, c2: RGB, p: ClothSpec['pattern'], L: number, avgL: number, x: number, y: number, contrast = 0.85) => {
    const sh = Math.pow(Math.min(1.6, Math.max(0.4, L / avgL)), contrast); const [m, br, sp] = patternAt(p, x, y, k); const f = sh * br;
    out[i] = clamp8((c[0] + (c2[0] - c[0]) * m) * f + 255 * sp); out[i + 1] = clamp8((c[1] + (c2[1] - c[1]) * m) * f + 255 * sp); out[i + 2] = clamp8((c[2] + (c2[2] - c[2]) * m) * f + 255 * sp);
  };
  const skinFlat = (i: number, L: number, avgL: number) => { const sh = Math.pow(Math.min(1.4, Math.max(0.6, L / avgL)), 0.35); out[i] = clamp8(skin[0] * sh); out[i + 1] = clamp8(skin[1] * sh); out[i + 2] = clamp8(skin[2] * sh); };
  // glam dress: arms / chest / legs become skin (or gloves / tights); the garment itself is a separate mesh
  const dress = spec.dress; const gloves = dress?.gloves ? hex(dress.gloves) : null; const legs = dress?.legs ? hex(dress.legs) : null;
  const tint = (i: number, c: RGB, L: number, avgL: number, lo: number, hi: number) => { const f = Math.min(hi, Math.max(lo, L / avgL)); out[i] = clamp8(c[0] * f); out[i + 1] = clamp8(c[1] * f); out[i + 2] = clamp8(c[2] * f); };
  const dressPaint = (l: number, i: number, r: number, g: number, b: number, L: number, aL: number) => {
    switch (l) {
      case PART.SKIN_HAND: if (!gloves) return false; tint(i, gloves, L, aL, 0.7, 1.3); return true;
      case PART.TOP_FORE: case PART.TOP_CUFF: if (gloves) tint(i, gloves, L, aL, 0.7, 1.3); else skinFlat(i, L, aL); return true;
      case PART.TOP_UPPER: case PART.TOP_TORSO: case PART.TOP_COLLAR: case PART.TEE: skinFlat(i, L, aL); return true;
      case PART.LEG: case PART.SHORTS: case PART.TOP_HEM:
        if (legs) tint(i, legs, L, aL, 0.7, 1.4); else if (l === PART.LEG) { out[i] = clamp8(r * skinMul[0]); out[i + 1] = clamp8(g * skinMul[1]); out[i + 2] = clamp8(b * skinMul[2]); } else skinFlat(i, L, aL); return true;
      default: return false;
    }
  };
  const brow = spec.browColor ? hex(spec.browColor) : null;
  for (let p = 0; p < mask.length; p++) {
    const l = mask[p]; if (!l) continue; const i = p * 4; const r = base[i], g = base[i + 1], b = base[i + 2]; const L = lumOf(r, g, b); const aL = st.lum[l];
    const x = p % size, y = (p / size) | 0;
    if (dress && dressPaint(l, i, r, g, b, L, aL)) continue;
    switch (l) {
      case PART.SKIN_HEAD: case PART.SKIN_HAND: out[i] = clamp8(r * skinMul[0]); out[i + 1] = clamp8(g * skinMul[1]); out[i + 2] = clamp8(b * skinMul[2]); break;
      case PART.LEG: if (spec.pants.length === 'short') { out[i] = clamp8(r * skinMul[0]); out[i + 1] = clamp8(g * skinMul[1]); out[i + 2] = clamp8(b * skinMul[2]); } else cloth(i, pants.c, pants.c2, pants.p, L, aL, x, y, 0.5); break;
      case PART.SHORTS: cloth(i, pants.c, pants.c2, pants.p, L, aL, x, y); break;
      case PART.HAIR: case PART.HAIR_BUN: case PART.BROW: {
        let c = l === PART.BROW && brow ? brow : hair; if (hair2 && l !== PART.BROW) { const t = smooth(st.hairY[0], st.hairY[1], y); c = [hair[0] + (hair2[0] - hair[0]) * t, hair[1] + (hair2[1] - hair[1]) * t, hair[2] + (hair2[2] - hair[2]) * t]; }
        const sh = Math.pow(Math.min(1.7, Math.max(0.35, L / aL)), 1.1) * (l === PART.BROW ? 0.78 : 1);
        out[i] = clamp8(c[0] * sh); out[i + 1] = clamp8(c[1] * sh); out[i + 2] = clamp8(c[2] * sh); break;
      }
      case PART.EYEBALL: { const d = Math.hypot(x - IRIS.x * k, y - IRIS.y * k); if (d < IRIS.r * k && d > IRIS.pupil * k * 0.8 && L < 0.8) { const sh = Math.min(1.8, L / st.irisLum) * (1 - smooth(IRIS.r * k * 0.7, IRIS.r * k, d) * 0.35);
        out[i] = clamp8(eye[0] * sh); out[i + 1] = clamp8(eye[1] * sh); out[i + 2] = clamp8(eye[2] * sh); } break; }
      case PART.TEE: {
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx ? (mx - mn) / mx : 0;
        if (keepCheese && (sat > 0.3 || L < 0.55)) break; // the original cheese print stays as painted
        cloth(i, top.c, top.c2, top.p, keepCheese ? L : Math.max(L, aL * 0.9), aL, x, y, 0.7); break;
      }
      case PART.TOP_TORSO: if (jk) cloth(i, jk.c, jk.c, jk.p, L, aL, x, y); else cloth(i, top.c, top.c2, top.p, L, aL, x, y); break;
      case PART.TOP_UPPER: if (jk) cloth(i, jk.c2, jk.c2, jk.p, L, aL, x, y); else if (spec.top.sleeve === 'tank') skinFlat(i, L, aL); else cloth(i, top.c, top.c2, top.p, L, aL, x, y); break;
      case PART.TOP_FORE: if (jk) cloth(i, jk.c2, jk.c2, jk.p, L, aL, x, y); else if (spec.top.sleeve !== 'long') skinFlat(i, L, aL); else cloth(i, top.c, top.c2, top.p, L, aL, x, y); break;
      case PART.TOP_CUFF: if (jk) cloth(i, jk.t, jk.t, 'none', L, aL, x, y); else if (spec.top.sleeve !== 'long') skinFlat(i, L, aL); else cloth(i, top.c, top.c, 'none', L, aL, x, y, 1); break;
      case PART.TOP_COLLAR: case PART.TOP_HEM: if (jk) cloth(i, jk.t, jk.t, 'none', L, aL, x, y); else cloth(i, top.c, top.c, 'none', L * 0.92, aL, x, y, 1); break;
      case PART.SHOE: { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); const sat = mx ? (mx - mn) / mx : 0; const t = smooth(0.12, 0.3, sat);
        const sh = Math.min(1.3, Math.max(0.5, L / aL)); const gl = 1 + glow * 0.25;
        for (let c = 0; c < 3; c++) out[i + c] = clamp8((shoeB[c] * (1 - t) + shoeA[c] * t) * sh * gl); break; }
      case PART.SOLE: { const sh = Math.min(1.2, Math.max(0.6, L / aL)); for (let c = 0; c < 3; c++) out[i + c] = clamp8(shoeB[c] * sh); break; }
      default: break;
    }
  }
  return out;
}
