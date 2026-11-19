import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { getDrawStats } from './drawCounter';
import { getPerfSnapshot, installPerfDebug, isPerfAvailable, sampleFrame, setPerfEnabled, subscribePerf, perfEnabled, togglePerf } from './perfStats';

export { isPerfAvailable } from './perfStats';

export function usePerfEnabled() {
  const [on, setOn] = useState(perfEnabled);
  useEffect(() => subscribePerf(() => setOn(perfEnabled())), []);
  return on;
}

function typingInField(t: EventTarget | null) {
  if (!(t instanceof HTMLElement)) return false;
  const tag = t.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
}

/** Keyboard toggle (F9 or backtick). Only mounted when perf is available, so production without ?perf=1 pays nothing. */
export function usePerfHotkey() {
  useEffect(() => {
    installPerfDebug();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'F9' && e.key !== '`') return;
      if (typingInField(e.target)) return;
      e.preventDefault();
      togglePerf();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function countUniques(scene: THREE.Scene) {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) geos.add(m.geometry);
    const mat = m.material;
    if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
    else if (mat) mats.add(mat);
  });
  return { geometries: geos.size, materials: mats.size };
}

/** Inside the Canvas. Mount only while the overlay is on — otherwise zero per-frame cost. */
export function PerfCollector() {
  const { gl, scene } = useThree();
  const lastUnique = useRef({ t: 0, geometries: 0, materials: 0 });
  useFrame((_, dt) => {
    const now = performance.now();
    const u = lastUnique.current;
    if (now - u.t > 1000) { const c = countUniques(scene); u.t = now; u.geometries = c.geometries; u.materials = c.materials; }
    sampleFrame(dt, gl.info, u, getDrawStats(gl));
    const s = getPerfSnapshot();
    (window as unknown as { __info: unknown }).__info = { calls: s.calls, callsMain: s.callsMain, callsShadow: s.callsShadow, triangles: s.triangles, trianglesShadow: s.trianglesShadow, geometries: s.geometries, textures: s.textures, programs: s.programs };
  });
  return null;
}

/** HTML corner HUD (outside the Canvas). Pointer-events none; top-right under the top bar, clear of the joystick and the dock. */
export function PerfHud() {
  const on = usePerfEnabled();
  const [, tick] = useState(0);
  usePerfHotkey();
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [on]);
  if (!on) return null;
  const s = getPerfSnapshot();
  const tri = s.triangles >= 1000 ? (s.triangles / 1000).toFixed(1) + 'k' : String(s.triangles);
  return (
    <div className="perf-hud" aria-hidden="true">
      <div className="perf-hud-row"><b>{s.fps || '—'}</b> FPS</div>
      <div className="perf-hud-row">ms {s.msAvg.toFixed(1)} <span>max {s.msWorst.toFixed(1)}</span></div>
      <div className="perf-hud-row">draw {s.calls} <span>= {s.callsMain} + ombre {s.callsShadow}</span></div>
      <div className="perf-hud-row">tri {tri}</div>
      <div className="perf-hud-row">geo {s.geometries} · tex {s.textures} · prog {s.programs}</div>
      <div className="perf-hud-row muted">mat {s.uniqueMaterials} · F9 / `</div>
    </div>
  );
}

/** Call once from App: mounts the HUD (and the hotkey) only when perf is available. */
export function PerfLayer() {
  if (!isPerfAvailable()) return null;
  return <PerfHud />;
}

export function PerfCollectorGate() {
  const on = usePerfEnabled();
  if (!isPerfAvailable() || !on) return null;
  return <PerfCollector />;
}

export { setPerfEnabled, togglePerf };
