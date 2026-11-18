import * as THREE from 'three';
import type { FloorFinish, WallFinish } from '../../data/finishes';
const cache = new Map<string, THREE.Texture>();
const shade = (hex: string, k: number) => { const c = new THREE.Color(hex); c.offsetHSL(0, 0, k); return '#' + c.getHexString(); };
/** Procedural, tileable 512px textures (no image downloads, ~1 MB GPU each). 1 texture repeat = 2.4 m. */
export function floorTexture(f: FloorFinish) {
  const key = 'f:' + f.id; if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d')!;
  if (f.kind === 'planks') {
    const rows = 8, h = 512 / rows;
    for (let r = 0; r < rows; r++) { let x = -((r * 173) % 300);
      while (x < 512) { const w = 220 + ((r * 97 + Math.abs(x)) % 140); const k = (((r * 31 + Math.abs(x) * 7) % 9) - 4) / 60;
        g.fillStyle = shade(r % 2 ? f.a : f.b, k); g.fillRect(x, r * h, w, h); g.strokeStyle = 'rgba(70,40,20,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, r * h + 1, w - 2, h - 2);
        for (let q = 0; q < 5; q++) { g.strokeStyle = 'rgba(110,60,30,.07)'; g.beginPath(); const yy = r * h + 7 + q * (h - 14) / 4; g.moveTo(x, yy); g.bezierCurveTo(x + w / 3, yy + 3, x + 2 * w / 3, yy - 3, x + w, yy); g.stroke(); }
        x += w; } }
  } else if (f.kind === 'tiles') {
    const n = 8, s = 512 / n; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? f.a : f.b; g.fillRect(i * s, j * s, s, s); }
    g.strokeStyle = 'rgba(255,255,255,.55)'; g.lineWidth = 3; for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * s, 0); g.lineTo(i * s, 512); g.moveTo(0, i * s); g.lineTo(512, i * s); g.stroke(); }
  } else {
    g.fillStyle = f.a; g.fillRect(0, 0, 512, 512);
    for (let k = 0; k < 9000; k++) { g.fillStyle = Math.random() < 0.5 ? f.b : shade(f.a, 0.04); g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2); }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  cache.set(key, t); return t;
}
export function wallTexture(w: WallFinish) {
  const key = 'w:' + w.id; if (cache.has(key)) return cache.get(key)!;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  g.fillStyle = w.a; g.fillRect(0, 0, 256, 256);
  if (w.kind === 'stripes') { g.fillStyle = w.b; for (let x = 0; x < 256; x += 64) g.fillRect(x, 0, 28, 256); }
  if (w.kind === 'dots') { g.fillStyle = w.b; for (let y = 0; y < 256; y += 42) for (let x = (y / 42) % 2 ? 21 : 0; x < 256; x += 42) { g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill(); } }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t); return t;
}
