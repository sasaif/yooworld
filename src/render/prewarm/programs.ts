import * as THREE from 'three';

/**
 * Shader-program warm-up (first-trip hitch).
 *
 * The first frame of a location links every program it needs, synchronously (headless profile of the first
 * apartment -> beach trip: ~90 % of the long task is getShaderInfoLog / getProgramInfoLog / getProgramParameter).
 * three shares programs between materials by cache key, and a program lives as long as one material holding it is
 * alive. So: compile, while idle, the exact programs a location will ask for (same material parameters, same lights,
 * fog, render target kind), on materials we keep alive. When the location mounts, its materials find the programs in
 * the cache: no link on the critical frame. Nothing is rendered and no geometry / texture is uploaded here.
 */
type Renderable = THREE.Mesh | THREE.Points | THREE.Line;
type Compiler = Pick<THREE.WebGLRenderer, 'compile' | 'compileAsync' | 'getRenderTarget' | 'setRenderTarget'> & { extensions?: { has(name: string): boolean } };

const retained: THREE.Material[] = [];
/** materials kept alive only for their programs (tests / debug) */
export const retainedCount = () => retained.length;
/** Free everything retained (tests; also usable if the renderer is torn down). */
export function releaseWarmPrograms() { retained.splice(0).forEach((m) => m.dispose()); }

/** Same program cache key as `m` (Material.copy drops onBeforeCompile / customProgramCacheKey: carry them over). */
export function cloneForProgram(m: THREE.Material): THREE.Material {
  const c = m.clone(); c.onBeforeCompile = m.onBeforeCompile; c.customProgramCacheKey = m.customProgramCacheKey; return c;
}

const isR = (o: THREE.Object3D): o is Renderable => (o as THREE.Mesh).isMesh === true || (o as THREE.Points).isPoints === true || (o as THREE.Line).isLine === true;

/** Visible renderables under `root`, skipping whole subtrees for which `skip(o)` is true. */
export function collectRenderables(root: THREE.Object3D, skip: (o: THREE.Object3D) => boolean = () => false): Renderable[] {
  const out: Renderable[] = [];
  const walk = (o: THREE.Object3D) => { if (!o.visible || skip(o)) return; if (isR(o)) out.push(o); o.children.forEach(walk); };
  walk(root); return out;
}

/** An object of the same kind as `o` (what three's program parameters read from the object), sharing its geometry. */
export function standIn(o: Renderable, material: THREE.Material | THREE.Material[]): THREE.Object3D {
  const g = o.geometry;
  if ((o as THREE.SkinnedMesh).isSkinnedMesh) return new THREE.SkinnedMesh(g, material);
  if ((o as THREE.InstancedMesh).isInstancedMesh) {
    const src = o as THREE.InstancedMesh; const im = new THREE.InstancedMesh(g, material, 1);
    if (src.instanceColor) im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    im.morphTexture = src.morphTexture; return im;
  }
  if ((o as THREE.Points).isPoints) return new THREE.Points(g, material);
  if ((o as THREE.LineSegments).isLineSegments) return new THREE.LineSegments(g, material);
  if ((o as THREE.Line).isLine) return new THREE.Line(g, material);
  return new THREE.Mesh(g, material);
}

const SHADOW_SIDE: Record<number, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide, [THREE.DoubleSide]: THREE.DoubleSide };

export interface WarmOptions {
  /** compile on retained clones (programs survive when the originals are disposed on unmount); otherwise on the
   *  originals (they must outlive the warm-up themselves, e.g. avatar materials) */
  clone: boolean;
  /** also warm the shadow-pass depth programs of the shadow casters */
  shadows?: boolean;
}

/**
 * Compile (async where the browser can) the programs `objects` need under the lights and fog of `lightsFrom`.
 * Resolves with the number of materials compiled.
 */
export async function warmPrograms(gl: Compiler, camera: THREE.Camera, objects: Renderable[], lightsFrom: THREE.Scene, opt: WarmOptions): Promise<number> {
  const main = new THREE.Scene(); const clones = new Map<THREE.Material, THREE.Material>();
  const pick = (m: THREE.Material) => { if (!opt.clone) return m; let c = clones.get(m); if (!c) { c = cloneForProgram(m); clones.set(m, c); } return c; };
  const depth = new THREE.Scene(); const depthMats = new Map<string, THREE.MeshDepthMaterial>();
  for (const o of objects) {
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).filter((m): m is THREE.Material => !!m && m.visible);
    if (!mats.length) continue;
    main.add(standIn(o, Array.isArray(o.material) ? mats.map(pick) : pick(mats[0])));
    if (opt.shadows && o.castShadow && (o as THREE.Mesh).isMesh) {
      // what WebGLShadowMap draws a caster with: MeshDepthMaterial (RGBA packing), side flipped (or shadowSide)
      const m0 = mats[0]; const side = m0.shadowSide ?? SHADOW_SIDE[m0.side];
      let d = depthMats.get(String(side));
      if (!d) { d = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side }); depthMats.set(String(side), d); }
      depth.add(standIn(o, d));
    }
  }
  // without KHR_parallel_shader_compile, compileAsync is compile + a timer (and three warns once): call compile directly
  const parallel = gl.extensions?.has('KHR_parallel_shader_compile') ?? true;
  const compile = (sc: THREE.Scene): Promise<unknown> => (parallel ? gl.compileAsync(sc, camera, lightsFrom) : (gl.compile(sc, camera, lightsFrom), Promise.resolve()));
  const jobs: Promise<unknown>[] = [compile(main)];
  if (depth.children.length) {
    // the shadow pass renders into a render target (linear output, no tone mapping) with no fog: match that
    const prevRT = gl.getRenderTarget(); const rt = new THREE.WebGLRenderTarget(1, 1); const fog = lightsFrom.fog;
    lightsFrom.fog = null; gl.setRenderTarget(rt);
    try { jobs.push(compile(depth)); } finally { gl.setRenderTarget(prevRT); lightsFrom.fog = fog; rt.dispose(); }
  }
  const n = (opt.clone ? clones.size : main.children.length) + depthMats.size;
  await Promise.all(jobs);
  retained.push(...clones.values(), ...depthMats.values());
  main.clear(); depth.clear(); // stand-ins dropped: only the materials (and so the programs) are kept
  return n;
}
