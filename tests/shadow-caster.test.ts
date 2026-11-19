import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { addShadowOnly, installShadowOnly, mergeForShadow, shadowOnlyCount } from '../src/render/shadow/shadowOnly';
import { MergedShadowCaster } from '../src/render/shadow/mergedCaster';

/** three r170 order inside WebGLRenderer.render(): the main render list is built first (skips visible === false),
 *  then shadowMap.render() traverses the scene again (skips visible === false, keeps castShadow meshes). */
function fakeRenderer(scene: THREE.Scene) {
  const passes = { main: [] as THREE.Object3D[], shadow: [] as THREE.Object3D[] };
  const shadowMap = { render: vi.fn(() => { scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh && o.castShadow) passes.shadow.push(o); }); }) };
  const render = () => {
    passes.main = []; passes.shadow = [];
    scene.traverseVisible((o) => { if ((o as THREE.Mesh).isMesh) passes.main.push(o); });
    shadowMap.render();
  };
  return { gl: { shadowMap }, render, passes };
}

describe('shadow-only objects', () => {
  it('are drawn in the shadow pass only, and hidden again after it', () => {
    const scene = new THREE.Scene(); const { gl, render, passes } = fakeRenderer(scene);
    const caster = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); caster.castShadow = true; scene.add(caster);
    const normal = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); normal.castShadow = true; scene.add(normal);
    const off = installShadowOnly(gl); const un = addShadowOnly(caster);
    render();
    expect(passes.main).toEqual([normal]);
    expect(passes.shadow).toEqual([caster, normal]);
    expect(caster.visible).toBe(false);
    un(); off();
    expect(shadowOnlyCount()).toBe(0);
  });

  it('install is ref-counted and restores the original shadowMap.render', () => {
    const scene = new THREE.Scene(); const { gl } = fakeRenderer(scene); const orig = gl.shadowMap.render;
    const a = installShadowOnly(gl), b = installShadowOnly(gl);
    expect(gl.shadowMap.render).not.toBe(orig);
    a(); expect(gl.shadowMap.render).not.toBe(orig);
    b(); expect(gl.shadowMap.render).toBe(orig);
  });

  it('stays a pass-through when something else wrapped shadowMap.render on top of it', () => {
    const scene = new THREE.Scene(); const { gl, render, passes } = fakeRenderer(scene);
    const off = installShadowOnly(gl); const mine = gl.shadowMap.render;
    const outer = vi.fn((...a: never[]) => (mine as (...x: never[]) => unknown)(...a)); gl.shadowMap.render = outer as never;
    off();
    expect(gl.shadowMap.render).toBe(outer);
    const m = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); m.castShadow = true; scene.add(m);
    const un = addShadowOnly(m); render(); un();
    expect(passes.shadow).toEqual([]); // inactive wrapper no longer reveals shadow-only objects
  });
});

describe('merged static shadow caster', () => {
  const box = () => new THREE.BoxGeometry(0.5, 1, 0.5);
  function setup() {
    const scene = new THREE.Scene(); const r = fakeRenderer(scene); const off = installShadowOnly(r.gl);
    const mat = new THREE.MeshLambertMaterial();
    const inst = new THREE.InstancedMesh(box(), mat, 3); inst.castShadow = true;
    [[1, 0, 1], [2, 0, 3], [4, 0, 2]].forEach(([x, y, z], i) => inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)));
    const wall = new THREE.Mesh(box(), mat); wall.position.set(0, 1, 0); wall.castShadow = true;
    const group = new THREE.Group(); group.position.set(10, 0, 0); group.add(inst, wall); scene.add(group);
    const caster = new MergedShadowCaster(); scene.add(caster.root);
    return { scene, ...r, off, inst, wall, group, caster, mat };
  }

  it('replaces N per-part shadow draws by ONE, with the same world-space triangles', () => {
    const { render, passes, inst, wall, caster, off } = setup();
    render(); expect(passes.shadow.length).toBe(2); // before: one shadow draw per source
    caster.track(inst); caster.track(wall);
    expect(inst.castShadow).toBe(false); expect(wall.castShadow).toBe(false);
    expect(caster.update()).toBe(true); expect(caster.update()).toBe(false); // rebuilt once
    render();
    expect(passes.shadow.length).toBe(1); expect(caster.drawCount).toBe(1);
    expect(passes.main).toEqual([inst, wall]); // main pass unchanged, merged mesh never drawn there
    const merged = passes.shadow[0] as THREE.Mesh;
    const tri = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    expect(tri(merged.geometry)).toBe(tri(inst.geometry) * 3 + tri(wall.geometry));
    expect(Object.keys(merged.geometry.attributes)).toEqual(['position']);
    // world-space bounds = union of the sources (instances at x 11..14, wall at x 10, y up to 1.5)
    merged.geometry.computeBoundingBox(); const bb = merged.geometry.boundingBox!;
    expect(bb.min.x).toBeCloseTo(9.75); expect(bb.max.x).toBeCloseTo(14.25);
    expect(bb.min.y).toBeCloseTo(-0.5); expect(bb.max.y).toBeCloseTo(1.5);
    expect(bb.min.z).toBeCloseTo(-0.25); expect(bb.max.z).toBeCloseTo(3.25);
    caster.dispose(); off();
  });

  it('rebuilds when a source changes or goes away, and frees the old merged geometry', () => {
    const { inst, wall, caster, off } = setup();
    const un = caster.track(inst); caster.track(wall); caster.update();
    const g0 = (caster.root.children[0] as THREE.Mesh).geometry; const disposed = vi.fn(); g0.addEventListener('dispose', disposed);
    un(); expect(caster.isDirty).toBe(true); caster.update();
    expect(disposed).toHaveBeenCalledOnce();
    const g1 = (caster.root.children[0] as THREE.Mesh).geometry;
    expect(g1.index!.count).toBe(wall.geometry.index!.count);
    inst.count = 2; caster.track(inst); caster.update();
    expect((caster.root.children[0] as THREE.Mesh).geometry.index!.count).toBe(wall.geometry.index!.count + inst.geometry.index!.count * 2);
    caster.dispose(); expect(caster.root.children.length).toBe(0); off();
  });

  it('keeps one merged mesh per material side (the depth pass culls faces by side)', () => {
    const { inst, caster, group, off } = setup();
    const glass = new THREE.Mesh(box(), new THREE.MeshLambertMaterial({ side: THREE.DoubleSide })); group.add(glass);
    caster.track(inst); caster.track(glass); caster.update();
    expect(caster.drawCount).toBe(2);
    const sides = caster.root.children.map((m) => ((m as THREE.Mesh).material as THREE.Material).side).sort();
    expect(sides).toEqual([THREE.FrontSide, THREE.DoubleSide]);
    caster.dispose(); off();
  });

  it('skips hidden sources', () => {
    const { inst, wall, caster, off } = setup();
    wall.visible = false; caster.track(inst); caster.track(wall); caster.update();
    expect((caster.root.children[0] as THREE.Mesh).geometry.index!.count).toBe(inst.geometry.index!.count * 3);
    caster.dispose(); off();
  });

  it('mergeForShadow handles non-indexed input and switches to 32-bit indices past 65535 vertices', () => {
    const g = new THREE.BoxGeometry().toNonIndexed();
    const m = mergeForShadow([{ geometry: g, matrix: new THREE.Matrix4() }]);
    expect(m.index!.count).toBe(36); expect(m.index!.array).toBeInstanceOf(Uint16Array);
    const big = new THREE.PlaneGeometry(1, 1, 300, 300); // 90601 vertices
    expect(mergeForShadow([{ geometry: big, matrix: new THREE.Matrix4() }]).index!.array).toBeInstanceOf(Uint32Array);
  });
});
