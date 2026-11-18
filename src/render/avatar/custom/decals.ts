import type { Features } from './parts';
import type { RenderSpec } from './spec';
/** Face decals (makeup, freckles, blush, stickers, lips, stubble) and T-shirt prints, painted with Canvas 2D
 *  in atlas space on top of the recoloured texture. Positions come from the face UV landmarks of build_parts.py. */
const PRINT_AT = { x: 262, y: 207, s: 1 }; // where the original cheese print sits on the tee island (px @1024)
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const mix = (a: string, b: string, t: number) => { const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16); const c = (s: number) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`; };
function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, inner = 0.45, n = 5) {
  x.beginPath(); for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + (i * Math.PI) / n; const rr = i % 2 ? r * inner : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath();
}
function heart(x: CanvasRenderingContext2D, cx: number, cy: number, s: number) {
  x.beginPath(); x.moveTo(cx, cy + s * 0.9); x.bezierCurveTo(cx - s * 1.4, cy - s * 0.1, cx - s * 0.7, cy - s * 1.1, cx, cy - s * 0.4); x.bezierCurveTo(cx + s * 0.7, cy - s * 1.1, cx + s * 1.4, cy - s * 0.1, cx, cy + s * 0.9); x.closePath();
}
export function paintDecals(x: CanvasRenderingContext2D, spec: RenderSpec, f: Features, size: number) {
  const k = size / 1024; const P = (uv: [number, number]) => [uv[0] * size, uv[1] * size] as const;
  const [mx, my] = P(f.mouthUV); const eyes = [{ c: P(f.eyePUV), out: -1 }, { c: P(f.eyeNUV), out: 1 }]; const cheeks = [P(f.cheekPUV), P(f.cheekNUV)];
  x.save();
  // stubble under every beard style (texture layer; beards also get real geometry)
  if (spec.beard !== 'none') {
    seed = 7; x.fillStyle = spec.hairColor; const dense = spec.beard === 'stubble' ? 0.32 : 0.5;
    for (let i = 0; i < 2600; i++) {
      const a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()); const px = mx + Math.cos(a) * rr * 44 * k, py = my + 10 * k + Math.sin(a) * rr * 30 * k;
      const lipD = ((px - mx) / (17 * k)) ** 2 + ((py - my) / (7 * k)) ** 2; if (lipD < 1 || py < my - 9 * k && Math.abs(px - mx) > 22 * k) continue;
      if (spec.beard === 'mustache' && !(py < my - 2 * k && py > my - 11 * k && Math.abs(px - mx) < 22 * k)) continue;
      if (spec.beard === 'goatee' && !(Math.abs(px - mx) < 20 * k && (py > my + 4 * k || (py < my - 2 * k && py > my - 11 * k)))) continue;
      x.globalAlpha = dense * (0.5 + rnd() * 0.5); x.fillRect(px, py, 1.2 * k, 1.2 * k);
    }
  }
  // blush / glow
  for (const d of spec.decals) {
    if (d.kind === 'blush' || d.kind === 'glow') for (const [cx, cy] of cheeks) {
      const gx = d.kind === 'glow' ? cx + (cx < mx ? -4 : 4) * k : cx, gy = d.kind === 'glow' ? cy - 6 * k : cy; const r = (d.kind === 'glow' ? 13 : 17) * k;
      const g = x.createRadialGradient(gx, gy, 0, gx, gy, r); g.addColorStop(0, d.color); g.addColorStop(1, d.color + '00');
      x.globalAlpha = d.kind === 'glow' ? 0.7 : 0.45; x.globalCompositeOperation = d.kind === 'glow' ? 'screen' : 'source-over'; x.fillStyle = g; x.fillRect(gx - r, gy - r, r * 2, r * 2);
    }
  }
  x.globalCompositeOperation = 'source-over';
  for (const d of spec.decals) {
    if (d.kind === 'freckles') { seed = 11; x.fillStyle = d.color; for (let i = 0; i < 34; i++) { const side = i % 2 ? 1 : -1; const px = mx + side * (6 + rnd() * 30) * k, py = my - (14 + rnd() * 18) * k; x.globalAlpha = 0.45 + rnd() * 0.35; x.beginPath(); x.arc(px, py, (0.7 + rnd() * 0.8) * k, 0, 7); x.fill(); } }
    if (d.kind === 'mole') { x.globalAlpha = 0.9; x.fillStyle = d.color; x.beginPath(); x.arc(mx + 17 * k, my - 6 * k, 1.7 * k, 0, 7); x.fill(); }
    if (d.kind === 'star') { const [ex, ey] = eyes[1].c; x.globalAlpha = 1; star(x, ex + 20 * k, ey + 20 * k, 7 * k); x.fillStyle = d.color; x.fill(); x.lineWidth = 1.2 * k; x.strokeStyle = '#fff6c8'; x.stroke();
      x.fillStyle = '#ffffff'; x.beginPath(); x.arc(ex + 9 * k, ey + 25 * k, 1.3 * k, 0, 7); x.arc(ex + 28 * k, ey + 12 * k, 1 * k, 0, 7); x.fill(); }
  }
  // eye makeup
  for (const e of eyes) {
    const [ex, ey] = e.c;
    if (spec.shadow) { const g = x.createRadialGradient(ex, ey - 5 * k, 6 * k, ex, ey - 5 * k, 30 * k); g.addColorStop(0, spec.shadow); g.addColorStop(1, spec.shadow + '00'); x.globalAlpha = 0.75; x.fillStyle = g; x.beginPath(); x.ellipse(ex, ey - 5 * k, 32 * k, 24 * k, 0, 0, 7); x.fill(); }
    if (spec.liner) { x.globalAlpha = 0.95; x.strokeStyle = spec.liner; x.lineWidth = 3 * k; x.lineCap = 'round'; x.beginPath(); x.ellipse(ex, ey + 1 * k, 25 * k, 17 * k, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      x.beginPath(); x.moveTo(ex + e.out * 23 * k, ey - 5 * k); x.lineTo(ex + e.out * 33 * k, ey - 11 * k); x.stroke(); }
  }
  // lips (shape from the mouth option, colour from lipstick or a natural tint)
  const L = spec.lips; const w = 12 * L.w * k, h = 4.2 * L.h * k, bow = L.bow;
  const lipCol = L.color ?? mix(spec.skin, '#b8506a', 0.55);
  x.globalAlpha = L.color ? 0.92 : 0.55; x.fillStyle = lipCol;
  x.beginPath(); x.moveTo(mx - w, my); x.bezierCurveTo(mx - w * 0.6, my - h * 1.1, mx - w * 0.25, my - h * (1.1 + bow * 0.4), mx, my - h * (0.7 - bow * 0.2));
  x.bezierCurveTo(mx + w * 0.25, my - h * (1.1 + bow * 0.4), mx + w * 0.6, my - h * 1.1, mx + w, my); x.bezierCurveTo(mx + w * 0.55, my + h * 1.6, mx - w * 0.55, my + h * 1.6, mx - w, my); x.fill();
  x.globalAlpha = 0.5; x.strokeStyle = mix(spec.skin, '#5a2030', 0.6); x.lineWidth = 1 * k; x.beginPath(); x.moveTo(mx - w * 0.9, my); x.quadraticCurveTo(mx, my + h * 0.25, mx + w * 0.9, my); x.stroke();
  if (L.gloss) { x.globalAlpha = 0.55; const g = x.createLinearGradient(mx - w, my, mx + w, my); g.addColorStop(0, '#9ff3ff'); g.addColorStop(0.5, '#ffffff'); g.addColorStop(1, '#ffb3f0'); x.fillStyle = g; x.beginPath(); x.ellipse(mx, my + h * 0.55, w * 0.45, h * 0.35, 0, 0, 7); x.fill(); }
  // T-shirt print
  const pr = spec.top.print; const cx = PRINT_AT.x * k, cy = PRINT_AT.y * k, s = 15 * k * PRINT_AT.s; x.globalAlpha = 1;
  if (pr === 'star') { star(x, cx, cy, s * 1.3); x.fillStyle = '#ffd23f'; x.fill(); x.lineWidth = 2 * k; x.strokeStyle = '#ffffff'; x.stroke(); }
  if (pr === 'heart') { heart(x, cx, cy, s * 1.1); x.fillStyle = '#ff3f7f'; x.fill(); x.lineWidth = 2 * k; x.strokeStyle = '#ffffff'; x.stroke(); }
  if (pr === 'bolt') { x.beginPath(); [[0.2, -1.3], [-0.7, 0.15], [-0.05, 0.15], [-0.35, 1.3], [0.75, -0.2], [0.1, -0.2]].forEach(([a, b], i) => (i ? x.lineTo : x.moveTo).call(x, cx + a * s, cy + b * s)); x.closePath(); x.fillStyle = '#ffd23f'; x.fill(); }
  if (pr === 'yoo') { x.font = `900 ${Math.round(17 * k)}px system-ui, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineWidth = 4 * k; x.strokeStyle = '#ffffff'; x.strokeText('YOO', cx, cy); x.fillStyle = '#e2569b'; x.fillText('YOO', cx, cy); }
  x.restore();
}
