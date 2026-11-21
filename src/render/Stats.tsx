import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { getDrawStats, installDrawCounter } from './perf/drawCounter';
/** Exposes renderer counters on window.__info and on-screen avatar metrics on window.__metrics()
 *  (used by tools/shot.mjs and tools/devices.mjs for the perf / before-after tables). */
export function Stats() {
  const { gl, scene, camera, size } = useThree(); const last = useRef(0);
  // exact draw calls (shadow pass included): installed on the game renderer for the whole session
  useEffect(() => installDrawCounter(gl as unknown as Parameters<typeof installDrawCounter>[0]), [gl]);
  useFrame(() => { const now = performance.now(); if (now - last.current < 500) return; last.current = now; const i = gl.info; const d = getDrawStats(gl);
    (window as unknown as { __info: unknown }).__info = { calls: d.calls, callsMain: d.callsMain, callsShadow: d.callsShadow, triangles: d.triangles, trianglesShadow: d.trianglesShadow, geometries: i.memory.geometries, textures: i.memory.textures, programs: i.programs?.length }; });
  useEffect(() => { Object.assign(window as unknown as Record<string, unknown>, { __cam: camera, __gl: gl }); }, [camera, gl]); // debug / e2e handles
  useEffect(() => {
    (window as unknown as { __metrics: unknown }).__metrics = () => {
      const out: Record<string, unknown> = { zoom: Math.round((camera as THREE.OrthographicCamera).zoom * 10) / 10, size: [size.width, size.height] };
      scene.traverse((o) => {
        if (!o.userData.avatarId) return;
        const box = new THREE.Box3(); o.updateWorldMatrix(true, true);
        o.traverse((m) => { const s = m as THREE.SkinnedMesh; if (s.isSkinnedMesh && !s.userData.hairMotion) { // the spring hair copy was a rigid mesh before: keep the body metrics unchanged
           s.computeBoundingBox(); box.union(s.boundingBox!.clone().applyMatrix4(s.matrixWorld)); } });
        if (box.isEmpty()) return;
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity; const v = new THREE.Vector3();
        for (let k = 0; k < 8; k++) {
          v.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z).project(camera);
          const x = (v.x + 1) / 2 * size.width, y = (1 - v.y) / 2 * size.height;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        // vertical screen height of the standing body (feet -> top of head), in CSS px
        const feet = new THREE.Vector3(box.getCenter(v).x, box.min.y, box.getCenter(new THREE.Vector3()).z);
        const head = feet.clone().setY(box.max.y); const a = feet.clone().project(camera), b = head.clone().project(camera);
        out[o.userData.avatarId] = { worldH: Math.round((box.max.y - box.min.y) * 1000) / 1000, screenH: Math.round(Math.abs(a.y - b.y) / 2 * size.height),
          bboxPx: [Math.round(minX), Math.round(minY), Math.round(maxX), Math.round(maxY)], fullyVisible: minX >= 0 && minY >= 0 && maxX <= size.width && maxY <= size.height };
      });
      return out;
    };
  }, [scene, camera, size]);
  return null;
}
