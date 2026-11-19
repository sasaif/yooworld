/** Face v2 (Phase A, approved 2026-11-19): a NEW selectable smiling mouth and "sparkle" eyes (iris ×1.18 + catchlights).
 *  Painted once per look change into the avatar's existing per-instance atlas canvas (CustomAvatar `ctx`), right after
 *  the base lips/decals. Cost: 0 extra texture, 0 draw call, 0 triangle, 0 material; a few Canvas 2D ops (< 1 ms) only
 *  when the look changes. Values come from the v2 prototype (art/proposals/v2/scripts/v2.mjs, `__paintFace`).
 *  The old face (mouth_base / eyes_round …) is untouched: these are opt-in items with new ids (see items.ts). */
import type { V2 } from '../../render/avatar/custom/parts';

/** Prototype values, in atlas px @1024 (scaled by size/1024). */
export const SMILE = {
  /** skin patch that hides the small pursed mouth painted in the base atlas */ patch: { rx: 18, ry: 12, inner: 2, outer: 17 },
  /** sampled skin above the mouth (atlas px up) */ sampleUp: 22,
  /** open "D" smile */ halfW: 15, cornerY: -4, topY: -1, bottomCtrlY: 13,
  tongue: { dy: 4.2, rx: 7, ry: 2.6 }, corner: { dx: 2.5, dy: -3, width: 1.8 },
  mouthColor: 'rgba(120,38,62,0.96)', tongueColor: 'rgba(236,110,130,0.95)', lineColor: 'rgba(120,38,62,0.9)',
} as const;
export const IRIS_V2 = { x: 555, y: 150, r: 24, scale: 1.18 } as const;
export const CATCHLIGHTS = [
  { kind: 'ellipse', dx: -9, dy: -10, rx: 7, ry: 6, rot: -0.5, color: 'rgba(255,255,255,0.97)' },
  { kind: 'circle', dx: 9, dy: 9, r: 3.2, color: 'rgba(255,255,255,0.97)' },
  { kind: 'circle', dx: 3, dy: -14, r: 3, color: 'rgba(255,255,255,0.35)' },
] as const;

/** Minimal Canvas 2D surface used here (lets the painters run against a recording mock in unit tests). */
export type Ctx2D = Pick<CanvasRenderingContext2D, 'save' | 'restore' | 'beginPath' | 'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'ellipse' | 'arc' | 'fill' | 'stroke'
  | 'createRadialGradient' | 'getImageData' | 'putImageData'> & { fillStyle: string | CanvasGradient | CanvasPattern; strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number; lineCap: CanvasLineCap; globalAlpha: number; globalCompositeOperation: GlobalCompositeOperation };

const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const; };

/** Smiling mouth at the face's mouth UV. `lipColor` (lipstick item) tints the mouth if any. */
export function paintSmile(x: Ctx2D, mouthUV: V2, size: number, skinHex: string, lipColor?: string) {
  const k = size / 1024; const mx = mouthUV[0] * size, my = mouthUV[1] * size; const S = SMILE;
  // skin tone right above the mouth on the already-composited atlas (keeps the painted shading); fallback: the skin item
  let sk: readonly number[] = rgb(skinHex);
  try { const d = x.getImageData(Math.round(mx), Math.round(my - S.sampleUp * k), 1, 1).data; if (d[3] > 0) sk = [d[0], d[1], d[2]]; } catch { /* tainted / unsupported: keep the item colour */ }
  x.save(); x.globalAlpha = 1; x.globalCompositeOperation = 'source-over';
  const g = x.createRadialGradient(mx, my, S.patch.inner * k, mx, my, S.patch.outer * k);
  g.addColorStop(0, `rgba(${sk[0]},${sk[1]},${sk[2]},1)`); g.addColorStop(0.75, `rgba(${sk[0]},${sk[1]},${sk[2]},0.95)`); g.addColorStop(1, `rgba(${sk[0]},${sk[1]},${sk[2]},0)`);
  x.fillStyle = g; x.beginPath(); x.ellipse(mx, my, S.patch.rx * k, S.patch.ry * k, 0, 0, Math.PI * 2); x.fill();
  const mouth = lipColor ? mixRgba(lipColor, S.mouthColor, 0.45) : S.mouthColor;
  x.fillStyle = mouth; x.beginPath(); x.moveTo(mx - S.halfW * k, my + S.cornerY * k); x.quadraticCurveTo(mx, my + S.topY * k, mx + S.halfW * k, my + S.cornerY * k);
  x.quadraticCurveTo(mx, my + S.bottomCtrlY * k, mx - S.halfW * k, my + S.cornerY * k); x.fill();
  x.fillStyle = S.tongueColor; x.beginPath(); x.ellipse(mx, my + S.tongue.dy * k, S.tongue.rx * k, S.tongue.ry * k, 0, 0, Math.PI * 2); x.fill();
  x.strokeStyle = lipColor ? mouth : S.lineColor; x.lineWidth = S.corner.width * k; x.lineCap = 'round';
  for (const s of [-1, 1]) { x.beginPath(); x.moveTo(mx + s * S.halfW * k, my + S.cornerY * k); x.lineTo(mx + s * (S.halfW + S.corner.dx) * k, my + (S.cornerY + S.corner.dy) * k); x.stroke(); }
  x.restore();
}
function mixRgba(hex: string, rgba: string, t: number) {
  const a = rgb(hex); const m = /rgba\((\d+),(\d+),(\d+),([\d.]+)\)/.exec(rgba)!; const b = [+m[1], +m[2], +m[3]];
  return `rgba(${Math.round(a[0] * (1 - t) + b[0] * t)},${Math.round(a[1] * (1 - t) + b[1] * t)},${Math.round(a[2] * (1 - t) + b[2] * t)},${m[4]})`;
}

/** Pure: scale the iris disc of an RGBA region about (cx, cy) by `scale` (bilinear), writing only inside radius r*scale.
 *  `src` is untouched; returns a new buffer. Pixels outside the scaled disc are copied as is. */
export function scaleIrisPixels(src: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, r: number, scale: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src); const R = r * scale; const R2 = R * R;
  const at = (x: number, y: number, c: number) => { const xi = Math.min(w - 1, Math.max(0, x)), yi = Math.min(h - 1, Math.max(0, y)); return src[(yi * w + xi) * 4 + c]; };
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(h - 1, Math.ceil(cy + R)); y++) {
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(w - 1, Math.ceil(cx + R)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy; if (dx * dx + dy * dy > R2) continue;
      const sx = cx + dx / scale - 0.5, sy = cy + dy / scale - 0.5; const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      const i = (y * w + x) * 4;
      for (let c = 0; c < 4; c++) {
        const v = at(x0, y0, c) * (1 - fx) * (1 - fy) + at(x0 + 1, y0, c) * fx * (1 - fy) + at(x0, y0 + 1, c) * (1 - fx) * fy + at(x0 + 1, y0 + 1, c) * fx * fy;
        out[i + c] = v;
      }
    }
  }
  return out;
}

/** Iris + pupil ×1.18 and bigger catchlights on the shared eyeball island (both eyes use the same UVs). */
export function paintSparkleEyes(x: Ctx2D, size: number) {
  const k = size / 1024; const I = IRIS_V2; const cx = I.x * k, cy = I.y * k, R = I.r * k * I.scale;
  const pad = Math.ceil(R + 3); const x0 = Math.max(0, Math.floor(cx - pad)), y0 = Math.max(0, Math.floor(cy - pad));
  const w = Math.min(size, Math.ceil(cx + pad)) - x0, h = Math.min(size, Math.ceil(cy + pad)) - y0;
  try {
    const img = x.getImageData(x0, y0, w, h); const scaled = scaleIrisPixels(img.data, w, h, cx - x0, cy - y0, I.r * k, I.scale);
    img.data.set(scaled); x.putImageData(img, x0, y0);
  } catch { /* no pixel access: catchlights only */ }
  x.save(); x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  for (const c of CATCHLIGHTS) {
    x.fillStyle = c.color; x.beginPath();
    if (c.kind === 'ellipse') x.ellipse(cx + c.dx * k, cy + c.dy * k, c.rx * k, c.ry * k, c.rot, 0, Math.PI * 2); else x.arc(cx + c.dx * k, cy + c.dy * k, c.r * k, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}
