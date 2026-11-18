import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Batches many coloured primitives into ONE geometry (vertex colours + a per-vertex `aSway` weight),
 * so a whole location of procedural props renders in a single draw call (+1 for shadows).
 * `aSway` drives a cheap wind animation in the vertex shader (palm fronds, parasol canopies).
 */
export type SwayFn = (local: THREE.Vector3) => number;
export class MeshBuilder {
  private parts: THREE.BufferGeometry[] = [];
  add(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, m?: THREE.Matrix4, sway: number | SwayFn = 0) {
    const geo = g.index ? g.toNonIndexed() : g.clone(); g.dispose();
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.position.count; const pos = geo.attributes.position as THREE.BufferAttribute;
    const c = new THREE.Color(color); const col = new Float32Array(n * 3); const sw = new Float32Array(n); const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; sw[i] = typeof sway === 'number' ? sway : sway(v.fromBufferAttribute(pos, i)); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('aSway', new THREE.BufferAttribute(sw, 1));
    if (m) geo.applyMatrix4(m);
    this.parts.push(geo); return this;
  }
  get count() { return this.parts.length; }
  build() { const g = mergeGeometries(this.parts, false)!; this.parts.forEach((p) => p.dispose()); this.parts = []; g.computeBoundingSphere(); return g; }
}
/** Matrix helper: translate, then rotate (Y, X, Z order), then scale. */
export function T(x = 0, y = 0, z = 0, ry = 0, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
}
/** Lambert material reading vertex colours, with the shared wind sway (uniform uTime). */
export function swayMaterial(time: { value: number }, opts: THREE.MeshLambertMaterialParameters = {}) {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = uTime * 1.3 + position.x * 0.7 + position.z * 0.45;
        transformed.x += aSway * (sin(ph) * 0.05 + sin(ph * 2.3) * 0.015);
        transformed.z += aSway * cos(ph * 0.8) * 0.035;
        transformed.y += aSway * sin(ph * 1.7) * 0.02;`);
  };
  m.customProgramCacheKey = () => 'sway';
  return m;
}
export const jitter = (hex: string, amt = 0.06, seed = 0) => {
  const c = new THREE.Color(hex); const h = { h: 0, s: 0, l: 0 }; c.getHSL(h);
  const r = Math.sin(seed * 91.7 + 13.1) * 43758.5453; const f = r - Math.floor(r);
  return c.setHSL(h.h, h.s, THREE.MathUtils.clamp(h.l + (f - 0.5) * amt, 0, 1));
};
