import type { FaceMorph } from '../../../fashion/types';
import { PART, type Features } from './parts';
/** Procedural face morph targets (real geometry, pure function, unit-tested).
 *  Built once per avatar body from the bind-pose vertices: face shapes move the lower face/jaw,
 *  eye shapes rescale eyeballs + lids + the socket rim, nose/mouth reshape local skin, brows reshape the brow meshes.
 *  Mesh space: x lateral, y up, front = -z. All deltas are relative (glTF morphTargetsRelative). */
export const FACE_MORPHS: FaceMorph[] = ['faceOval', 'faceHeart', 'faceSquare', 'faceSoft', 'eyeBig', 'eyeAlmond', 'eyeCat', 'eyeSleepy',
  'noseButton', 'noseUp', 'noseStrong', 'noseFine', 'mouthFull', 'mouthWide', 'mouthSmall', 'mouthHeart', 'browThick', 'browThin', 'browArch', 'browStraight'];
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const FACE_PARTS: number[] = [PART.SKIN_HEAD, PART.TEETH, PART.MOUTH_IN, PART.EYE, PART.EYEBALL, PART.BROW, PART.LASH];

export function buildFaceMorphs(pos: ArrayLike<number>, vpart: ArrayLike<number>, f: Features): Record<FaceMorph, Float32Array> {
  const n = vpart.length; const out = {} as Record<FaceMorph, Float32Array>;
  for (const m of FACE_MORPHS) out[m] = new Float32Array(n * 3);
  const eyeY = (f.eyeP[1] + f.eyeN[1]) / 2, chinY = f.chin[1], hz = f.headCenter[2], mouth = f.mouth, nose = f.nose;
  const add = (m: FaceMorph, i: number, dx: number, dy: number, dz: number) => { const a = out[m]; a[i * 3] += dx; a[i * 3 + 1] += dy; a[i * 3 + 2] += dz; };
  // brow centre-line per side (binned) for 'straight'
  const browBins: Record<string, { s: number; n: number }[]> = { '1': [], '-1': [] };
  const browC = { '1': f.browP, '-1': f.browN } as Record<string, number[]>;
  for (let i = 0; i < n; i++) if (vpart[i] === PART.BROW) { const x = pos[i * 3], sd = x > 0 ? '1' : '-1'; const b = Math.min(7, Math.max(0, Math.floor(((x - browC[sd][0]) / 0.07 + 0.5) * 8))); (browBins[sd][b] ??= { s: 0, n: 0 }); browBins[sd][b].s += pos[i * 3 + 1]; browBins[sd][b].n++; }
  for (let i = 0; i < n; i++) {
    const p = vpart[i]; if (!FACE_PARTS.includes(p)) continue;
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const front = ss(hz + 0.06, hz - 0.06, z); // 1 on the face, 0 at the back of the head
    // ---- face shapes (lower face below the eyes) ----
    if (y < eyeY) {
      const t = ss(eyeY, chinY, y); const cheek = Math.exp(-(((y - (eyeY + mouth[1]) / 2) / 0.04) ** 2));
      add('faceOval', i, -x * 0.13 * t, -0.016 * t * t * front * Math.exp(-((x / 0.08) ** 2)), 0);
      add('faceHeart', i, -x * 0.2 * Math.pow(t, 1.4), -0.012 * t * t * front * Math.exp(-((x / 0.06) ** 2)), -0.004 * t * front);
      add('faceSquare', i, x * 0.11 * Math.sin(Math.PI * Math.min(1, t * 1.15)), 0.006 * t * t * front * Math.exp(-((x / 0.07) ** 2)), 0);
      add('faceSoft', i, x * 0.1 * cheek, -0.004 * cheek * front, -0.008 * cheek * front);
    }
    // ---- eyes ----
    for (const [e, sd] of [[f.eyeP, 1], [f.eyeN, -1]] as const) {
      if (Math.sign(x) !== sd && Math.abs(x) > 0.004) continue;
      const dx = x - e[0], dy = y - e[1]; const d = Math.hypot(dx, dy);
      const own = p === PART.EYE || p === PART.EYEBALL || p === PART.LASH; if (!own && (p !== PART.SKIN_HEAD || z > e[2])) continue;
      const w = own ? 1 : 1 - ss(0.035, 0.07, d); if (w <= 0) continue;
      const out_ = sd; // outward direction in x
      const scale = (m: FaceMorph, sx: number, sy: number, tilt: number, sz = 1) => add(m, i, dx * (sx - 1) * w, (dy * (sy - 1) + Math.tan(tilt) * dx * out_) * w, p === PART.EYEBALL ? (z - e[2]) * (sz - 1) : 0);
      scale('eyeBig', 1.16, 1.16, 0, 1.12);
      scale('eyeAlmond', 1.08, 0.8, 0.09);
      scale('eyeCat', 1.12, 0.74, 0.2);
      if (p !== PART.EYEBALL && dy > 0) add('eyeSleepy', i, 0, -dy * 0.32 * w, 0); else if (p !== PART.EYEBALL) add('eyeSleepy', i, 0, -dy * 0.05 * w, 0);
    }
    // ---- nose (skin only) ----
    if (p === PART.SKIN_HEAD && z < hz) {
      const dx = x - nose[0], dy = y - nose[1]; const g = Math.exp(-((dx * dx + dy * dy) / (0.018 ** 2))); const gw = Math.exp(-((dx * dx + dy * dy) / (0.026 ** 2)));
      const bridge = Math.exp(-((dx / 0.012) ** 2)) * ss(nose[1], eyeY, y) * (1 - ss(eyeY, eyeY + 0.03, y));
      add('noseButton', i, dx * 0.25 * g, dy * 0.2 * g, -0.007 * g);
      add('noseUp', i, 0, 0.006 * g * ss(-0.01, 0.01, -dy + 0.004), -0.004 * g);
      add('noseStrong', i, dx * 0.35 * gw, -0.003 * g, -0.012 * gw - 0.004 * bridge);
      add('noseFine', i, -dx * 0.3 * gw, 0.002 * g, -0.004 * g - 0.005 * bridge);
    }
    // ---- mouth (skin + inner mouth + teeth) ----
    if ((p === PART.SKIN_HEAD && z < hz) || p === PART.TEETH || p === PART.MOUTH_IN) {
      const dx = x - mouth[0], dy = y - mouth[1]; const r2 = (dx / 0.05) ** 2 + (dy / 0.028) ** 2; const g = Math.exp(-r2 * 1.6); const lip = Math.exp(-((dx / 0.03) ** 2 + (dy / 0.012) ** 2));
      add('mouthWide', i, dx * 0.3 * g, 0.002 * g * (Math.abs(dx) / 0.03), 0);
      add('mouthSmall', i, -dx * 0.24 * g, 0, -0.002 * lip);
      add('mouthFull', i, dx * 0.04 * lip, dy * 0.35 * lip, -0.006 * lip);
      add('mouthHeart', i, -dx * 0.12 * g, dy > 0 ? 0.003 * Math.exp(-((dx / 0.008) ** 2)) * lip : dy * 0.2 * lip, -0.004 * lip);
    }
    // ---- brows ----
    if (p === PART.BROW) {
      const sd = x > 0 ? '1' : '-1'; const c = browC[sd]; const dx = x - c[0], dy = y - c[1]; const u = Math.max(-1, Math.min(1, dx / 0.035)) * (sd === '1' ? 1 : -1); // u: -1 inner .. +1 outer
      const b = Math.min(7, Math.max(0, Math.floor((dx / 0.07 + 0.5) * 8))); const bin = browBins[sd][b]; const line = bin ? bin.s / bin.n : c[1];
      add('browThick', i, 0, (y - line) * 0.7, -0.001);
      add('browThin', i, dx * 0.05, (y - line) * -0.5, 0);
      add('browArch', i, 0, 0.011 * (1 - u * u) + 0.004 * u - 0.003, 0);
      add('browStraight', i, 0, -(line - c[1]) * 0.85 + (u > 0 ? 0 : 0), 0);
      void dy;
    }
  }
  return out;
}
