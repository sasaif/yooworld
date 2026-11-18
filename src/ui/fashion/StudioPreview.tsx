import { Suspense, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { ContactShadows } from '@react-three/drei';
import type { Look } from '../../fashion/types';
import { AvatarFigure, FRAMES, type CamFrame } from './AvatarFigure';
const _look = new THREE.Vector3(), _want = new THREE.Vector3();
function Rig({ frame, zoom }: { frame: CamFrame; zoom: number }) {
  const { camera } = useThree(); const t = useRef(new THREE.Vector3(0, FRAMES.body.y, 0));
  useFrame((_, dt) => { const f = FRAMES[frame]; const cam = camera as THREE.PerspectiveCamera; const h = f.h / zoom; const d = h / 2 / Math.tan((cam.fov * Math.PI) / 360) * Math.max(1, 1.05 / cam.aspect);
    t.current.lerp(_look.set(0, f.y, 0), Math.min(1, dt * 6)); cam.position.lerp(_want.set(0, t.current.y + d * 0.08, d), Math.min(1, dt * 6)); cam.lookAt(t.current); });
  return null;
}
/** Studio 3D preview: the player's own avatar on a podium, live try-on, drag to turn. */
export function StudioPreview({ look, base, compare, frame, dance }: { look: Look; base: Look; compare: boolean; frame: CamFrame; dance: boolean }) {
  const [yaw, setYaw] = useState(-0.35); const drag = useRef<{ x: number; y0: number } | null>(null); const [zoom, setZoom] = useState(1);
  return (
    <div className="st-preview" onPointerDown={(e) => { drag.current = { x: e.clientX, y0: yaw }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); }}
      onPointerMove={(e) => { if (drag.current) setYaw(drag.current.y0 + (e.clientX - drag.current.x) * 0.012); }} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}
      onWheel={(e) => setZoom((z) => Math.min(2.2, Math.max(0.7, z * (e.deltaY > 0 ? 0.92 : 1.08))))}>
      <Canvas dpr={[1, 2]} camera={{ fov: 30, position: [0, 0.6, 2.4] }} gl={{ antialias: true, alpha: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1, preserveDrawingBuffer: true }}>
        <hemisphereLight args={['#fff4fb', '#b38aa6', 1.25]} />
        <directionalLight position={[1.5, 2.5, 2]} intensity={1.6} color="#fff1e0" />
        <directionalLight position={[-2, 1.2, -1.5]} intensity={0.9} color="#c9b8ff" />
        <Suspense fallback={null}><AvatarFigure look={compare ? base : look} yaw={yaw} dance={dance} /></Suspense>
        <mesh rotation-x={-Math.PI / 2} position-y={-0.004}><circleGeometry args={[0.42, 48]} /><meshLambertMaterial color="#ffe3f1" /></mesh>
        <mesh rotation-x={-Math.PI / 2} position-y={-0.002}><ringGeometry args={[0.42, 0.45, 48]} /><meshBasicMaterial color="#ff8fc8" /></mesh>
        <ContactShadows position={[0, 0.001, 0]} opacity={0.35} scale={1.4} blur={2.2} far={1} resolution={256} frames={1} />
        <Rig frame={frame} zoom={zoom} />
      </Canvas>
      <div className="st-zoom"><button onClick={() => setZoom((z) => Math.min(2.2, z * 1.25))} aria-label="Zoom avant">＋</button><button onClick={() => setZoom((z) => Math.max(0.7, z / 1.25))} aria-label="Zoom arrière">－</button><button onClick={() => setYaw((y) => y + Math.PI / 2)} aria-label="Tourner">⟳</button></div>
    </div>
  );
}
