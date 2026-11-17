import { useLayoutEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useGLTF } from '@react-three/drei';
import { BACK_WALL, ITEMS, LEFT_WALL, NX, NZ, PALETTE, ROOM_D, ROOM_W, S, TILE, type Dir, type Item } from './layout';

const URL = (m: string) => `/models/furniture/${m}.glb`;
const ALL = Array.from(new Set([...ITEMS.map((i) => i.m), ...BACK_WALL, ...LEFT_WALL]));
ALL.forEach((m) => useGLTF.preload(URL(m)));
const YAW: Record<Dir, number> = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };

export interface Seat { id: string; pos: THREE.Vector3; yaw: number; height: number; front: THREE.Vector3 }
export interface RoomInfo { boxes: THREE.Box3[]; seats: Seat[] }

const matCache = new Map<string, THREE.Material>();
function warm(root: THREE.Object3D, wallTint?: string) {
  root.traverse((o) => {
    const m = o as THREE.Mesh; if (!m.isMesh) return;
    m.castShadow = true; m.receiveShadow = true;
    const src = m.material as THREE.MeshStandardMaterial; const key = (wallTint ?? '') + src.name;
    let mat = matCache.get(key) as THREE.MeshStandardMaterial | undefined;
    if (!mat) {
      mat = src.clone(); const c = wallTint && src.name === '_defaultMat' ? wallTint : PALETTE[src.name];
      if (c) mat.color.set(c); mat.roughness = 0.8; mat.metalness = 0; matCache.set(key, mat);
    }
    m.material = mat;
  });
}

function woodTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d')!;
  const rows = 8, h = 512 / rows;
  for (let r = 0; r < rows; r++) {
    let x = -((r * 173) % 300);
    while (x < 512) {
      const w = 220 + ((r * 97 + x) % 140); const l = 70 + ((r * 31 + x * 7) % 9);
      g.fillStyle = `hsl(28, 48%, ${l * 0.78}%)`; g.fillRect(x, r * h, w, h);
      g.strokeStyle = 'rgba(80,45,25,.35)'; g.lineWidth = 2; g.strokeRect(x + 1, r * h + 1, w - 2, h - 2);
      for (let k = 0; k < 6; k++) { g.strokeStyle = 'rgba(120,70,40,.08)'; g.beginPath(); const yy = r * h + 6 + k * (h - 12) / 5; g.moveTo(x, yy); g.bezierCurveTo(x + w / 3, yy + 3, x + 2 * w / 3, yy - 3, x + w, yy); g.stroke(); }
      x += w;
    }
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(ROOM_W / 2.4, ROOM_D / 2.4); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function Placed({ it, onBox }: { it: Item; onBox: (b: THREE.Box3, it: Item, g: THREE.Group) => void }) {
  const { scene } = useGLTF(URL(it.m));
  const g = useMemo(() => {
    const inner = scene.clone(true); warm(inner);
    inner.scale.setScalar(S);
    const box = new THREE.Box3().setFromObject(inner); const c = box.getCenter(new THREE.Vector3());
    inner.position.set(-c.x, -box.min.y, -c.z);
    const outer = new THREE.Group(); outer.add(inner);
    outer.position.set(it.x, it.y ?? 0, it.z); outer.rotation.y = YAW[it.face ?? 'S']; (outer.scale.x = it.sx ?? 1);
    return outer;
  }, [scene, it]);
  useLayoutEffect(() => { g.updateMatrixWorld(true); onBox(new THREE.Box3().setFromObject(g), it, g); }, [g]);
  return <primitive object={g} />;
}

function WallRow({ pieces, side, tint }: { pieces: string[]; side: 'back' | 'left'; tint: string }) {
  const gl = useGLTF(pieces.map(URL)) as unknown as { scene: THREE.Group }[];
  const objs = useMemo(() => pieces.map((_, i) => {
    const o = gl[i].scene.clone(true); warm(o, tint); o.scale.setScalar(S);
    if (side === 'back') o.position.set(i * TILE, 0, 0);
    else { o.rotation.y = Math.PI / 2; o.position.set(0, 0, (i + 1) * TILE); }
    return o;
  }), [gl]);
  return <>{objs.map((o, i) => <primitive key={i} object={o} />)}</>;
}

export function Room({ onReady, onFloor }: { onReady: (r: RoomInfo) => void; onFloor: (p: THREE.Vector3) => void }) {
  const tex = useMemo(woodTexture, []);
  const info = useMemo<RoomInfo>(() => ({ boxes: [], seats: [] }), []);
  let n = 0;
  const onBox = (b: THREE.Box3, it: Item, g: THREE.Group) => {
    if (!it.walk) info.boxes.push(b);
    if (it.seat) {
      const yaw = g.rotation.y; const fwd = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      const depth = Math.abs(fwd.x) > 0.5 ? b.max.x - b.min.x : b.max.z - b.min.z;
      const ctr = b.getCenter(new THREE.Vector3()).setY(0);
      info.seats.push({ id: it.id!, yaw, height: 0.27 * S, pos: ctr.clone().addScaledVector(fwd, depth * 0.08), front: ctr.clone().addScaledVector(fwd, depth / 2 + 0.25) });
    }
    if (++n === ITEMS.length) onReady(info);
  };
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[ROOM_W / 2, 0, ROOM_D / 2]} receiveShadow
        onPointerDown={(e) => { e.stopPropagation(); onFloor(e.point.clone()); }}>
        <planeGeometry args={[ROOM_W, ROOM_D]} />
        <meshStandardMaterial map={tex} roughness={0.75} />
      </mesh>
      {/* floor slab edge */}
      <mesh position={[ROOM_W / 2, -0.066, ROOM_D / 2]} receiveShadow><boxGeometry args={[ROOM_W + 0.12, 0.12, ROOM_D + 0.12]} /><meshStandardMaterial color="#7a5a8c" /></mesh>
      {/* skirting */}
      <mesh position={[ROOM_W / 2, 0.04, 0.012]}><boxGeometry args={[ROOM_W, 0.08, 0.02]} /><meshStandardMaterial color="#fff4ea" /></mesh>
      <mesh position={[0.012, 0.04, ROOM_D / 2]}><boxGeometry args={[0.02, 0.08, ROOM_D]} /><meshStandardMaterial color="#fff4ea" /></mesh>
      <WallRow pieces={BACK_WALL.slice(0, NX)} side="back" tint="#f6d6cf" />
      <WallRow pieces={LEFT_WALL.slice(0, NZ)} side="left" tint="#e7d8f3" />
      {ITEMS.map((it, i) => <Placed key={i} it={it} onBox={onBox} />)}
    </group>
  );
}
