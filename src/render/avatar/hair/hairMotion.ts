import * as THREE from 'three';
import { chainAngleDeg, resetPeaks, resetRig, setRigEnabled, stepRig, type HairRig } from './hairRig';
/**
 * Per-frame driver of the hair springs: global on/off (?hairmotion=0 → static meshes, exactly the old rendering),
 * frustum + screen-size LOD for the orthographic iso camera, a cap on the number of rigs updated per frame (the player's
 * own avatar always updates), freeze while seated / lying, and a read-only debug snapshot on window.__hair() (e2e).
 * No storage, no save key.
 */
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const hairMotion = {
  /** ?hairmotion=0: static fallback everywhere (A/B, quality toggle) */
  enabled: qs?.get('hairmotion') !== '0',
  /** springs updated per frame besides the player's own avatar (crowds: nearest-first is not needed at this count) */
  maxRigs: 8,
  /** screen-size LOD: below this many screen px per metre the hair is too small for the motion to read → rest pose */
  minPxPerM: 40,
  /** last completed frame: rigs updated / skipped, ms spent in the springs */
  last: { updated: 0, skipped: 0, ms: 0 },
};
const cur = { frame: -1 as number, updated: 0, skipped: 0, ms: 0, budget: 0 };
const _p = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3(), _sph = new THREE.Sphere(), _fr = new THREE.Frustum(), _pv = new THREE.Matrix4();

export type HairDriveResult = 'updated' | 'frozen' | 'culled' | 'lod' | 'budget' | 'off';
export interface HairEntry { style: string; key: string; rig: HairRig | null; state: HairDriveResult | 'static'; pxPerM: number }
/** avatar id → its hair state (debug / e2e) */
export const hairRegistry: Record<string, HairEntry> = {};

function beginFrame(frame: number, camera: THREE.Camera) {
  if (frame === cur.frame) return;
  if (cur.frame >= 0) hairMotion.last = { updated: cur.updated, skipped: cur.skipped, ms: Math.round(cur.ms * 1000) / 1000 };
  cur.frame = frame; cur.updated = 0; cur.skipped = 0; cur.ms = 0; cur.budget = 0;
  camera.updateMatrixWorld(); _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pv);
}
const toRest = (rig: HairRig) => { if (rig.chains.some((s) => s.init)) resetRig(rig); };

/**
 * Advance one avatar's hair (entry.rig must be set). Call AFTER its mixer + sit pose, BEFORE render. `frame` = any value
 * shared by all the avatars in one frame (e.g. state.clock.elapsedTime). `priority` = the player's own avatar (never
 * budget-culled). `frozen` = seated / lying / standing up: hair held at rest, springs re-initialised when it ends.
 */
export function driveHair(e: HairEntry, dt: number, camera: THREE.Camera, viewH: number, frame: number, o: { priority: boolean; frozen: boolean }): HairDriveResult {
  const rig = e.rig!; let r: HairDriveResult;
  if (!hairMotion.enabled) { setRigEnabled(rig, false); r = 'off'; }
  else {
    // seated / lying: the rigid mesh is shown (exact old rendering and contact metrics), springs re-initialised afterwards
    setRigEnabled(rig, !o.frozen); beginFrame(frame, camera);
    rig.attach.updateWorldMatrix(true, false); _w.setFromMatrixPosition(rig.attach.matrixWorld); _sph.center.copy(_w); _sph.radius = 0.6;
    e.pxPerM = pxPerMetre(_w, camera, viewH);
    if (o.frozen) r = 'frozen';
    else if (!_fr.intersectsSphere(_sph)) r = 'culled';
    else if (e.pxPerM < hairMotion.minPxPerM) r = 'lod';
    else if (!o.priority && cur.budget >= hairMotion.maxRigs) r = 'budget';
    else { const t0 = performance.now(); stepRig(rig, dt); cur.ms += performance.now() - t0; if (!o.priority) cur.budget++; r = 'updated'; }
    if (r === 'updated') cur.updated++; else { toRest(rig); cur.skipped++; }
  }
  e.state = r; return r;
}
/** screen px per world metre at `p` (orthographic or perspective camera) */
export function pxPerMetre(p: THREE.Vector3, camera: THREE.Camera, viewH: number) {
  _u.setFromMatrixColumn(camera.matrixWorld, 1).normalize().add(p); const a = _p.copy(p).project(camera).y, b = _u.project(camera).y; return Math.abs(b - a) * 0.5 * viewH;
}

if (typeof window !== 'undefined') {
  Object.assign(window as unknown as Record<string, unknown>, {
    /** e2e / tuning: read-only hair motion snapshot */
    __hair: () => ({
      enabled: hairMotion.enabled, maxRigs: hairMotion.maxRigs, minPxPerM: hairMotion.minPxPerM, last: { ...hairMotion.last },
      avatars: Object.fromEntries(Object.entries(hairRegistry).map(([id, e]) => [id, {
        style: e.style, key: e.key, state: e.state, pxPerM: Math.round(e.pxPerM), skinnedVisible: e.rig ? e.rig.mesh.visible : false, rigidVisible: e.rig ? e.rig.rigid.visible : true,
        bones: e.rig ? e.rig.bones.map((b) => b.name) : [], ties: e.rig ? e.rig.ties.map((t) => t.parent?.name ?? '') : [],
        chains: e.rig ? e.rig.chains.map((s, i) => ({ name: s.c.name, deg: Math.round(chainAngleDeg(s) * 100) / 100, peak: Math.round(e.rig!.peak[i] * 100) / 100,
          lim: { side: +(s.lim.side * 180 / Math.PI).toFixed(2), back: +(s.lim.back * 180 / Math.PI).toFixed(2), fwd: +(s.lim.fwd * 180 / Math.PI).toFixed(2), up: +(s.lim.up * 180 / Math.PI).toFixed(2) }, stiff: e.rig!.stiff })) : [],
      }])),
    }),
    /** cheap per-frame perf read (last completed frame) */
    __hairLast: () => hairMotion.last,
    __hairResetPeaks: () => { for (const e of Object.values(hairRegistry)) if (e.rig) resetPeaks(e.rig); },
  });
}

/** The registry entry of avatar `id`, synced with its current rig (rebuilt with the hair). */
export function hairEntry(id: string, h: { rig: HairRig | null; key: string; style: string }): HairEntry {
  let e = hairRegistry[id]; if (!e) e = hairRegistry[id] = { style: '', key: '', rig: null, state: 'static', pxPerM: 0 };
  e.rig = h.rig; e.style = h.style; e.key = h.key; if (!h.rig) e.state = 'static'; return e;
}
