import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { Room, type RoomInfo } from '../render/Room';
import { Character } from '../render/Character';
import { CameraRig } from '../render/CameraRig';
import { Lighting } from '../render/Lighting';
import { Q } from '../render/quality';
import { NavGrid } from '../game/nav/NavGrid';
import { ROOM_D, ROOM_W } from '../data/layout';
import { AVATARS } from '../data/avatars';
import { goTo, makeChar, say, world } from '../game/world';
import { Hud } from '../ui/Hud';
import { SHOT, SHOT_CAM, runShotScript } from './shots';

const CENTER = new THREE.Vector3(ROOM_W / 2 - 0.2, 0.35, ROOM_D / 2 - 0.3);
world.chars.f = makeChar('f', 'Juanita', 3.0, 2.85, 0.5);
world.chars.m = makeChar('m', 'Juan', 3.7, 2.85, -0.3);

export default function App() {
  const [sel, setSel] = useState('f');
  const [ready, setReady] = useState(false);
  const selRef = useRef(sel); selRef.current = sel;
  const lastTap = useRef({ t: 0, p: new THREE.Vector3() });
  const onReady = useCallback((r: RoomInfo) => {
    const nav = new NavGrid(ROOM_W, ROOM_D, 0.2);
    nav.blockBox(0, 0, ROOM_W, 0.12, 0); nav.blockBox(0, 0, 0.12, ROOM_D, 0);
    r.boxes.forEach((b) => nav.blockBox(b.min.x, b.min.z, b.max.x, b.max.z, 0.1));
    world.nav = nav; world.seats = r.seats; setReady(true);
  }, []);
  const onFloor = useCallback((p: THREE.Vector3) => {
    const now = performance.now(); const dbl = now - lastTap.current.t < 380 && p.distanceTo(lastTap.current.p) < 0.6;
    lastTap.current = { t: now, p: p.clone() };
    if (goTo(selRef.current, p, { run: dbl })) window.dispatchEvent(new Event('yw:follow'));
  }, []);
  useEffect(() => { if (!ready) return; if (SHOT) runShotScript(); else say('f', 'Touche le sol pour marcher !', 5000); }, [ready]);
  const cam = SHOT ? SHOT_CAM[SHOT] : { target: CENTER, zoom: Math.min(innerWidth, innerHeight) < 600 ? 62 : 122 };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas shadows dpr={SHOT ? 1 : Q.dpr} gl={{ preserveDrawingBuffer: !!SHOT, antialias: Q.antialias, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
        <OrthographicCamera makeDefault near={0.1} far={100} />
        <color attach="background" args={['#2f2440']} />
        <Lighting center={[CENTER.x, 0, CENTER.z]} />
        <Suspense fallback={null}>
          <Room onReady={onReady} onFloor={onFloor} />
          {ready && Object.values(AVATARS).map((a) => (
            <Character key={a.id} c={world.chars[a.id]} def={a} selected={sel === a.id && !SHOT} onSelect={() => setSel(a.id)} />
          ))}
        </Suspense>
        <CameraRig target={cam.target} zoom={cam.zoom} dir={cam.dir} interactive={!SHOT} follow={SHOT ? undefined : () => world.chars[selRef.current]?.pos ?? null} />
      </Canvas>
      {!SHOT && <Hud sel={sel} setSel={setSel} />}
    </div>
  );
}
