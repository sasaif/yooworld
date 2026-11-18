import { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { marker, stepMarker } from '../game/movement/marker';

const OK = new THREE.Color('#ffffff'), BAD = new THREE.Color('#ff9a9a');
/** Subtle destination marker on the floor: soft ring + slow outward ripple while walking there, quick fade on arrival,
 *  short muted-red ripple on an invalid tap. One instance per scene; state in game/movement/marker.ts. */
export function TapMarker() {
  const g = useRef<THREE.Group>(null!); const ring = useRef<THREE.Mesh>(null!); const ripple = useRef<THREE.Mesh>(null!); const dot = useRef<THREE.Mesh>(null!);
  useFrame((_, dt) => {
    const a = stepMarker(Math.min(dt, 0.25)); const G = g.current; G.visible = a > 0.01; if (!G.visible) return;
    G.position.set(marker.x, 0.012, marker.z);
    const bad = marker.phase === 'invalid', t = marker.t;
    const rm = ring.current.material as THREE.MeshBasicMaterial, pm = ripple.current.material as THREE.MeshBasicMaterial, dm = dot.current.material as THREE.MeshBasicMaterial;
    rm.color.copy(bad ? BAD : OK); pm.color.copy(rm.color); dm.color.copy(rm.color);
    if (bad) { ring.current.scale.setScalar(1.1 - 0.4 * Math.min(1, t / 0.6)); rm.opacity = 0.7 * a; pm.opacity = 0; dm.opacity = 0.35 * a; return; }
    const pulse = 1 + Math.sin(t * 5) * 0.06; const appear = 0.75 + 0.25 * Math.min(1, t / 0.18);
    ring.current.scale.setScalar(appear * pulse * (marker.phase === 'fading' ? 1 + t * 0.6 : 1)); rm.opacity = 0.75 * a;
    const k = (t % 1.2) / 1.2; ripple.current.scale.setScalar(0.8 + k * 1.1); pm.opacity = 0.4 * (1 - k) * a * (marker.phase === 'active' ? 1 : 0);
    dm.opacity = 0.28 * a;
  });
  return (
    <group ref={g} visible={false} name="tap-marker">
      <mesh ref={ring} rotation-x={-Math.PI / 2} renderOrder={2}><ringGeometry args={[0.13, 0.17, 40]} /><meshBasicMaterial transparent depthWrite={false} opacity={0} /></mesh>
      <mesh ref={ripple} rotation-x={-Math.PI / 2} renderOrder={2}><ringGeometry args={[0.15, 0.175, 40]} /><meshBasicMaterial transparent depthWrite={false} opacity={0} /></mesh>
      <mesh ref={dot} rotation-x={-Math.PI / 2} renderOrder={2}><circleGeometry args={[0.05, 20]} /><meshBasicMaterial transparent depthWrite={false} opacity={0} /></mesh>
    </group>
  );
}
