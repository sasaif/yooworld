import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { Room, type RoomInfo } from './Room';
import { Character } from './Character';
import { NavGrid } from './nav';
import { ROOM_D, ROOM_W } from './layout';
import { goTo, world, type CharState } from './world';

const q = new URLSearchParams(location.search);
const shot = q.get('shot'); // overview | close | walk | sit
const CENTER = new THREE.Vector3(ROOM_W / 2 - 0.2, 0.35, ROOM_D / 2 - 0.3);
const AV = [
  { id: 'f', name: 'Juanita', url: '/models/avatars/juanita_female.glb', color: '#e2569b', start: [3.0, 2.85], yaw: 0.5 },
  { id: 'm', name: 'Juan', url: '/models/avatars/juanita_male.glb', color: '#4f8be0', start: [3.7, 2.85], yaw: -0.3 },
] as const;
AV.forEach((a) => { world.chars[a.id] = { id: a.id, name: a.name, pos: new THREE.Vector3(a.start[0], 0, a.start[1]), yaw: a.yaw, path: [], mode: 'idle' }; });

const CAM: Record<string, { target: THREE.Vector3; zoom: number; dir?: THREE.Vector3 }> = {
  default: { target: CENTER, zoom: 122 },
  close: { target: new THREE.Vector3(2.75, 0.55, 1.15), zoom: 330, dir: new THREE.Vector3(0.55, 0.62, 1).normalize() },
  sit: { target: new THREE.Vector3(2.75, 0.55, 1.15), zoom: 330, dir: new THREE.Vector3(0.55, 0.62, 1).normalize() },
  walk: { target: new THREE.Vector3(3.7, 0.4, 2.6), zoom: 200 },
};
const ISO = new THREE.Vector3(1, 1.05, 1.2).normalize();

function Rig() {
  const { camera } = useThree();
  const cfg = CAM[shot ?? 'default'] ?? CAM.default;
  useEffect(() => { const d = cfg.dir ?? ISO; camera.position.copy(cfg.target).addScaledVector(d, 30); camera.lookAt(cfg.target); (camera as THREE.OrthographicCamera).zoom = cfg.zoom; camera.updateProjectionMatrix(); }, [camera]);
  return shot ? null : <OrbitControls target={cfg.target} enablePan={true} minZoom={60} maxZoom={420} minPolarAngle={0.5} maxPolarAngle={1.15} minAzimuthAngle={0.05} maxAzimuthAngle={1.5} />;
}

export default function App() {
  const [sel, setSel] = useState<string>('f');
  const [ready, setReady] = useState(false);
  const [msg, setMsg] = useState('');
  const [, force] = useState(0);
  const selRef = useRef(sel); selRef.current = sel;
  const onReady = useCallback((r: RoomInfo) => {
    const nav = new NavGrid(ROOM_W, ROOM_D, 0.2);
    nav.blockBox(0, 0, ROOM_W, 0.12, 0); nav.blockBox(0, 0, 0.12, ROOM_D, 0);
    r.boxes.forEach((b) => nav.blockBox(b.min.x, b.min.z, b.max.x, b.max.z, 0.1));
    world.nav = nav; world.seats = r.seats; setReady(true);
  }, []);
  const onFloor = useCallback((p: THREE.Vector3) => goTo(selRef.current, p), []);
  const say = (id: string, text: string, ms = 6000) => { world.chars[id].say = { text, until: performance.now() + ms }; };

  // scripted states for the screenshots
  useEffect(() => {
    if (!ready) return;
    const sofa = world.seats.find((s) => s.id === 'sofa')!; const chair = world.seats.find((s) => s.id === 'chair')!;
    const sitNow = (id: string, seat = sofa) => { const c = world.chars[id]; c.pos.copy(seat.front); c.path = [seat.front.clone()]; c.pendingSeat = seat; };
    if (shot === 'overview') { sitNow('m'); say('f', 'Bienvenue chez nous ! 🏠', 1e9); say('m', 'Coucou !', 1e9); }
    if (shot === 'close' || shot === 'sit') { sitNow('m'); const f = world.chars.f; f.pos.set(3.45, 0, 1.25); f.yaw = -0.6; if (shot === 'close') { f.emote = true; say('f', 'Trop bien ton canapé !', 1e9); } else { sitNow('f', chair); } }
    if (shot === 'walk') {
      const f = world.chars.f, m = world.chars.m; f.pos.set(2.3, 0, 2.9); m.pos.set(5.2, 0, 2.5);
      goTo('f', new THREE.Vector3(5.6, 0, 2.4)); goTo('m', new THREE.Vector3(1.6, 0, 2.7)); say('f', 'On va à la cuisine ?', 1e9);
    }
    if (!shot) say('f', 'Clique sur le sol pour marcher !', 5000);
    if (shot) setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), shot === 'walk' ? 3200 : 4500);
  }, [ready]);

  const cur = world.chars[sel];
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas shadows dpr={shot ? 1 : [1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}>
        <OrthographicCamera makeDefault near={0.1} far={100} />
        <color attach="background" args={['#2f2440']} />
        <hemisphereLight args={['#fff1e0', '#8a6fa8', 1.1]} />
        <directionalLight position={[CENTER.x + 3, 8, CENTER.z + 4.5]} intensity={2.2} color="#ffe2bf" castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0005} shadow-normalBias={0.02}
          shadow-camera-left={-6} shadow-camera-right={6} shadow-camera-top={6} shadow-camera-bottom={-6} target-position={[CENTER.x, 0, CENTER.z]} />
        <directionalLight position={[-4, 5, 8]} intensity={0.5} color="#d9e4ff" />
        <pointLight position={[1.55, 1.05, 0.35]} intensity={2.2} distance={4} decay={1.6} color="#ffb870" />
        <pointLight position={[0.35, 0.8, 3.2]} intensity={1.2} distance={3} decay={1.6} color="#ffc48a" />
        <pointLight position={[5.4, 1.6, 3.9]} intensity={1.4} distance={4} decay={1.6} color="#ffd6a8" />
        <Suspense fallback={null}>
          <Room onReady={onReady} onFloor={onFloor} />
          {ready && AV.map((a) => <Character key={a.id} c={world.chars[a.id] as CharState} url={a.url} tagColor={a.color} selected={sel === a.id && !shot} onSelect={() => setSel(a.id)} />)}
        </Suspense>
        <Rig />
      </Canvas>
      {!shot && (
        <div style={{ position: 'absolute', left: 12, top: 12, background: 'rgba(255,255,255,.88)', borderRadius: 12, padding: '10px 12px', fontSize: 13, color: '#2a2440', maxWidth: 330, boxShadow: '0 4px 14px rgba(0,0,0,.25)' }}>
          <b>Yooville · Appartement</b>
          <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
            {AV.map((a) => <button key={a.id} onClick={() => setSel(a.id)} style={{ border: 0, borderRadius: 8, padding: '5px 10px', cursor: 'pointer', color: '#fff', background: a.color, opacity: sel === a.id ? 1 : 0.45, fontWeight: 700 }}>{a.name}</button>)}
          </div>
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={() => { const s = world.seats.find((x) => x.id === 'sofa')!; goTo(sel, s.front, s); }}>🛋️ Canapé</button>
            <button onClick={() => { const s = world.seats.find((x) => x.id === 'chair')!; goTo(sel, s.front, s); }}>🪑 Fauteuil</button>
            <button onClick={() => { cur.emote = !cur.emote; force((n) => n + 1); }}>🎉 Danse</button>
          </div>
          <form style={{ marginTop: 8, display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); if (msg.trim()) say(sel, msg.trim()); setMsg(''); }}>
            <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Dire quelque chose…" style={{ flex: 1, padding: '4px 8px', borderRadius: 8, border: '1px solid #c9bfe0' }} />
            <button type="submit">💬</button>
          </form>
          <div style={{ marginTop: 6, opacity: 0.65, fontSize: 11 }}>Clic sol = marcher · clic avatar = sélectionner · molette = zoom · clic droit = déplacer la vue</div>
        </div>
      )}
    </div>
  );
}
