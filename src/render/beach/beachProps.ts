import * as THREE from 'three';
import { BEACH, BEACH_PROPS, BOARDWALK, CAFE, DANCE_FLOOR, LANTERN_POSTS, shoreX, type BeachProp } from '../../game/beach/beachLayout';
import { MeshBuilder, T, jitter } from './meshBuilder';

/**
 * Procedural geometry for Yoo Plage (no downloaded assets): every prop is built from boxes, cylinders,
 * cones and spheres into one vertex-coloured batch. Palette follows the apartment's warm pastels.
 */
const C = {
  wood: '#d9a273', woodDark: '#9c6a48', woodPale: '#ecc394', plank: '#c98f5f', metal: '#53506a', white: '#fff6ee',
  pink: '#e2569b', pinkSoft: '#f4a7c4', blue: '#4f8be0', teal: '#5cc2c9', yellow: '#ffc857', coral: '#ff8a5c', purple: '#7a5a8c',
  trunk: '#a27148', trunkDark: '#7f5636', leaf: '#3fa86b', leafLight: '#62c483', leafDark: '#2f8a58', rock: '#a89aa8', rockDark: '#857789',
  dune: '#efd2a2', grass: '#7cc27a', sandDark: '#e6c393',
};
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt: number, rb: number, h: number, seg = 10, open = false) => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
const base = (p: BeachProp) => T(p.x, 0, p.z, p.yaw);
const mul = (a: THREE.Matrix4, b: THREE.Matrix4) => a.clone().multiply(b);

function bench(b: MeshBuilder, p: BeachProp) {
  const M = base(p);
  b.add(box(1.3, 0.05, 0.4), C.plank, mul(M, T(0, 0.255, 0.02)));
  for (const y of [0.37, 0.47, 0.57]) b.add(box(1.3, 0.07, 0.03), jitter(C.wood, 0.08, y), mul(M, T(0, y, -0.17, 0, -0.12)));
  for (const x of [-0.58, 0.58]) {
    b.add(box(0.05, 0.25, 0.36), C.metal, mul(M, T(x, 0.125, 0.02)));
    b.add(box(0.05, 0.36, 0.04), C.metal, mul(M, T(x, 0.45, -0.18, 0, -0.12)));
    b.add(box(0.06, 0.04, 0.34), C.metal, mul(M, T(x, 0.38, 0.03)));
  }
}
function lounger(b: MeshBuilder, p: BeachProp) {
  const M = base(p); const fab = p.color ?? C.yellow;
  for (const x of [-0.24, 0.24]) {
    b.add(box(0.04, 0.04, 0.62), C.wood, mul(M, T(x, 0.2, 0.12)));
    b.add(box(0.04, 0.04, 0.55), C.wood, mul(M, T(x, 0.38, -0.32, 0, 0.95)));
    b.add(box(0.04, 0.2, 0.04), C.woodDark, mul(M, T(x, 0.1, 0.4)));
    b.add(box(0.04, 0.2, 0.04), C.woodDark, mul(M, T(x, 0.1, -0.14)));
  }
  // striped fabric: seat + reclined back
  for (let k = 0; k < 5; k++) {
    const col = k % 2 ? C.white : fab;
    b.add(box(0.46, 0.025, 0.125), col, mul(M, T(0, 0.215, -0.13 + k * 0.125)));
    b.add(box(0.46, 0.025, 0.11), col, mul(M, T(0, 0.27 + k * 0.088, -0.16 - k * 0.058, 0, 0.98)));
  }
  b.add(box(0.36, 0.08, 0.14), C.white, mul(M, T(0, 0.62, -0.5, 0, 0.98))); // pillow
}
function towel(b: MeshBuilder, p: BeachProp) {
  const M = base(p); const col = p.color ?? C.pink;
  for (let k = 0; k < 7; k++) b.add(box(0.8, 0.012, 0.23), k % 2 ? C.white : col, mul(M, T(0, 0.006, -0.55 + k * 0.23)));
}
function parasol(b: MeshBuilder, p: BeachProp) {
  const M = T(p.x, 0, p.z, 0, 0.08, -0.06); const col = p.color ?? C.pink;
  b.add(cyl(0.022, 0.026, 1.95, 8), C.white, mul(M, T(0, 0.97, 0)));
  const sway = (v: THREE.Vector3) => Math.min(1, Math.hypot(v.x, v.z) / 0.9) * 0.45;
  for (let k = 0; k < 10; k++) {
    const g = new THREE.ConeGeometry(0.95, 0.32, 3, 1, true, (k / 10) * Math.PI * 2, Math.PI / 5);
    b.add(g, k % 2 ? C.white : col, mul(M, T(0, 1.86, 0)), sway);
  }
  b.add(new THREE.SphereGeometry(0.04, 8, 6), col, mul(M, T(0, 2.04, 0)));
}
function palm(b: MeshBuilder, p: BeachProp, seed: number) {
  const segs = 8, h = 2.1 + (seed % 3) * 0.25, lean = 0.32 + (seed % 2) * 0.12; const dir = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
  let top = new THREE.Vector3(p.x, 0, p.z);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs; const off = (t: number) => dir.clone().multiplyScalar(lean * t * t * h);
    const a = new THREE.Vector3(p.x, t0 * h, p.z).add(off(t0)), c = new THREE.Vector3(p.x, t1 * h, p.z).add(off(t1));
    const len = a.distanceTo(c); const mid = a.clone().add(c).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), c.clone().sub(a).normalize());
    const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    // inner joints: no end caps (they sit inside the overlapping segments or in the sand); the top segment keeps its caps
    b.add(cyl(0.075 - t1 * 0.03, 0.085 - t0 * 0.03, len * 1.04, 9, i < segs - 1), i % 2 ? C.trunk : C.trunkDark, m);
    top = c;
  }
  for (let k = 0; k < 3; k++) b.add(new THREE.SphereGeometry(0.065, 8, 6), '#6b4a2e', T(top.x + Math.cos(k * 2.1) * 0.08, top.y - 0.08, top.z + Math.sin(k * 2.1) * 0.08));
  const fronds = 8;
  for (let k = 0; k < fronds; k++) {
    const L = 1.15 + ((k * 7 + seed) % 3) * 0.12; const g = new THREE.PlaneGeometry(0.42, L, 2, 7); const v = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < v.count; i++) {
      const x = v.getX(i), y = v.getY(i) + L / 2, t = y / L;
      const w = Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.35);
      v.setXYZ(i, x * w, y, Math.abs(x) * 0.35 - t * t * 0.75);
    }
    g.computeVertexNormals();
    const yaw = (k / fronds) * Math.PI * 2 + seed; const pitch = 1.25 + ((k + seed) % 2) * 0.22;
    const m = T(top.x, top.y, top.z, yaw, pitch);
    b.add(g, k % 3 === 0 ? C.leafDark : k % 3 === 1 ? C.leaf : C.leafLight, m, (lv) => 0.25 + Math.max(0, lv.y) / L);
  }
}
function kiosk(b: MeshBuilder) {
  const M = T(CAFE.x, 0, CAFE.z); const W = CAFE.w, D = CAFE.d;
  b.add(box(W, 1.0, D), C.white, mul(M, T(0, 0.5, 0)));
  for (let k = 0; k < 12; k++) b.add(box(W / 12 - 0.01, 0.9, 0.02), k % 2 ? '#bfe3e6' : C.teal, mul(M, T(-W / 2 + (k + 0.5) * (W / 12), 0.47, D / 2 + 0.01))); // painted front panels
  b.add(box(W + 0.1, 0.06, 0.4), C.wood, mul(M, T(0, 1.03, D / 2 - 0.1)));            // counter top
  for (const x of [-W / 2 + 0.06, W / 2 - 0.06]) for (const z of [-D / 2 + 0.06, D / 2 - 0.06]) b.add(box(0.08, 1.15, 0.08), C.woodDark, mul(M, T(x, 1.6, z)));
  b.add(box(W, 1.15, 0.06), '#ffe7d6', mul(M, T(0, 1.6, -D / 2 + 0.04)));             // back wall
  b.add(box(W + 0.5, 0.12, D + 0.6), C.pink, mul(M, T(0, 2.2, 0.15)));                 // roof
  b.add(box(W + 0.6, 0.05, D + 0.7), C.white, mul(M, T(0, 2.28, 0.15)));
  for (let k = 0; k < 14; k++) b.add(box((W + 0.5) / 14, 0.03, 0.62), k % 2 ? C.white : C.pink, mul(M, T(-(W + 0.5) / 2 + (k + 0.5) * ((W + 0.5) / 14), 2.0, D / 2 + 0.5, 0, 0.42))); // striped awning
  for (let k = 0; k < 14; k++) b.add(new THREE.ConeGeometry(0.09, 0.12, 3), k % 2 ? C.white : C.pink, mul(M, T(-(W + 0.5) / 2 + (k + 0.5) * ((W + 0.5) / 14), 1.82, D / 2 + 0.78, 0, Math.PI)));
  // counter goodies: cups, juice bottles, ice creams, a coconut drink
  const cup = [C.coral, C.yellow, C.pinkSoft, C.teal];
  for (let k = 0; k < 4; k++) { b.add(cyl(0.045, 0.035, 0.12), cup[k], mul(M, T(-0.8 + k * 0.17, 1.12, D / 2 - 0.05))); b.add(cyl(0.006, 0.006, 0.1, 4), C.white, mul(M, T(-0.8 + k * 0.17 + 0.015, 1.2, D / 2 - 0.05, 0, 0, 0.2))); }
  for (let k = 0; k < 3; k++) { b.add(new THREE.ConeGeometry(0.04, 0.12, 8), '#e9b872', mul(M, T(0.55 + k * 0.14, 1.12, D / 2 - 0.06, 0, Math.PI))); b.add(new THREE.SphereGeometry(0.048, 10, 8), [C.pinkSoft, '#fff0c9', '#a8e0c0'][k], mul(M, T(0.55 + k * 0.14, 1.2, D / 2 - 0.06))); }
  b.add(new THREE.SphereGeometry(0.08, 10, 8), '#7b5634', mul(M, T(0.2, 1.13, D / 2 - 0.06)));
  // shelves with bottles on the back wall
  b.add(box(W - 0.4, 0.04, 0.18), C.wood, mul(M, T(0, 1.55, -D / 2 + 0.16)));
  for (let k = 0; k < 9; k++) b.add(cyl(0.03, 0.035, 0.16, 8), [C.yellow, C.coral, C.teal, C.pink][k % 4], mul(M, T(-0.85 + k * 0.21, 1.65, -D / 2 + 0.16)));
  // fridge + coffee machine inside
  b.add(box(0.5, 0.9, 0.4), '#cfd6e6', mul(M, T(-0.75, 0.45 + 1.0, -0.2)));
}
function cafeTable(b: MeshBuilder, p: BeachProp, k: number) {
  const M = base(p);
  b.add(cyl(0.3, 0.3, 0.035, 18), C.white, mul(M, T(0, 0.46, 0))); b.add(cyl(0.025, 0.025, 0.45, 8), C.metal, mul(M, T(0, 0.225, 0))); b.add(cyl(0.16, 0.18, 0.025, 12), C.metal, mul(M, T(0, 0.012, 0)));
  b.add(cyl(0.04, 0.032, 0.12), k ? C.coral : C.yellow, mul(M, T(-0.08, 0.54, 0.05))); b.add(cyl(0.04, 0.032, 0.12), k ? C.teal : C.pinkSoft, mul(M, T(0.1, 0.54, -0.06)));
  b.add(new THREE.SphereGeometry(0.05, 8, 6), C.leafLight, mul(M, T(0, 0.5, 0))); // tiny succulent centrepiece
}
function cafeChair(b: MeshBuilder, p: BeachProp) {
  const M = base(p);
  b.add(box(0.4, 0.04, 0.38), C.woodPale, mul(M, T(0, 0.26, 0)));
  b.add(box(0.4, 0.3, 0.04), C.woodPale, mul(M, T(0, 0.45, -0.18, 0, -0.1)));
  for (const x of [-0.17, 0.17]) for (const z of [-0.16, 0.16]) b.add(box(0.035, 0.26, 0.035), C.metal, mul(M, T(x, 0.13, z)));
}
function djBooth(b: MeshBuilder, p: BeachProp) {
  const M = base(p);
  b.add(box(1.4, 0.78, 0.55), '#3d2f57', mul(M, T(0, 0.39, 0)));
  b.add(box(1.42, 0.05, 0.57), C.pink, mul(M, T(0, 0.8, 0)));
  b.add(box(1.36, 0.06, 0.02), C.teal, mul(M, T(0, 0.6, 0.285))); b.add(box(1.36, 0.06, 0.02), C.yellow, mul(M, T(0, 0.3, 0.285)));
  for (const x of [-0.38, 0.38]) { b.add(cyl(0.17, 0.17, 0.03, 18), '#1d1830', mul(M, T(x, 0.84, 0))); b.add(cyl(0.05, 0.05, 0.035, 10), C.pink, mul(M, T(x, 0.85, 0))); }
  b.add(box(0.22, 0.03, 0.2), '#2a2440', mul(M, T(0, 0.84, 0.02)));
  for (const x of [-0.98, 0.98]) {
    b.add(box(0.42, 0.95, 0.42), '#2a2440', mul(M, T(x, 0.475, 0.05)));
    b.add(cyl(0.13, 0.13, 0.02, 16), '#57507a', mul(M, T(x, 0.62, 0.27, 0, Math.PI / 2))); b.add(cyl(0.07, 0.07, 0.02, 12), '#57507a', mul(M, T(x, 0.28, 0.27, 0, Math.PI / 2)));
  }
  // light truss arch
  for (const x of [-1.3, 1.3]) b.add(box(0.08, 2.2, 0.08), '#cfd6e6', mul(M, T(x, 1.1, -0.1)));
  b.add(box(2.68, 0.1, 0.1), '#cfd6e6', mul(M, T(0, 2.2, -0.1)));
  for (let k = 0; k < 5; k++) b.add(cyl(0.05, 0.07, 0.12, 8), '#2a2440', mul(M, T(-1.0 + k * 0.5, 2.1, -0.02, 0, 0.5)));
}
function danceFloorRim(b: MeshBuilder) {
  const s = DANCE_FLOOR.size, x = DANCE_FLOOR.x, z = DANCE_FLOOR.z;
  for (const [dx, dz, w, d] of [[0, -s / 2, s + 0.12, 0.06], [0, s / 2, s + 0.12, 0.06], [-s / 2, 0, 0.06, s], [s / 2, 0, 0.06, s]] as const) b.add(box(w, 0.035, d), C.white, T(x + dx, 0.017, z + dz));
}
function rock(b: MeshBuilder, p: BeachProp, seed: number) {
  for (let k = 0; k < 3; k++) {
    const g = new THREE.DodecahedronGeometry(0.22 - k * 0.05, 0); const a = p.yaw + k * 2.1;
    b.add(g, k % 2 ? C.rockDark : C.rock, T(p.x + Math.cos(a) * k * 0.2, 0.08 - k * 0.02, p.z + Math.sin(a) * k * 0.18, a, seed, 0, 1.2, 0.7, 1));
  }
}
function sign(b: MeshBuilder, p: BeachProp) {
  const M = base(p);
  for (const x of [-0.42, 0.42]) b.add(box(0.06, 1.1, 0.06), C.woodDark, mul(M, T(x, 0.55, 0)));
}
function surfboards(b: MeshBuilder, p: BeachProp) {
  const M = base(p); const cols = [C.coral, C.teal, C.yellow];
  cols.forEach((c, k) => { const g = new THREE.SphereGeometry(0.5, 14, 10); b.add(g, c, mul(M, T(-0.35 + k * 0.32, 0.72, 0.15, 0.1 * k, -0.15, 0.05, 0.28, 1.5, 0.05))); b.add(box(0.03, 1.2, 0.012), C.white, mul(M, T(-0.35 + k * 0.32, 0.72, 0.18, 0.1 * k, -0.15, 0.05))); });
}
function cooler(b: MeshBuilder, p: BeachProp) {
  const M = base(p); b.add(box(0.42, 0.26, 0.3), C.blue, mul(M, T(0, 0.13, 0))); b.add(box(0.44, 0.06, 0.32), C.white, mul(M, T(0, 0.29, 0))); b.add(box(0.24, 0.03, 0.04), C.white, mul(M, T(0, 0.34, 0)));
  // beach ball next to it
  // 6 coloured wedges x 6 segments = 36 around (was 6 x 12 = 72) on a 0.16 m ball (flat-shaded facets 10° instead of 5°)
  for (let k = 0; k < 6; k++) b.add(new THREE.SphereGeometry(0.16, 6, 8, (k / 6) * Math.PI * 2, Math.PI / 3), [C.pink, C.white, C.yellow, C.white, C.blue, C.white][k], mul(M, T(0.55, 0.16, 0.35, 0, 0.4)));
}

/** Boardwalk + pier, dunes behind it, lantern posts, sandcastle and small beach details. */
function environment(b: MeshBuilder) {
  const { z0, z1, pierEnd } = BOARDWALK; const wDeck = z1 - z0;
  for (let x = pierEnd + 0.1, k = 0; x < BEACH.w + 1.5; x += 0.2, k++) b.add(box(0.185, 0.04, wDeck), jitter(k % 3 ? C.plank : C.wood, 0.1, k), T(x, 0.005, (z0 + z1) / 2));
  for (const z of [z0 + 0.03, z1 - 0.03]) b.add(box(BEACH.w + 1.6 - pierEnd, 0.06, 0.07), C.woodDark, T((pierEnd + BEACH.w + 1.6) / 2, -0.01, z));
  // pier piles and railing where the deck is over water
  for (let x = pierEnd + 0.15; x < shoreX(1.3) + 0.4; x += 0.6) for (const z of [z0 + 0.05, z1 - 0.05]) {
    b.add(cyl(0.05, 0.05, 1.0, 8), C.woodDark, T(x, -0.45, z));
    b.add(box(0.06, 0.55, 0.06), C.wood, T(x, 0.3, z));
  }
  const railEnd = shoreX(1.3) + 0.3;
  for (const z of [z0 + 0.05, z1 - 0.05]) b.add(box(railEnd - pierEnd - 0.1, 0.05, 0.05), C.woodPale, T((pierEnd + 0.15 + railEnd) / 2, 0.56, z));
  b.add(box(0.05, 0.05, wDeck - 0.1), C.woodPale, T(pierEnd + 0.15, 0.56, (z0 + z1) / 2));
  b.add(new THREE.TorusGeometry(0.14, 0.04, 6, 16), C.coral, T(pierEnd + 0.12, 0.38, (z0 + z1) / 2, Math.PI / 2)); // lifebuoy
  // dunes + grass behind the boardwalk (frames the top-right of the screen)
  for (let k = 0; k < 16; k++) {
    const x = 1.5 + k * 1.0 + Math.sin(k * 3.1) * 0.3, z = -0.9 - (k % 3) * 0.7; if (Math.abs(x - CAFE.x) < 1.6 && z > -1.8) continue;
    // upper half only: the centre sits 0.25 m under the sand, so the lower half was never visible (same vertices on top)
    b.add(new THREE.SphereGeometry(1, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), jitter(C.dune, 0.05, k), T(x, -0.25, z, k, 0, 0, 0.9 + (k % 2) * 0.4, 0.55 + (k % 3) * 0.15, 0.7));
    for (let g = 0; g < 4; g++) b.add(new THREE.ConeGeometry(0.05, 0.38, 4), jitter(C.grass, 0.1, g + k), T(x + Math.cos(g * 1.7 + k) * 0.5, 0.28 + (k % 3) * 0.04, z + 0.35 + Math.sin(g * 2.3) * 0.2, 0, (g - 1.5) * 0.25, 0, 1, 1, 1), 0.5);
  }
  // low rope fence at the back edge of the boardwalk (gap behind the café)
  for (let x = 2.3; x < BEACH.w; x += 0.9) { if (Math.abs(x - CAFE.x) < 1.4) continue; b.add(cyl(0.03, 0.035, 0.42, 6), C.woodDark, T(x, 0.21, z0 - 0.05)); }
  // lantern posts with lanterns
  for (const [x, z] of LANTERN_POSTS) {
    b.add(cyl(0.035, 0.045, 1.65, 8), C.woodDark, T(x, 0.82, z));
    b.add(box(0.16, 0.03, 0.16), C.metal, T(x, 1.68, z)); b.add(new THREE.ConeGeometry(0.13, 0.1, 4), C.metal, T(x, 1.86, z, Math.PI / 4));
  }
  // sandcastle by the water
  const castle = BEACH_PROPS.find((q) => q.kind === 'castle')!; const sx = castle.x, sz = castle.z;
  b.add(box(0.5, 0.14, 0.4), C.sandDark, T(sx, 0.07, sz));
  for (const [dx, dz] of [[-0.22, -0.17], [0.22, -0.17], [-0.22, 0.17], [0.22, 0.17]]) { b.add(cyl(0.07, 0.08, 0.26, 8), C.sandDark, T(sx + dx, 0.13, sz + dz)); b.add(new THREE.ConeGeometry(0.08, 0.1, 8), '#d9b07c', T(sx + dx, 0.31, sz + dz)); }
  b.add(cyl(0.09, 0.1, 0.34, 8), C.sandDark, T(sx, 0.31, sz)); b.add(box(0.005, 0.12, 0.08), C.pink, T(sx, 0.55, sz + 0.04));
  b.add(cyl(0.004, 0.004, 0.2, 4), C.white, T(sx, 0.57, sz));
  // starfish + shells sprinkled on the sand
  const shells: [number, number, string][] = [[5.1, 4.2, C.coral], [7.2, 8.0, C.pinkSoft], [4.9, 9.3, C.yellow], [9.2, 6.0, C.coral], [11.0, 7.6, C.pinkSoft], [13.2, 9.0, C.yellow]];
  shells.forEach(([x, z, c], k) => { for (let a = 0; a < 5; a++) b.add(new THREE.ConeGeometry(0.03, 0.12, 3), c, T(x, 0.01, z, 0, Math.PI / 2, (a / 5) * Math.PI * 2 + k, 1, 1, 0.3)); });
}

export function buildBeachProps() {
  const b = new MeshBuilder(); let seed = 0;
  environment(b); kiosk(b); danceFloorRim(b);
  for (const p of BEACH_PROPS) {
    seed++;
    if (p.kind === 'bench') bench(b, p); else if (p.kind === 'lounger') lounger(b, p); else if (p.kind === 'towel') towel(b, p);
    else if (p.kind === 'parasol') parasol(b, p); else if (p.kind === 'palm') palm(b, p, seed); else if (p.kind === 'cafeTable') cafeTable(b, p, seed % 2);
    else if (p.kind === 'cafeChair') cafeChair(b, p); else if (p.kind === 'djBooth') djBooth(b, p); else if (p.kind === 'rock') rock(b, p, seed);
    else if (p.kind === 'sign') sign(b, p); else if (p.kind === 'surfboards') surfboards(b, p); else if (p.kind === 'cooler') cooler(b, p);
  }
  return { geometry: b.build(), parts: b.count };
}
/** Sailboat bobbing offshore (its own small batch so it can move). */
export function buildBoat() {
  const b = new MeshBuilder();
  b.add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), C.white, T(0, 0.12, 0, 0, 0, 0, 0.32, 0.22, 0.95));
  b.add(box(0.5, 0.03, 1.5), C.wood, T(0, 0.12, 0)); b.add(box(0.54, 0.05, 1.7), C.coral, T(0, 0.1, 0));
  b.add(cyl(0.025, 0.025, 1.7, 6), C.woodDark, T(0, 0.95, 0.05));
  const sail = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.25, 0.1), new THREE.Vector3(0, 1.75, 0.08), new THREE.Vector3(0, 0.28, 0.72)]); sail.computeVertexNormals();
  b.add(sail, C.white, T(0.01, 0, 0)); 
  const jib = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.25, 0), new THREE.Vector3(0, 1.5, 0.02), new THREE.Vector3(0, 0.22, -0.65)]); jib.computeVertexNormals();
  b.add(jib, C.pinkSoft, T(0.01, 0, 0));
  return b.build();
}
/** Bulbs of the string lights: catenaries between consecutive lantern posts + lantern glows. */
export function lanternBulbs() {
  const bulbs: THREE.Vector3[] = []; const glow: THREE.Vector3[] = []; const wire: THREE.Vector3[] = [];
  const chain = (a: [number, number], c: [number, number], n: number) => {
    let prev: THREE.Vector3 | null = null;
    for (let k = 0; k <= n; k++) { const t = k / n; const p = new THREE.Vector3(a[0] + (c[0] - a[0]) * t, 1.62 - Math.sin(t * Math.PI) * 0.3, a[1] + (c[1] - a[1]) * t); if (k && k < n) bulbs.push(p); if (prev) wire.push(prev, p); prev = p; }
  };
  const front = LANTERN_POSTS.slice(0, 7);
  for (let i = 0; i < front.length - 1; i++) chain(front[i], front[i + 1], Math.round(Math.hypot(front[i + 1][0] - front[i][0], front[i + 1][1] - front[i][1]) / 0.3));
  const [l, r] = LANTERN_POSTS.slice(7); chain(l, r, 9);
  for (const [x, z] of LANTERN_POSTS) glow.push(new THREE.Vector3(x, 1.76, z));
  return { bulbs, glow, wire };
}

/** Module-level caches: the beach is rebuilt identically on every visit, so keep one geometry. */
let _propsGeo: THREE.BufferGeometry | null = null;
let _boatGeo: THREE.BufferGeometry | null = null;
export function getBeachPropsGeometry() { return _propsGeo ??= buildBeachProps().geometry; }
export function getBoatGeometry() { return _boatGeo ??= buildBoat(); }
