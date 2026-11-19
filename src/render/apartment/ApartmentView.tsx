import { newTapMemo, registerTap } from '../../game/movement/doubleTap';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { FURNITURE } from '../../data/furniture';
import { floorById, wallById } from '../../data/finishes';
import { BACK_WALL, LEFT_WALL, S, TILE } from '../../data/style';
import { baseHeight, CELL, childrenOf, footprint, itemTransform, type ApartmentLayout, type PlacedItem } from '../../game/apartment/ApartmentModel';
import { Q } from '../quality';
import { flattenModel, mergeSimple, type Part } from './furnitureParts';
import { floorTexture, wallTexture } from './finishTextures';
import { InteractionMenu } from '../../ui/InteractionMenu';
import { Decor } from './Decor';
import { TapMarker } from '../TapMarker';
import { useDispose } from '../dispose';
import { onFloorTap } from '../../app/floorTap';

const URL = (m: string) => `${import.meta.env.BASE_URL}models/furniture/${m}.glb`;
Object.values(FURNITURE).forEach((d) => useGLTF.preload(URL(d.model)));
[...new Set([...BACK_WALL, ...LEFT_WALL])].forEach((m) => useGLTF.preload(URL(m)));

function useParts(defId: string): Part[] {
  const def = FURNITURE[defId]; const { scene } = useGLTF(URL(def.model));
  return useMemo(() => flattenModel(def.model, scene, def.tint), [scene, def]);
}

/** All copies of one catalogue item = one InstancedMesh per material part. */
function FurnitureBatch({ defId, items, apt }: { defId: string; items: PlacedItem[]; apt: ApartmentLayout }) {
  const parts = useParts(defId);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    items.forEach((it, i) => {
      const t = itemTransform(it, FURNITURE); m.compose(pos.set(t.x, baseHeight(apt, FURNITURE, it), t.z), q.setFromAxisAngle(up, t.yaw), one);
      refs.current.forEach((im) => im?.setMatrixAt(i, m));
    });
    refs.current.forEach((im) => { if (im) { im.count = items.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); } });
  }, [items, apt, parts]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8 || game.s.placing) return; e.stopPropagation();
    const it = items[e.instanceId ?? 0]; if (it) game.tapItem(it.uid);
  };
  return <>{parts.map((p, k) => (
    <instancedMesh key={k + ':' + items.length} ref={(r) => { refs.current[k] = r; }} args={[p.geometry, p.material, Math.max(1, items.length)]} castShadow receiveShadow onClick={onClick} />
  ))}</>;
}

export function Walls({ apt }: { apt: ApartmentLayout }) {
  const gl = useGLTF([...BACK_WALL, ...LEFT_WALL].map(URL)) as unknown as { scene: THREE.Group }[];
  const fin = wallById(apt.wall);
  const built = useMemo(() => {
    const groups = new Map<string, THREE.BufferGeometry[]>(); const mats = new Map<string, THREE.MeshStandardMaterial>();
    const add = (o: THREE.Object3D, side: 'back' | 'left') => { o.updateMatrixWorld(true); o.traverse((c) => {
      const m = c as THREE.Mesh; if (!m.isMesh) return; const mat = m.material as THREE.MeshStandardMaterial;
      const key = mat.name === '_defaultMat' ? 'paint_' + side : mat.name; mats.set(key, mat);
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(m.geometry.clone().applyMatrix4(m.matrixWorld)); }); };
    BACK_WALL.forEach((name, i) => { const o = gl[i].scene.clone(true); o.scale.setScalar(S); o.position.set(i * TILE, 0, 0); add(o, 'back'); });
    LEFT_WALL.forEach((name, i) => { const o = gl[BACK_WALL.length + i].scene.clone(true); o.scale.setScalar(S); o.rotation.y = Math.PI / 2; o.position.set(0, 0, (i + 1) * TILE); add(o, 'left'); });
    const out: { key: string; geo: THREE.BufferGeometry; src: THREE.MeshStandardMaterial }[] = [];
    groups.forEach((gs, key) => out.push({ key, src: mats.get(key)!, geo: mergeSimple(gs, key.startsWith('paint') ? (p) => (key === 'paint_back' ? [p.x / 1.2, p.y / 1.2] : [p.z / 1.2, p.y / 1.2]) : undefined) }));
    return out;
  }, [gl]);
  useEffect(() => () => { built.forEach((b) => b.geo.dispose()); }, [built]);
  const tex = fin.kind === 'paint' ? null : wallTexture(fin);
  return <>{built.map(({ key, geo, src }) => (
    <mesh key={key} geometry={geo} castShadow receiveShadow>
      {key.startsWith('paint')
        ? <meshLambertMaterial key={fin.id} map={tex} color={tex ? '#ffffff' : key === 'paint_back' ? fin.a : fin.b} />
        : key === 'glass' ? <meshLambertMaterial color="#cde9ff" emissive="#a9d6ff" emissiveIntensity={0.55} transparent opacity={0.92} />
        : <meshLambertMaterial color={'#' + src.color.getHexString()} transparent={src.transparent} opacity={src.opacity} />}
    </mesh>
  ))}</>;
}

export function Floor({ apt }: { apt: ApartmentLayout }) {
  const W = apt.cols * CELL, D = apt.rows * CELL; const fin = floorById(apt.floor);
  const tex = useMemo(() => { const t = floorTexture(fin); t.repeat.set(W / 2.4, D / 2.4); t.needsUpdate = true; return t; }, [fin, W, D]);
  const placing = useStore(game.store, (s) => !!s.placing);
  const lastTap = useRef(newTapMemo());
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return;
    if (game.s.placing) { game.ghostAt(e.point.x, e.point.z); return; }
    if (game.s.mode === 'edit') { game.store.set({ selItem: null }); return; }
    e.stopPropagation();
    const dbl = registerTap(lastTap.current, performance.now(), e.point.x, e.point.z, e.nativeEvent?.detail ?? 0); // timing, or the browser's own click count
    onFloorTap(e.point.clone(), dbl);
  };
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[W / 2, 0, D / 2]} receiveShadow onClick={onClick} onPointerMove={placing ? (e) => game.ghostAt(e.point.x, e.point.z) : undefined}>
        <planeGeometry args={[W, D]} /><meshLambertMaterial map={tex} />
      </mesh>
      <mesh position={[W / 2, -0.066, D / 2]}><boxGeometry args={[W + 0.12, 0.12, D + 0.12]} /><meshLambertMaterial color="#7a5a8c" /></mesh>
      <mesh position={[W / 2, 0.04, 0.012]}><boxGeometry args={[W, 0.08, 0.02]} /><meshLambertMaterial color="#fff4ea" /></mesh>
      <mesh position={[0.012, 0.04, D / 2]}><boxGeometry args={[0.02, 0.08, D]} /><meshLambertMaterial color="#fff4ea" /></mesh>
      {placing && <GridOverlay W={W} D={D} />}
      <TapMarker />
    </group>
  );
}
function GridOverlay({ W, D }: { W: number; D: number }) {
  const geo = useMemo(() => {
    const v: number[] = [];
    for (let x = 0; x <= W + 1e-6; x += CELL) v.push(x, 0, 0, x, 0, D);
    for (let z = 0; z <= D + 1e-6; z += CELL) v.push(0, 0, z, W, 0, z);
    return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  }, [W, D]);
  useDispose(geo);
  return <lineSegments geometry={geo} position-y={0.004}><lineBasicMaterial color="#ffffff" transparent opacity={0.22} /></lineSegments>;
}
export { TapMarker } from '../TapMarker';

/** Lamps, TV screens, music notes: per-item live effects driven by `item.on`. */
function ItemEffects({ apt }: { apt: ApartmentLayout }) {
  const lamps = apt.items.filter((i) => FURNITURE[i.defId].light && i.on).slice(0, Q.pointLights);
  const tvs = apt.items.filter((i) => FURNITURE[i.defId].interaction === 'tv' && i.on);
  const music = apt.items.filter((i) => FURNITURE[i.defId].interaction === 'music' && i.on);
  return (
    <>
      {lamps.map((it) => { const d = FURNITURE[it.defId], t = itemTransform(it, FURNITURE), y = baseHeight(apt, FURNITURE, it) + d.light!.y;
        return <group key={it.uid} position={[t.x, y, t.z]}>
          <pointLight color={d.light!.color} intensity={d.light!.intensity} distance={d.light!.distance} decay={1.6} />
          <mesh><sphereGeometry args={[0.07, 12, 8]} /><meshBasicMaterial color="#fff1c9" transparent opacity={0.85} /></mesh>
        </group>; })}
      {tvs.map((it) => <TvScreen key={it.uid} it={it} apt={apt} />)}
      {music.map((it) => { const t = itemTransform(it, FURNITURE); return <Html key={it.uid} position={[t.x, baseHeight(apt, FURNITURE, it) + FURNITURE[it.defId].size.h + 0.15, t.z]} center style={{ pointerEvents: 'none' }}><div className="notes">♪ ♫</div></Html>; })}
    </>
  );
}
function TvScreen({ it, apt }: { it: PlacedItem; apt: ApartmentLayout }) {
  const d = FURNITURE[it.defId], t = itemTransform(it, FURNITURE); const mat = useRef<THREE.MeshBasicMaterial>(null!); const light = useRef<THREE.PointLight>(null!);
  useFrame(({ clock }) => { const h = (clock.elapsedTime * 0.08) % 1; mat.current.color.setHSL(h, 0.55, 0.62); light.current.color.copy(mat.current.color); light.current.intensity = 0.9 + Math.sin(clock.elapsedTime * 7) * 0.15; });
  return (
    <group position={[t.x, baseHeight(apt, FURNITURE, it), t.z]} rotation-y={t.yaw}>
      <mesh position={[0, d.size.h * 0.58, d.size.d / 2 - 0.035]}><planeGeometry args={[d.size.w * 0.86, d.size.h * 0.6]} /><meshBasicMaterial ref={mat} toneMapped={false} /></mesh>
      <pointLight ref={light} position={[0, d.size.h * 0.6, 0.5]} distance={2.5} decay={1.5} />
    </group>
  );
}

/** Edit-mode visuals: ghost of the item being placed + footprint of the selection. */
function EditOverlay({ apt }: { apt: ApartmentLayout }) {
  const placing = useStore(game.store, (s) => s.placing); const sel = useStore(game.store, (s) => s.selItem); const mode = useStore(game.store, (s) => s.mode);
  const selIt = sel ? apt.items.find((i) => i.uid === sel) : undefined;
  return (
    <>
      {placing && <Ghost key={placing.defId} apt={apt} />}
      {mode === 'edit' && selIt && !placing && <Footprint it={selIt} color="#ffffff" />}
    </>
  );
}
function Footprint({ it, color }: { it: Pick<PlacedItem, 'defId' | 'x' | 'z' | 'rot'>; color: string }) {
  const f = footprint(it, FURNITURE);
  return <mesh rotation-x={-Math.PI / 2} position={[(f.x + f.w / 2) * CELL, 0.012, (f.z + f.d / 2) * CELL]}><planeGeometry args={[f.w * CELL, f.d * CELL]} /><meshBasicMaterial color={color} transparent opacity={0.55} depthWrite={false} /></mesh>;
}
function Ghost({ apt }: { apt: ApartmentLayout }) {
  const placing = useStore(game.store, (s) => s.placing)!; const parts = useParts(placing.defId);
  const ok = placing.valid.ok; const mat = useMemo(() => new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.6, depthWrite: false }), []);
  useDispose(mat);
  mat.color.set(ok ? '#9ff0b8' : '#ff8a8a');
  const pseudo = { ...placing, uid: placing.moving ?? '__ghost' } as PlacedItem;
  const t = itemTransform(pseudo, FURNITURE);
  const base = FURNITURE[placing.defId].layer === 'top' ? baseHeight({ ...apt, items: apt.items.filter((i) => i.uid !== placing.moving) }, FURNITURE, pseudo) : 0;
  return (
    <>
      <group position={[t.x, base + 0.01, t.z]} rotation-y={t.yaw}>{parts.map((p, k) => <mesh key={k} geometry={p.geometry} material={mat} renderOrder={5} />)}</group>
      <Footprint it={placing} color={ok ? '#36d07a' : '#ff4d4d'} />
    </>
  );
}

export function ApartmentView() {
  const apt = useStore(game.store, (s) => s.apartment); const placing = useStore(game.store, (s) => s.placing); const menu = useStore(game.store, (s) => s.menuItem);
  const batches = useMemo(() => {
    if (!apt) return [];
    const by = new Map<string, PlacedItem[]>();
    const skip = new Set(placing?.moving ? [placing.moving, ...childrenOf(apt, FURNITURE, placing.moving).map((k) => k.uid)] : []);
    for (const it of apt.items) { if (skip.has(it.uid)) continue; (by.get(it.defId) ?? by.set(it.defId, []).get(it.defId)!).push(it); }
    return [...by.entries()];
  }, [apt, placing?.moving]);
  if (!apt) return null;
  const menuIt = menu ? apt.items.find((i) => i.uid === menu) : undefined;
  return (
    <group>
      <Floor apt={apt} />
      <Walls apt={apt} />
      <Decor apt={apt} />
      {batches.map(([defId, items]) => <FurnitureBatch key={defId} defId={defId} items={items} apt={apt} />)}
      <ItemEffects apt={apt} />
      <EditOverlay apt={apt} />
      {menuIt && <InteractionMenu it={menuIt} apt={apt} />}
    </group>
  );
}
