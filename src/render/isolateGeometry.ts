import * as THREE from 'three';
/**
 * Keeps a short-lived secondary renderer (the studio preview canvas) from ever holding GPU state keyed by
 * geometries that outlive it.
 *
 * Why: the avatar body / hair geometries are module-cached and shared with the game (prepareSource, hairCache).
 * When a second WebGLRenderer draws them, three stores its WebGLBuffers in a WeakMap keyed by the *shared* attributes
 * and adds a 'dispose' listener on the *shared* geometry. Both outlive the studio, so they kept the dead renderer, its
 * (lost) WebGL context, its <canvas> and, through the canvas, the whole studio DOM tree alive: +1 context and ~325
 * DOM nodes per studio visit.
 *
 * How: before each render of the isolated scene, every drawable's geometry is swapped for a renderer-local proxy that
 * shares the same CPU arrays (no copy). Attribute updates on the original are forwarded (version sync). Proxies whose
 * original left the scene are disposed; dispose() frees them all. The shared originals are never disposed and never
 * seen by the secondary renderer.
 *
 * Same problem with module-level shader uniforms: drei's <ContactShadows> builds its blur materials from three-stdlib's
 * HorizontalBlurShader / VerticalBlurShader *without cloning their uniforms*, then writes its render-target textures
 * into them, so the shared module object kept the last studio renderer (and its DOM) alive. On dispose, texture
 * references left in the uniforms of the ShaderMaterials this renderer drew are cleared (they are re-set before each
 * blur anyway).
 */
type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Pair = { src: THREE.BufferAttribute | THREE.InterleavedBuffer; dst: THREE.BufferAttribute | THREE.InterleavedBuffer; v: number };
type Entry = { proxy: THREE.BufferGeometry; pairs: Pair[]; seen: number };

export class SharedGeometryIsolation {
  private entries = new Map<THREE.BufferGeometry, Entry>();
  private proxies = new WeakSet<THREE.BufferGeometry>();
  private tick = 0;
  private shaderMats = new Set<THREE.ShaderMaterial>();

  /** Number of live proxies (tests / debug). */
  get size() { return this.entries.size; }
  isProxy(g: THREE.BufferGeometry) { return this.proxies.has(g); }

  /** Swap geometries in `root` for local proxies and forward attribute updates. With `prune` (the main scene),
   *  proxies whose original is no longer in `root` are disposed. */
  sync(root: THREE.Object3D, prune = true) {
    const t = ++this.tick;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      for (const mat of ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[] | undefined) ?? [])) if ((mat as THREE.ShaderMaterial).isShaderMaterial) this.shaderMats.add(mat as THREE.ShaderMaterial);
      const g = m.geometry as THREE.BufferGeometry | undefined;
      if (!g || !(g as THREE.BufferGeometry).isBufferGeometry) return;
      if (this.proxies.has(g)) { const src = (g.userData as { __ywSrc?: THREE.BufferGeometry }).__ywSrc; const e = src && this.entries.get(src); if (e) e.seen = t; return; }
      let e = this.entries.get(g);
      if (!e) { e = this.makeProxy(g); this.entries.set(g, e); this.proxies.add(e.proxy); }
      e.seen = t; m.geometry = e.proxy;
    });
    for (const [src, e] of this.entries) {
      if (e.seen !== t) { if (prune) { this.entries.delete(src); e.proxy.dispose(); } continue; }
      for (const p of e.pairs) if (p.src.version !== p.v) {
        if (p.dst.array !== p.src.array) (p.dst as { array: unknown }).array = p.src.array;
        p.dst.needsUpdate = true; p.v = p.src.version;
      }
    }
  }

  /** Dispose every proxy (frees the secondary renderer's buffers). Originals are untouched. */
  dispose() {
    for (const e of this.entries.values()) e.proxy.dispose(); this.entries.clear();
    for (const m of this.shaderMats) for (const k in m.uniforms) { const u = m.uniforms[k]; if (u && (u.value as THREE.Texture | null)?.isTexture) u.value = null; }
    this.shaderMats.clear();
  }

  private makeProxy(g: THREE.BufferGeometry): Entry {
    const pairs: Pair[] = []; const ib = new Map<THREE.InterleavedBuffer, THREE.InterleavedBuffer>();
    const wrap = (a: Attr): Attr => {
      if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
        const ia = a as THREE.InterleavedBufferAttribute; let d = ib.get(ia.data);
        if (!d) { d = new THREE.InterleavedBuffer(ia.data.array, ia.data.stride); d.setUsage(ia.data.usage); ib.set(ia.data, d); pairs.push({ src: ia.data, dst: d, v: ia.data.version }); }
        return new THREE.InterleavedBufferAttribute(d, ia.itemSize, ia.offset, ia.normalized);
      }
      const ba = a as THREE.BufferAttribute; const c = new THREE.BufferAttribute(ba.array, ba.itemSize, ba.normalized);
      c.setUsage(ba.usage); c.gpuType = ba.gpuType; c.name = ba.name; pairs.push({ src: ba, dst: c, v: ba.version }); return c;
    };
    const p = new THREE.BufferGeometry(); p.name = g.name;
    for (const k of Object.keys(g.attributes)) p.setAttribute(k, wrap(g.attributes[k] as Attr));
    if (g.index) p.setIndex(wrap(g.index) as THREE.BufferAttribute);
    for (const k of Object.keys(g.morphAttributes)) p.morphAttributes[k] = g.morphAttributes[k].map((a) => wrap(a as Attr) as THREE.BufferAttribute);
    p.morphTargetsRelative = g.morphTargetsRelative;
    for (const gr of g.groups) p.addGroup(gr.start, gr.count, gr.materialIndex);
    p.setDrawRange(g.drawRange.start, g.drawRange.count);
    if (g.boundingBox) p.boundingBox = g.boundingBox.clone();
    if (g.boundingSphere) p.boundingSphere = g.boundingSphere.clone();
    p.userData = { ...g.userData, __ywSrc: g };
    return { proxy: p, pairs, seen: 0 };
  }
}

type Renderable = { render: (scene: THREE.Object3D, camera: THREE.Camera) => unknown };
/** Install on a secondary renderer: syncs `scene` before each render of it. Returns the cleanup (restore + dispose). */
export function isolateRendererGeometry(gl: Renderable, scene: THREE.Object3D) {
  const iso = new SharedGeometryIsolation(); const orig = gl.render;
  gl.render = function (this: unknown, s: THREE.Object3D, c: THREE.Camera) { iso.sync(s, s === scene); return orig.call(this, s, c); };
  return () => { if (gl.render !== orig) gl.render = orig; iso.dispose(); };
}
