/**
 * DEV-ONLY perf harness for the integrated hair motion (served by the dev server at /tools/hairperf/index.html, not part
 * of the build). N game avatars (the real CustomAvatar build, so the real rig) walk / run / stop on the beach floor,
 * seen through the game's orthographic iso camera (ISO_DIR). The hair is driven by the real driveHair() with its budget,
 * frustum and screen-size LOD. ?n=20&hairmotion=0|1&max=8&ppm=60 (screen px per metre). Deterministic window.__timedStep(dt).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIM_LIBRARY, ATLAS_MASK, AVATARS } from '../../src/data/avatars';
import { DEFAULT_LOOK } from '../../src/fashion/look';
import type { Look } from '../../src/fashion/types';
import { loadMask, loadParts } from '../../src/render/avatar/custom/parts';
import { prepareSource } from '../../src/render/avatar/custom/source';
import { buildCustomAvatar, setAtlasMask, type CustomAvatar } from '../../src/render/avatar/custom/CustomAvatar';
import { modeBlend } from '../../src/game/movement/animBlend';
import { MOVE_DEFAULTS } from '../../src/game/movement/MovementController';
import { ISO_DIR } from '../../src/render/CameraRig';
import { driveHair, hairEntry, hairMotion, type HairEntry } from '../../src/render/avatar/hair/hairMotion';

const qs = new URLSearchParams(location.search); const N = +(qs.get('n') ?? 20); if (qs.get('max')) hairMotion.maxRigs = +qs.get('max')!; const PPM = +(qs.get('ppm') ?? 60);
const canvas = document.getElementById('c') as HTMLCanvasElement; const hud = document.getElementById('hud')!;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5)); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.info.autoReset = false;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#cfe3f2');
scene.add(new THREE.HemisphereLight('#fff1e0', '#a184bf', 1.05)); const sun = new THREE.DirectionalLight('#ffd9ae', 2.3); sun.position.set(3, 8, 4.5); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 }); scene.add(sun);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.MeshLambertMaterial({ color: '#e9dcc8' })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
const load = (u: string) => new GLTFLoader().loadAsync(u) as unknown as Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>;
const LOOKS: Look[] = [DEFAULT_LOOK.f, { ...DEFAULT_LOOK.f, slots: { ...DEFAULT_LOOK.f.slots, hair: 'hair_long', hairColor: 'haircol_brown' } }];
interface Agent { a: CustomAvatar; outer: THREE.Group; e: HairEntry; vel: THREE.Vector3; yaw: number; w: { idle: number; walk: number; run: number }; phase: number; lane: number; home: THREE.Vector3 }
const agents: Agent[] = []; let T = 0; const _dir = new THREE.Vector3(); let frame = 0;
const perf = { hairMs: 0, updated: 0, skipped: 0, calls: 0, tris: 0 };
function drive(g: Agent, dir: THREE.Vector3 | null, speed: number, mode: 'walk' | 'run', dt: number) { // MovementController accel / decel / turn model
  const tx = dir ? dir.x * speed : 0, tz = dir ? dir.z * speed : 0; const cfg = MOVE_DEFAULTS; const dvx = tx - g.vel.x, dvz = tz - g.vel.z; const dm = Math.hypot(dvx, dvz); const acc = (dir ? cfg.accel : cfg.decel) * dt;
  if (dm <= acc) { g.vel.x = tx; g.vel.z = tz; } else { g.vel.x += (dvx / dm) * acc; g.vel.z += (dvz / dm) * acc; }
  g.outer.position.x += g.vel.x * dt; g.outer.position.z += g.vel.z * dt; const sp = Math.hypot(g.vel.x, g.vel.z);
  if (dir && speed > 0) { const ty = Math.atan2(tx, tz); let d = ty - g.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); g.yaw += d * (1 - Math.exp(-cfg.turnRate * dt)); }
  g.outer.rotation.y = g.yaw; const b = modeBlend(sp, AVATARS.f.scale, mode); const k = 1 - Math.exp(-dt * 10); const w = g.w;
  w.idle += (b.idle - w.idle) * k; w.walk += (b.walk - w.walk) * k; w.run += (b.run - w.run) * k;
  const A = g.a.actions; A.idle.setEffectiveWeight(w.idle); A.walk.setEffectiveWeight(w.walk); A.run.setEffectiveWeight(w.run); A.walk.timeScale = b.walkTS; A.run.timeScale = b.runTS;
  g.a.mixer.update(dt);
}
function step(dt: number) {
  T += dt; frame++; let ms = 0;
  for (const g of agents) { // each avatar walks / runs a small circle around its home, stops ~2 s every 7 s
    g.phase += dt; const cyc = g.phase % 7; const moving = cyc < 5.0; const run = g.lane % 3 === 0; const ang = g.phase * (run ? 1.6 : 1.1) + g.lane;
    _dir.set(Math.cos(ang), 0, -Math.sin(ang)); drive(g, moving ? _dir : null, run ? 1.9 : 1.2, run ? 'run' : 'walk', dt);
  }
  scene.updateMatrixWorld();
  const t0 = performance.now();
  for (let i = 0; i < agents.length; i++) { const g = agents[i]; if (g.e.rig) driveHair(g.e, dt, cam, canvas.clientHeight, frame, { priority: i === 0, frozen: false }); }
  ms = performance.now() - t0; perf.hairMs = ms;
}
function render() {
  const w = canvas.clientWidth, h = canvas.clientHeight; renderer.setSize(w, h, false); renderer.info.reset();
  const half = h / PPM / 2; cam.left = -half * w / h; cam.right = half * w / h; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix();
  cam.position.copy(ISO_DIR).multiplyScalar(30).add(new THREE.Vector3(0, 0.5, 0)); cam.lookAt(0, 0.5, 0); cam.updateMatrixWorld();
  renderer.render(scene, cam); perf.calls = renderer.info.render.calls; perf.tris = renderer.info.render.triangles; perf.updated = hairMotion.last.updated; perf.skipped = hairMotion.last.skipped;
  hud.textContent = `n=${N} hair=${hairMotion.enabled ? 'spring' : 'static'} max=${hairMotion.maxRigs} upd=${perf.updated} calls=${perf.calls} hair ${perf.hairMs.toFixed(3)} ms`;
}
async function main() {
  const [fG, mG, lib, fP, mP, mask] = await Promise.all([load(AVATARS.f.url), load(AVATARS.m.url), load(ANIM_LIBRARY), loadParts(AVATARS.f.parts), loadParts(AVATARS.m.parts), loadMask(ATLAS_MASK)]);
  setAtlasMask(mask); const fem = prepareSource(fG, fP, mask), mal = prepareSource(mG, mP, mask);
  const cols = Math.ceil(Math.sqrt(N * 1.6)), sp = 0.95;
  for (let i = 0; i < N; i++) {
    const a = buildCustomAvatar(fem, fem, mal, lib, AVATARS.f); a.applyLook(LOOKS[i % 2]);
    const outer = new THREE.Group(); outer.scale.setScalar(AVATARS.f.scale); outer.add(a.holder);
    const x = ((i % cols) - (cols - 1) / 2) * sp, z = (Math.floor(i / cols) - (Math.ceil(N / cols) - 1) / 2) * sp; outer.position.set(x, 0, z); scene.add(outer);
    a.holder.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
    for (const k of ['idle', 'walk', 'run'] as const) { a.actions[k].play(); a.actions[k].setEffectiveWeight(k === 'idle' ? 1 : 0); }
    agents.push({ a, outer, e: hairEntry('perf' + i, a.hair()), vel: new THREE.Vector3(), yaw: 0, w: { idle: 1, walk: 0, run: 0 }, phase: i * 0.37, lane: i, home: outer.position.clone() });
  }
  step(1e-4); render();
  Object.assign(window, { __ready: true, __agents: agents, __renderer: renderer, __perfH: perf,
    __timedStep: (dt: number) => { const t0 = performance.now(); step(dt); const t1 = performance.now(); render(); const t2 = performance.now(); renderer.getContext().finish(); const t3 = performance.now(); return [t3 - t0, t1 - t0, perf.hairMs, t3 - t2, perf.updated, perf.calls, perf.tris]; },
    __bench: (iters: number) => { const t0 = performance.now(); for (let i = 0; i < iters; i++) { frame++; for (let j = 0; j < agents.length; j++) { const g = agents[j]; if (g.e.rig) driveHair(g.e, 1 / 60, cam, canvas.clientHeight, frame, { priority: j === 0, frozen: false }); } } return (performance.now() - t0) / iters; } });
}
main().catch((e) => { hud.textContent = 'ERR ' + e; console.error(e); (window as unknown as Record<string, unknown>).__err = String(e); });
