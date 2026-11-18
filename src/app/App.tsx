import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { OrthographicCamera } from '@react-three/drei';
import { ApartmentView } from '../render/apartment/ApartmentView';
import { Character } from '../render/Character';
import { CameraRig } from '../render/CameraRig';
import { Lighting } from '../render/Lighting';
import { Q } from '../render/quality';
import { AVATARS } from '../data/avatars';
import { APT_COLS, APT_ROWS } from '../data/defaultApartment';
import { CELL } from '../game/apartment/ApartmentModel';
import { WALL_H } from '../data/style';
import { makeChar, say, world } from '../game/world';
import { useStore } from '../core/store';
import { Hud } from '../ui/Hud';
import { Stats } from '../render/Stats';
import { game } from './services';
import { SHOT, SHOT_CAM, runShotScript } from './shots';
import { RotateOverlay } from '../ui/RotateOverlay';
import { BeachAmbience, BeachView } from '../render/beach/BeachView';
import { BEACH_CENTER, BEACH_FRAME } from '../game/beach/beachLayout';
import { TravelFade } from '../ui/TravelFade';
import { VARIANT } from './variant';
import { camStore, camViewFollow, camViewZoomMul } from './camView';
import { startLocation } from './startLocation';

const LIEU_KEY = 'yw.lieuDefaultUsed';
function startAt() {
  let used = false; try { used = sessionStorage.getItem(LIEU_KEY) === '1'; } catch { /* */ }
  const s = startLocation(location.search, import.meta.env.VITE_DEFAULT_LIEU as string | undefined, used);
  try { sessionStorage.setItem(LIEU_KEY, '1'); } catch { /* */ }
  return s;
}

const W = APT_COLS * CELL, D = APT_ROWS * CELL;
const CENTER = new THREE.Vector3(W / 2 - 0.2, 0.35, D / 2 - 0.3);
world.chars.f = makeChar('f', 'Juanita', 3.0, 2.85, 0.5);
world.chars.m = makeChar('m', 'Juan', 3.7, 2.85, -0.3);
const small = Math.min(innerWidth, innerHeight) < 600;
const ROOM = { w: W, d: D, wallH: WALL_H };

export default function App() {
  const ready = useStore(game.store, (s) => s.ready); const active = useStore(game.store, (s) => s.activeChar);
  const placing = useStore(game.store, (s) => !!s.placing); const loc = useStore(game.store, (s) => s.location);
  const view = useStore(camStore, (s) => s.view);
  useEffect(() => { game.init({ startAt: SHOT ? null : startAt() }).then(() => {
    const p = game.s.profile!; world.chars[game.s.activeChar].name = p.name;
    if (SHOT?.startsWith('beach')) game.travel('beach');
    if (SHOT) setTimeout(runShotScript, 300); else say(game.s.activeChar, 'Touche le sol pour marcher !', 5000);
  }); }, []);
  const beach = loc === 'beach';
  const cam = SHOT ? SHOT_CAM[SHOT] : { target: beach ? BEACH_CENTER : CENTER, zoom: small ? 70 : 122 };
  return (
    <div className={'stage' + (beach ? ' beach' : '')}>
      <Canvas shadows="soft" dpr={SHOT ? (small ? 2 : 1) : Q.dpr} gl={{ alpha: true, preserveDrawingBuffer: !!SHOT, antialias: Q.antialias, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05 }}
        onPointerMissed={() => game.store.set({ menuItem: null })}>
        <OrthographicCamera makeDefault near={0.1} far={100} />
        {beach ? <BeachAmbience /> : <Lighting center={[CENTER.x, 0, CENTER.z]} />}
        <Suspense fallback={null}>
          {ready && !beach && <ApartmentView />}
          {ready && beach && <BeachView />}
          {ready && Object.values(AVATARS).map((a) => (
            <Character key={a.id} c={world.chars[a.id]} def={a} selected={active === a.id && !SHOT} onSelect={() => game.setActive(a.id)} />
          ))}
        </Suspense>
        <Stats />
        <CameraRig key={loc} target={cam.target} zoom={cam.zoom} dir={cam.dir} interactive={!SHOT} panEnabled={!placing} room={SHOT ? undefined : beach ? BEACH_FRAME : ROOM}
          zoomMul={camViewZoomMul(view, VARIANT.zoomMul)} followLean={camViewFollow(view, beach ? 0.22 : VARIANT.follow)}
          follow={SHOT ? undefined : () => world.chars[game.s.activeChar]?.pos ?? null} />
      </Canvas>
      {(!SHOT || SHOT.startsWith('ui')) && <Hud />}
      <TravelFade />
      {!SHOT && <RotateOverlay />}
    </div>
  );
}
