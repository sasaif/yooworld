import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OC } from 'three-stdlib';
import { clampTarget, fitZoom, roomBounds, zoomLimits, type Bounds, type Room } from './cameraFit';

const ZOOM_TWEEN_MS = 650;
export const ISO_DIR = new THREE.Vector3(1, 1.05, 1.2).normalize();
/**
 * Orthographic isometric camera.
 * Touch: 1 finger = pan, pinch = zoom (+2-finger rotate). Mouse: left drag = pan, right drag = rotate, wheel = zoom.
 * A tap (no drag) is left to the scene (walk / select). Follows the active character until the user pans.
 * With `room`, the zoom is fitted to the screen and re-fitted on every resize / rotation (keeping the
 * player's own pinch/wheel zoom as a ratio of the fit), and pinch/wheel limits follow the fit.
 */
export function CameraRig({ target, zoom, dir = ISO_DIR, follow, interactive, panEnabled = true, room, bounds, zoomMul = 1, followLean }: {
  target: THREE.Vector3; zoom: number; room?: Room;
  /** play area the view is kept on (pan, follow, pinch, rotation); defaults to the room box when `room` is set */
  bounds?: Bounds; dir?: THREE.Vector3; follow?: () => THREE.Vector3 | null; interactive: boolean; panEnabled?: boolean;
  /** multiplier on the fitted zoom (size variant × 'Vue appartement' / 'Vue perso'); changes are animated */
  zoomMul?: number;
  /** 0 = camera centred on the followed avatar, 1 = on the room centre */
  followLean?: number;
}) {
  const { camera } = useThree(); const size = useThree((st) => st.size); const ctl = useRef<OC>(null);
  const fitRef = useRef(0); const fitCam = useRef<THREE.Camera | null>(null); const [lim, setLim] = useState({ min: 45, max: 420 });
  const following = useRef(true); const tmp = useRef(new THREE.Vector3());
  const area = bounds ?? (room ? roomBounds(room) : undefined);
  const back = useRef(new THREE.Vector3()); const fixed = useRef(new THREE.Vector3()); const ndc = useRef(new THREE.Vector3());
  const lastTouch = useRef(0); const dragging = useRef(false);
  const baseRef = useRef(0); const mulRef = useRef(zoomMul); const anim = useRef<{ from: number; to: number; t0: number } | null>(null);
  useEffect(() => {
    camera.position.copy(target).addScaledVector(dir, 30); camera.lookAt(target);
    (camera as THREE.OrthographicCamera).zoom = zoom; camera.updateProjectionMatrix();
    if (ctl.current) { ctl.current.target.copy(target); ctl.current.update(); }
  }, [camera]);
  useEffect(() => {
    if (!room || !size.width || !size.height) return;
    const cam = camera as THREE.OrthographicCamera; const fit = fitZoom(size.width, size.height, room, dir); const l = zoomLimits(fit);
    const base = fit * zoomMul; l.max = Math.max(l.max, base * 1.6);
    const fresh = fitCam.current !== camera || !baseRef.current; fitCam.current = camera;
    if (fresh) cam.zoom = THREE.MathUtils.clamp(base, l.min, l.max);
    else if (mulRef.current !== zoomMul) anim.current = { from: cam.zoom, to: THREE.MathUtils.clamp(base, l.min, l.max), t0: performance.now() }; // framing toggle: smooth zoom
    else cam.zoom = THREE.MathUtils.clamp(cam.zoom * (base / baseRef.current), l.min, l.max); // resize / rotation: keep the player's zoom ratio
    fitRef.current = fit; baseRef.current = base; mulRef.current = zoomMul; setLim(l); cam.updateProjectionMatrix(); ctl.current?.update();
  }, [size.width, size.height, room, camera, dir, zoomMul]);
  useEffect(() => {
    const on = () => { following.current = true; };
    window.addEventListener('yw:follow', on); return () => window.removeEventListener('yw:follow', on);
  }, []);
  useFrame((_, dt) => {
    if (anim.current !== null) {
      const cam = camera as THREE.OrthographicCamera; const a = anim.current;
      const t = Math.min(1, (performance.now() - a.t0) / ZOOM_TWEEN_MS); const e = t * t * (3 - 2 * t); // smoothstep, frame-rate independent
      cam.zoom = a.from + (a.to - a.from) * e; if (t >= 1) anim.current = null;
      cam.updateProjectionMatrix();
    }
    if (!ctl.current) return;
    const p = follow?.() ?? null;
    // the player panned away and left the avatar off screen: re-attach the follow after a short pause
    if (p && !following.current && !dragging.current && performance.now() - lastTouch.current > 1500) {
      const v = ndc.current.copy(p).project(camera); if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) following.current = true;
    }
    let moved = false;
    if (p && following.current) { moved = true;
      const want = tmp.current.set(p.x, target.y, p.z).lerp(target, followLean ?? (room ? 0.22 : 0.45)); // mostly on the player, a bit towards the room centre
      const delta = want.sub(ctl.current.target).multiplyScalar(Math.min(1, dt * 2.5));
      ctl.current.target.add(delta); camera.position.add(delta);
    }
    if (area) {
      // keep the view on the play area: no drifting off into the empty background (pan, follow, pinch-out, rotation)
      const t = ctl.current.target; back.current.subVectors(camera.position, t);
      const fixedT = clampTarget(t, back.current, target.y, area, size.width, size.height, (camera as THREE.OrthographicCamera).zoom, fixed.current);
      if (fixedT.distanceToSquared(t) > 1e-10) { camera.position.add(tmp.current.subVectors(fixedT, t)); t.copy(fixedT); moved = true; }
    }
    if (moved) ctl.current.update();
  });
  if (!interactive) return null;
  return (
    <OrbitControls ref={ctl as never} makeDefault enableDamping dampingFactor={0.12} minZoom={lim.min} enablePan={panEnabled} maxZoom={lim.max} zoomSpeed={0.9}
      minPolarAngle={0.55} maxPolarAngle={1.1} minAzimuthAngle={0.1} maxAzimuthAngle={1.45} screenSpacePanning
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => { following.current = false; anim.current = null; dragging.current = true; lastTouch.current = performance.now(); }}
      onEnd={() => { dragging.current = false; lastTouch.current = performance.now(); }} />
  );
}
