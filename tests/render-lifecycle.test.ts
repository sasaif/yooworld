import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { SharedGeometryIsolation, isolateRendererGeometry } from '../src/render/isolateGeometry';
import { disposeMesh } from '../src/render/dispose';

/** Number of 'dispose' listeners a renderer would have registered on a geometry (three's EventDispatcher store). */
const listeners = (g: THREE.BufferGeometry) => ((g as unknown as { _listeners?: Record<string, unknown[]> })._listeners?.dispose?.length ?? 0);

function sharedGeometry() {
  const g = new THREE.BoxGeometry(1, 1, 1); g.computeBoundingSphere();
  return g;
}

describe('studio renderer isolation (P2 leak)', () => {
  it('draws a proxy that shares the CPU arrays, never the shared original', () => {
    const shared = sharedGeometry(); const scene = new THREE.Scene(); const mesh = new THREE.Mesh(shared); scene.add(mesh);
    const iso = new SharedGeometryIsolation(); iso.sync(scene);
    const proxy = mesh.geometry as THREE.BufferGeometry;
    expect(proxy).not.toBe(shared); expect(iso.isProxy(proxy)).toBe(true); expect(iso.size).toBe(1);
    expect(proxy.attributes.position.array).toBe(shared.attributes.position.array);
    expect(proxy.index!.array).toBe(shared.index!.array);
    expect(proxy.groups).toEqual(shared.groups);
    expect(listeners(shared)).toBe(0);
  });

  it('reuses one proxy per shared geometry across meshes and frames', () => {
    const shared = sharedGeometry(); const scene = new THREE.Scene(); const a = new THREE.Mesh(shared), b = new THREE.Mesh(shared); scene.add(a, b);
    const iso = new SharedGeometryIsolation(); iso.sync(scene); iso.sync(scene); iso.sync(scene);
    expect(a.geometry).toBe(b.geometry); expect(iso.size).toBe(1);
  });

  it('forwards attribute updates (version sync) and replaced arrays', () => {
    const shared = sharedGeometry(); const scene = new THREE.Scene(); const mesh = new THREE.Mesh(shared); scene.add(mesh);
    const iso = new SharedGeometryIsolation(); iso.sync(scene);
    const pa = (mesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute; const v0 = pa.version;
    shared.attributes.position.needsUpdate = true; iso.sync(scene);
    expect(pa.version).toBeGreaterThan(v0);
    const next = new Float32Array(shared.attributes.position.array.length); (shared.attributes.position as THREE.BufferAttribute).array = next; shared.attributes.position.needsUpdate = true;
    iso.sync(scene); expect(pa.array).toBe(next);
  });

  it('prunes proxies whose original left the scene, without disposing the original', () => {
    const shared = sharedGeometry(); const onShared = vi.fn(); shared.addEventListener('dispose', onShared);
    const scene = new THREE.Scene(); const mesh = new THREE.Mesh(shared); scene.add(mesh);
    const iso = new SharedGeometryIsolation(); iso.sync(scene);
    const proxy = mesh.geometry as THREE.BufferGeometry; const onProxy = vi.fn(); proxy.addEventListener('dispose', onProxy);
    scene.remove(mesh); iso.sync(new THREE.Object3D(), false); expect(iso.size).toBe(1); // side renders never prune
    iso.sync(scene); expect(iso.size).toBe(0); expect(onProxy).toHaveBeenCalledTimes(1); expect(onShared).not.toHaveBeenCalled();
  });

  it('dispose() frees every proxy, leaves originals and clears texture refs left in shader uniforms', () => {
    const shared = sharedGeometry(); const onShared = vi.fn(); shared.addEventListener('dispose', onShared);
    const moduleUniforms = { tDiffuse: { value: null as THREE.Texture | null }, h: { value: 0.01 } }; // like three-stdlib HorizontalBlurShader.uniforms
    const blur = new THREE.ShaderMaterial({ uniforms: moduleUniforms }); expect(blur.uniforms).toBe(moduleUniforms);
    const scene = new THREE.Scene(); scene.add(new THREE.Mesh(shared), new THREE.Mesh(new THREE.PlaneGeometry(), blur));
    const iso = new SharedGeometryIsolation(); iso.sync(scene); moduleUniforms.tDiffuse.value = new THREE.Texture();
    iso.dispose();
    expect(iso.size).toBe(0); expect(onShared).not.toHaveBeenCalled();
    expect(moduleUniforms.tDiffuse.value).toBeNull(); expect(moduleUniforms.h.value).toBe(0.01);
  });

  it('isolateRendererGeometry wraps render() and its cleanup restores it and disposes', () => {
    const shared = sharedGeometry(); const scene = new THREE.Scene(); const mesh = new THREE.Mesh(shared); scene.add(mesh);
    const seen: THREE.BufferGeometry[] = []; const orig = vi.fn((s: THREE.Object3D) => { s.traverse((o) => { if ((o as THREE.Mesh).geometry) seen.push((o as THREE.Mesh).geometry); }); });
    const gl = { render: orig as (s: THREE.Object3D, c: THREE.Camera) => unknown };
    const cleanup = isolateRendererGeometry(gl, scene);
    gl.render(scene, new THREE.PerspectiveCamera());
    expect(orig).toHaveBeenCalledTimes(1); expect(seen[0]).not.toBe(shared);
    const proxy = mesh.geometry; const onProxy = vi.fn(); proxy.addEventListener('dispose', onProxy);
    cleanup(); expect(gl.render).toBe(orig); expect(onProxy).toHaveBeenCalledTimes(1);
  });
});

describe('disposeMesh InstancedMesh lifecycle (P3 leak)', () => {
  it('fires the InstancedMesh dispose event so the renderer frees instanceMatrix / instanceColor', () => {
    const geo = new THREE.BoxGeometry(); const mat = new THREE.MeshBasicMaterial();
    const im = new THREE.InstancedMesh(geo, mat, 4); im.setColorAt(0, new THREE.Color('red'));
    const onIm = vi.fn(), onGeo = vi.fn(), onMat = vi.fn();
    im.addEventListener('dispose', onIm); geo.addEventListener('dispose', onGeo); mat.addEventListener('dispose', onMat);
    disposeMesh(im);
    expect(onIm).toHaveBeenCalledTimes(1); expect(onGeo).toHaveBeenCalledTimes(1); expect(onMat).toHaveBeenCalledTimes(1);
  });

  it('still works for a plain Mesh and material arrays (no dispose method on Mesh)', () => {
    const geo = new THREE.BoxGeometry(); const m1 = new THREE.MeshBasicMaterial(), m2 = new THREE.MeshBasicMaterial();
    const s1 = vi.fn(), s2 = vi.fn(); m1.addEventListener('dispose', s1); m2.addEventListener('dispose', s2);
    expect(() => disposeMesh(new THREE.Mesh(geo, [m1, m2]))).not.toThrow(); expect(s1).toHaveBeenCalled(); expect(s2).toHaveBeenCalled();
  });

  it('repeated create/dispose cycles each release their instance buffers', () => {
    const geo = new THREE.BoxGeometry(); let fired = 0;
    for (let i = 0; i < 6; i++) { const im = new THREE.InstancedMesh(geo.clone(), new THREE.MeshBasicMaterial(), 8); im.addEventListener('dispose', () => fired++); disposeMesh(im); }
    expect(fired).toBe(6);
  });
});
