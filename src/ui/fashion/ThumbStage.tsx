import { Suspense, useEffect, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useThree } from '@react-three/fiber';
import { CATALOGUE, ITEMS } from '../../fashion/catalogue';
import { DEFAULT_LOOK, equip, unequip } from '../../fashion/look';
import type { ItemDef, Look } from '../../fashion/types';
import { AvatarFigure, FRAMES, type CamFrame } from './AvatarFigure';
/** ?thumbs=1 — renders one catalogue item on a neutral avatar for tools/fashion/thumbs.mjs (auto-generated thumbnails). */
export const THUMBS = new URLSearchParams(location.search).has('thumbs');
export function frameFor(it: ItemDef): CamFrame {
  if (['face', 'eyes', 'brows', 'nose', 'mouth', 'beard'].includes(it.category)) return 'face';
  if (it.category === 'hair') return 'head'; if (it.category === 'pants') return 'legs'; if (it.category === 'shoes') return 'feet';
  if (it.category === 'accessory') { const m = it.render.acc!; if (m.startsWith('glasses_') || ['sunglasses', 'earrings_pearl', 'earrings_hoops', 'earrings_diamond'].includes(m)) return 'face';
    if (['cap', 'beanie', 'strawhat', 'crown', 'headphones'].includes(m)) return 'head'; if (['necklace_chain', 'necklace_heart', 'scarf'].includes(m)) return 'upper'; if (m === 'watch' || m === 'tote') return 'hand'; return 'body'; }
  if (it.category === 'dress') return 'body';
  return 'upper';
}
export function thumbLook(it: ItemDef): Look {
  const body = it.body ?? (['beard'].includes(it.category) ? 'm' : 'f'); let l = DEFAULT_LOOK[body];
  l = unequip(unequip(l, 'acc.bag'), 'details.blush');
  if (it.category === 'tshirt') l = unequip(l, 'jacket');
  if (it.category === 'hair' && it.tags?.includes('glam') && it.slot === 'hair') l = { ...l, slots: { ...l.slots, hairColor: 'haircol_black' } };
  else if (it.category === 'hair' || it.render.acc === 'headphones') l = { ...l, slots: { ...l.slots, hairColor: body === 'f' ? 'haircol_chestnut' : 'haircol_brown' } };
  return equip(l, it.id);
}
function Cam({ frame, yaw }: { frame: CamFrame; yaw: number }) {
  const { camera } = useThree(); const f = FRAMES[frame]; const cam = camera as THREE.PerspectiveCamera; const d = f.h / 2 / Math.tan((cam.fov * Math.PI) / 360);
  cam.position.set(Math.sin(yaw) * d, f.y + d * 0.06, Math.cos(yaw) * d); cam.lookAt(0, f.y, 0); cam.updateProjectionMatrix(); return null;
}
export function ThumbStage() {
  const [id, setId] = useState<string>(new URLSearchParams(location.search).get('thumbs') ?? 'hair_long'); const it = ITEMS[id] ?? ITEMS.hair_long; (window as unknown as { __thumbCur?: string }).__thumbCur ??= it.id;
  useEffect(() => { (window as unknown as { __thumbIds: () => string[] }).__thumbIds = () => CATALOGUE.filter((i) => !i.swatch).map((i) => i.id); (window as unknown as { __thumb: (i: string) => void }).__thumb = (i: string) => { const w = window as unknown as { __thumbReady: boolean; __thumbCur?: string }; if (w.__thumbCur === i) { w.__thumbReady = true; return; } w.__thumbReady = false; w.__thumbCur = i; setId(i); }; }, []);
  const frame = (new URLSearchParams(location.search).get('frame') as CamFrame | null) ?? frameFor(it); const yaw = frame === 'feet' ? 0.6 : it.render.acc === 'backpack' ? Math.PI * 0.8 : it.render.acc === 'watch' ? -0.9 : it.render.acc === 'tote' ? 0.9 : ['hair'].includes(it.category) ? 0.45 : 0.25;
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'transparent' }}>
      <Canvas dpr={2} camera={{ fov: 26 }} gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}>
        <hemisphereLight args={['#fff4fb', '#b38aa6', 1.3]} /><directionalLight position={[1.5, 2.5, 2]} intensity={1.6} color="#fff1e0" /><directionalLight position={[-2, 1.2, -1.5]} intensity={0.8} color="#c9b8ff" />
        <Suspense fallback={null}><AvatarFigure key={id} look={thumbLook(it)} still onBuilt={() => setTimeout(() => ((window as unknown as { __thumbReady: boolean }).__thumbReady = true), 350)} /></Suspense>
        <Cam frame={frame} yaw={yaw} />
      </Canvas>
    </div>
  );
}
