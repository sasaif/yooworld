import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { cloneForProgram, collectRenderables, finishPrograms, releaseWarmPrograms, retainedCount, standIn, warmPrograms } from '../src/render/prewarm/programs';

afterEach(() => releaseWarmPrograms());

/** Records what compileAsync would compile: object kinds, materials, and the render-target / fog state at call time. */
function fakeCompiler() {
  let rt: THREE.WebGLRenderTarget | null = null;
  const calls: { kinds: string[]; mats: THREE.Material[]; lightsFrom: THREE.Scene; fog: THREE.Fog | THREE.FogExp2 | null; rt: boolean }[] = [];
  const gl = {
    getRenderTarget: () => rt, setRenderTarget: (r: THREE.WebGLRenderTarget | null) => { rt = r; },
    compile: (...a: unknown[]) => (gl.compileAsync as (...x: unknown[]) => unknown)(...a),
    compileAsync: vi.fn(async (scene: THREE.Object3D, _c: THREE.Camera, lightsFrom?: THREE.Scene | null) => {
      const kinds: string[] = [], mats: THREE.Material[] = [];
      scene.traverse((o) => { if (o === scene) return; kinds.push(o.type); const m = (o as THREE.Mesh).material; (Array.isArray(m) ? m : [m]).forEach((x) => x && mats.push(x)); });
      calls.push({ kinds, mats, lightsFrom: lightsFrom!, fog: lightsFrom!.fog, rt: rt !== null }); return scene;
    }),
  };
  return { gl: gl as unknown as THREE.WebGLRenderer, calls, rt: () => rt };
}

describe('program warm-up (first-trip hitch)', () => {
  it('clones keep the program cache key (onBeforeCompile / customProgramCacheKey carried over)', () => {
    const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
    m.onBeforeCompile = () => {}; m.customProgramCacheKey = () => 'sway';
    const c = cloneForProgram(m);
    expect(c).not.toBe(m); expect(c.customProgramCacheKey()).toBe('sway'); expect(c.onBeforeCompile).toBe(m.onBeforeCompile);
    expect(c.type).toBe(m.type); expect(c.side).toBe(THREE.DoubleSide); expect((c as THREE.MeshLambertMaterial).flatShading).toBe(true);
  });

  it('collects visible renderables only, skipping a whole subtree on request', () => {
    const root = new THREE.Scene(); const keep = new THREE.Mesh(); const hidden = new THREE.Mesh(); hidden.visible = false;
    const skipped = new THREE.Group(); skipped.add(new THREE.Mesh()); const pts = new THREE.Points(); const line = new THREE.LineSegments();
    root.add(keep, hidden, skipped, pts, line);
    expect(collectRenderables(root, (o) => o === skipped)).toEqual([keep, pts, line]);
  });

  it('stand-ins have the same kind as the source (what the program parameters read from the object)', () => {
    const g = new THREE.BoxGeometry(); const m = new THREE.MeshBasicMaterial();
    const inst = new THREE.InstancedMesh(g, m, 4); inst.setColorAt(0, new THREE.Color('red'));
    expect((standIn(new THREE.SkinnedMesh(g, m), m) as THREE.SkinnedMesh).isSkinnedMesh).toBe(true);
    const si = standIn(inst, m) as THREE.InstancedMesh; expect(si.isInstancedMesh).toBe(true); expect(si.instanceColor).not.toBeNull();
    expect((standIn(new THREE.InstancedMesh(g, m, 2), m) as THREE.InstancedMesh).instanceColor).toBeNull();
    expect((standIn(new THREE.Points(g, m), m) as THREE.Points).isPoints).toBe(true);
    expect((standIn(new THREE.LineSegments(g, m), m) as THREE.LineSegments).isLineSegments).toBe(true);
    expect(standIn(new THREE.Mesh(g, m), m).type).toBe('Mesh');
  });

  it('compiles under the given lights, warms the shadow depth programs like the shadow pass, keeps only materials', async () => {
    const { gl, calls, rt } = fakeCompiler();
    const lights = new THREE.Scene(); lights.fog = new THREE.Fog('#fff', 1, 2); lights.add(new THREE.DirectionalLight());
    const shared = new THREE.MeshLambertMaterial(); const dbl = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const a = new THREE.Mesh(new THREE.BoxGeometry(), shared); a.castShadow = true;
    const b = new THREE.Mesh(new THREE.BoxGeometry(), shared);
    const c = new THREE.SkinnedMesh(new THREE.BoxGeometry(), dbl); c.castShadow = true;
    const n = await warmPrograms(gl, new THREE.OrthographicCamera(), [a, b, c], lights, { clone: true, shadows: true });
    expect(calls.length).toBe(2);
    const [main, depth] = calls;
    expect(main.lightsFrom).toBe(lights); expect(main.fog).toBe(lights.fog); expect(main.rt).toBe(false);
    expect(main.kinds).toEqual(['Mesh', 'Mesh', 'SkinnedMesh']);
    expect(new Set(main.mats).size).toBe(2); expect(main.mats).not.toContain(shared); // one clone per distinct material
    // depth pass: rendered into a target, without fog, sides flipped like WebGLShadowMap (Front -> Back, Double stays)
    expect(depth.rt).toBe(true); expect(depth.fog).toBeNull(); expect(depth.kinds).toEqual(['Mesh', 'SkinnedMesh']);
    expect(depth.mats.map((m) => m.side)).toEqual([THREE.BackSide, THREE.DoubleSide]);
    expect(depth.mats.every((m) => (m as THREE.MeshDepthMaterial).depthPacking === THREE.RGBADepthPacking)).toBe(true);
    expect(lights.fog).not.toBeNull(); expect(rt()).toBeNull(); // state restored
    expect(n).toBe(4); expect(retainedCount()).toBe(4);
  });

  it('uses the synchronous compile when the browser has no KHR_parallel_shader_compile (no three warning)', async () => {
    const { gl } = fakeCompiler(); const g = gl as unknown as { extensions: { has: () => boolean }; compile: (...a: unknown[]) => unknown; compileAsync: unknown };
    const sync = vi.fn(); g.extensions = { has: () => false }; g.compile = sync;
    await warmPrograms(gl, new THREE.OrthographicCamera(), [new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial())], new THREE.Scene(), { clone: true });
    expect(sync).toHaveBeenCalledOnce(); expect(g.compileAsync).not.toHaveBeenCalled();
  });

  it('can compile on the original materials (they outlive the warm-up themselves) and skips invisible materials', async () => {
    const { gl, calls } = fakeCompiler(); const lights = new THREE.Scene();
    const m = new THREE.MeshLambertMaterial(); const off = new THREE.MeshBasicMaterial({ visible: false });
    await warmPrograms(gl, new THREE.OrthographicCamera(), [new THREE.Mesh(new THREE.BoxGeometry(), m), new THREE.Mesh(new THREE.BoxGeometry(), off)], lights, { clone: false });
    expect(calls.length).toBe(1); expect(calls[0].mats).toEqual([m]); expect(retainedCount()).toBe(0);
  });

  it('finishes programs one per slice (three first-use: link check + uniform / attribute lookup)', async () => {
    const order: string[] = []; const slices: (() => void)[] = [];
    const prog = (id: string) => ({ getUniforms: () => order.push(id + ':u'), getAttributes: () => order.push(id + ':a') });
    const broken = { getUniforms: () => { throw new Error('link failed'); }, getAttributes: () => 0 };
    const done = finishPrograms([prog('a'), broken, prog('b')], (fn) => { slices.push(fn); });
    for (let i = 0; i < 3; i++) { await Promise.resolve(); expect(slices.length).toBe(i + 1); slices[i](); await Promise.resolve(); }
    expect(await done).toBe(2); expect(order).toEqual(['a:u', 'a:a', 'b:u', 'b:a']);
  });
});
