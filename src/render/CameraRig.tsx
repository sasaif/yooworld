import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { OrbitControls as OC } from 'three-stdlib';
import { fitZoom, zoomLimits, type Room } from './cameraFit';

export const ISO_DIR = new THREE.Vector3(1, 1.05, 1.2).normalize();
/**
 * Orthographic isometric camera.
 * Touch: 1 finger = pan, pinch = zoom (+2-finger rotate). Mouse: left drag = pan, right drag = rotate, wheel = zoom.
 * A tap (no drag) is left to the scene (walk / select). Follows the active character until the user pans.
 * With `room`, the zoom is fitted to the screen and re-fitted on every resize / rotation (keeping the
 * player's own pinch/wheel zoom as a ratio of the fit), and pinch/wheel limits follow the fit.
 */
export function CameraRig({ target, zoom, dir = ISO_DIR, follow, interactive, panEnabled = true, room }: {
  target: THREE.Vector3; zoom: number; room?: Room; dir?: THREE.Vector3; follow?: () => THREE.Vector3 | null; interactive: boolean; panEnabled?: boolean;
}) {
  const { camera } = useThree(); const size = useThree((st) => st.size); const ctl = useRef<OC>(null);
  const fitRef = useRef(0); const fitCam = useRef<THREE.Camera | null>(null); const [lim, setLim] = useState({ min: 45, max: 420 });
  const following = useRef(true); const tmp = useRef(new THREE.Vector3());
  useEffect(() => {
    camera.position.copy(target).addScaledVector(dir, 30); camera.lookAt(target);
    (camera as THREE.OrthographicCamera).zoom = zoom; camera.updateProjectionMatrix();
    if (ctl.current) { ctl.current.target.copy(target); ctl.current.update(); }
  }, [camera]);
  useEffect(() => {
    if (!room || !size.width || !size.height) return;
    const cam = camera as THREE.OrthographicCamera; const fit = fitZoom(size.width, size.height, room, dir); const l = zoomLimits(fit);
    const fresh = fitCam.current !== camera; fitCam.current = camera;
    cam.zoom = THREE.MathUtils.clamp(fitRef.current && !fresh ? cam.zoom * (fit / fitRef.current) : fit, l.min, l.max);
    fitRef.current = fit; setLim(l); cam.updateProjectionMatrix(); ctl.current?.update();
  }, [size.width, size.height, room, camera, dir]);
  useEffect(() => {
    const on = () => { following.current = true; };
    window.addEventListener('yw:follow', on); return () => window.removeEventListener('yw:follow', on);
  }, []);
  useFrame((_, dt) => {
    if (!follow || !following.current || !ctl.current) return;
    const p = follow(); if (!p) return;
    const want = tmp.current.set(p.x, target.y, p.z).lerp(target, room ? 0.22 : 0.45); // mostly on the player, a bit towards the room centre
    const delta = want.sub(ctl.current.target).multiplyScalar(Math.min(1, dt * 2.5));
    ctl.current.target.add(delta); camera.position.add(delta); ctl.current.update();
  });
  if (!interactive) return null;
  return (
    <OrbitControls ref={ctl as never} makeDefault enableDamping dampingFactor={0.12} minZoom={lim.min} enablePan={panEnabled} maxZoom={lim.max} zoomSpeed={0.9}
      minPolarAngle={0.55} maxPolarAngle={1.1} minAzimuthAngle={0.1} maxAzimuthAngle={1.45} screenSpacePanning
      mouseButtons={{ LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }}
      touches={{ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }}
      onStart={() => { following.current = false; }} />
  );
}
