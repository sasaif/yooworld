import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Html, useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore } from '../../core/store';
import { club, game } from '../../app/services';
import { FURNITURE } from '../../data/furniture';
import { baseHeight, itemTransform, type PlacedItem } from '../../game/apartment/ApartmentModel';
import { CLUB, CLUB_TABLES, clubItemPos, tableOf } from '../../game/club/clubLayout';
import { gameById, LOCAL_BADGE } from '../../minigames/registry';
import { Floor, Walls } from '../apartment/ApartmentView';
import { flattenModel, type Part } from '../apartment/furnitureParts';
import { disposeMesh } from '../dispose';

/**
 * Yoo Games Club scene: the apartment's floor + wall kit, Kenney tables/chairs drawn as InstancedMesh (1 call per
 * material part, whatever the number of copies), and a small procedural decor batch (felt table tops, club sign,
 * game posters, domino tiles on the playing table). Bots have no avatar: a "🤖 Bot n" tag over their chair (DOM, 0 draw call).
 */
const URL = (m: string) => `${import.meta.env.BASE_URL}models/furniture/${m}.glb`;
const noRay = () => {};

function Batch({ defId, items }: { defId: string; items: PlacedItem[] }) {
  const def = FURNITURE[defId]; const { scene } = useGLTF(URL(def.model));
  const parts: Part[] = useMemo(() => flattenModel(def.model, scene, def.tint), [scene, def]);
  const refs = useRef<(THREE.InstancedMesh | null)[]>([]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3();
    items.forEach((it, i) => { const t = itemTransform(it, FURNITURE); m.compose(pos.set(t.x, baseHeight(CLUB, FURNITURE, it), t.z), q.setFromAxisAngle(up, t.yaw), one); refs.current.forEach((im) => im?.setMatrixAt(i, m)); });
    refs.current.forEach((im) => { if (im) { im.count = items.length; im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); } });
  }, [items, parts]);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    if (e.delta > 8) return; e.stopPropagation();
    const it = items[e.instanceId ?? 0]; if (it && tableOf(it.uid)) game.store.set({ menuItem: game.s.menuItem === it.uid ? null : it.uid });
  };
  return <>{parts.map((p, k) => <instancedMesh key={k} ref={(r) => { refs.current[k] = r; }} args={[p.geometry, p.material, Math.max(1, items.length)]} castShadow receiveShadow onClick={onClick} />)}</>;
}

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
/** sign (top half) + three game posters (bottom half) in ONE texture → one draw call for all wall art */
function wallArtTexture() {
  return canvasTex(1024, 512, (g) => {
    const sg = g.createLinearGradient(0, 0, 1024, 0); sg.addColorStop(0, '#ff8ac2'); sg.addColorStop(0.5, '#ffc857'); sg.addColorStop(1, '#7fd0ff');
    g.fillStyle = '#2b2346'; g.fillRect(0, 0, 1024, 256); g.strokeStyle = sg; g.lineWidth = 14; g.strokeRect(10, 10, 1004, 236);
    g.fillStyle = sg; g.font = 'bold 112px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('YOO GAMES CLUB', 512, 112);
    g.fillStyle = '#ffe9f4'; g.font = 'bold 40px system-ui, sans-serif'; g.fillText('Dominos · Belote · Dames', 512, 200);
    const poster = (x: number, bg: string, title: string, draw: (cx: number, cy: number) => void) => {
      g.fillStyle = bg; g.fillRect(x + 8, 264, 325, 240); g.fillStyle = '#fff6ee'; g.font = 'bold 44px system-ui, sans-serif'; g.fillText(title, x + 170, 300); draw(x + 170, 410);
    };
    const tile = (cx: number, cy: number, a: number, b: number, rot = 0) => {
      g.save(); g.translate(cx, cy); g.rotate(rot); g.fillStyle = '#fffdf6'; g.strokeStyle = '#2b2346'; g.lineWidth = 4;
      g.beginPath(); g.roundRect(-34, -66, 68, 132, 12); g.fill(); g.stroke(); g.beginPath(); g.moveTo(-26, 0); g.lineTo(26, 0); g.stroke();
      const P: Record<number, [number, number][]> = { 0: [], 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
      g.fillStyle = '#2b2346'; for (const [v, oy] of [[a, -33], [b, 33]] as const) for (const [px, py] of P[v]) { g.beginPath(); g.arc(px * 15, oy + py * 15, 7, 0, 7); g.fill(); }
      g.restore();
    };
    poster(0, '#3f7d5c', 'DOMINOS', (cx, cy) => { tile(cx - 50, cy, 6, 6, -0.2); tile(cx + 50, cy, 6, 3, 0.25); });
    poster(341, '#9b3b5a', 'BELOTE', (cx, cy) => { g.font = 'bold 110px system-ui'; g.fillStyle = '#fff6ee'; g.fillText('♠♥', cx, cy); g.font = 'bold 30px system-ui'; g.fillText('bientôt', cx, cy + 75); });
    poster(682, '#4f5fa8', 'DAMES', (cx, cy) => { for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = (i + j) % 2 ? '#2b2346' : '#f6e7d0'; g.fillRect(cx - 80 + i * 40, cy - 85 + j * 40, 40, 40); } g.font = 'bold 30px system-ui'; g.fillStyle = '#fff6ee'; g.fillText('bientôt', cx, cy + 82); });
  });
}
function ClubDecor() {
  const built = useMemo(() => {
    const tex = wallArtTexture();
    const quad = (u0: number, v0: number, u1: number, v1: number, w: number, h: number, m: THREE.Matrix4) => {
      const p = new THREE.PlaneGeometry(w, h); const uv = p.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      p.applyMatrix4(m); return p;
    };
    const back = (x: number, y: number) => new THREE.Matrix4().makeTranslation(x, y, 0.08);
    const left = (z: number, y: number) => new THREE.Matrix4().makeTranslation(0.08, y, z).multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
    const art = mergeGeometries([
      quad(0, 0.5, 1, 1, 1.9, 0.475, back(2.45, 1.12)),          // club sign between the windows' tops
      quad(0, 0, 1 / 3, 0.5, 0.5, 0.37, left(3.2, 1.0)),          // posters on the left wall
      quad(1 / 3, 0, 2 / 3, 0.5, 0.5, 0.37, left(4.0, 1.0)),
      quad(2 / 3, 0, 1, 0.5, 0.5, 0.37, left(4.8, 1.0)),
    ])!;
    // green felt tops on the three coffee tables (one merged mesh)
    const felt = mergeGeometries(CLUB_TABLES.map((t) => { const p = clubItemPos(t.table); const g = new THREE.BoxGeometry(0.7, 0.012, 0.4); g.translate(p.x, FURNITURE.tableCoffee.size.h + 0.006, p.z); return g; }))!;
    return { tex, art, felt };
  }, []);
  useEffect(() => () => { built.tex.dispose(); built.art.dispose(); built.felt.dispose(); }, [built]);
  return (
    <group>
      <mesh geometry={built.art} raycast={noRay}><meshLambertMaterial map={built.tex} /></mesh>
      <mesh geometry={built.felt} receiveShadow raycast={noRay}><meshLambertMaterial color="#2f7a55" /></mesh>
      {/* corridor seen through the open doorway */}
      <mesh position={[5.4, 0.62, -0.09]} raycast={noRay}><planeGeometry args={[1.0, 1.3]} /><meshBasicMaterial color="#3d3360" /></mesh>
    </group>
  );
}
/** Small domino tiles on the felt of the playing table, mirroring the line in the overlay (1 InstancedMesh). */
function TableTiles() {
  useStore(club.store, (s) => s.tick); const ses = useStore(club.store, (s) => s.session);
  const inst = useMemo(() => { const m = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.014, 0.025), new THREE.MeshLambertMaterial({ color: '#fffdf6' }), 28); m.count = 0; m.raycast = noRay; m.castShadow = false; return m; }, []);
  useEffect(() => () => disposeMesh(inst), [inst]);
  const line = ses?.host.state.line ?? [];
  useLayoutEffect(() => {
    const p = clubItemPos('t_dominoes'); const y = FURNITURE.tableCoffee.size.h + 0.019; const mx = new THREE.Matrix4(); const q = new THREE.Quaternion(); const s = new THREE.Vector3(1, 1, 1);
    // snake the line over the felt: rows of up to 11 tiles, alternating direction
    line.forEach((t, i) => {
      const row = Math.floor(i / 11), k = i % 11, dir = row % 2 ? -1 : 1; const dbl = t.a === t.b;
      const x = p.x + dir * (k - 5) * 0.058, z = p.z - 0.1 + row * 0.075;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), dbl ? Math.PI / 2 : 0); mx.compose(new THREE.Vector3(x, y, z), q, s); inst.setMatrixAt(i, mx);
    });
    inst.count = line.length; inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere();
  }, [line, inst]);
  return <primitive object={inst} />;
}
function SeatTags() {
  useStore(club.store, (s) => s.tick); const ses = useStore(club.store, (s) => s.session); if (!ses || ses.phase === 'seating') return null;
  const st = ses.host.state; const turn = st.phase === 'playing' ? st.turn : -1;
  return <>{club.chairLabels().filter((l) => l.bot).map((l) => (
    <Html key={l.chair} position={[l.pos.x, 0.62, l.pos.z]} center zIndexRange={[30, 10]} style={{ pointerEvents: 'none' }}>
      <div className={'bot-tag' + (turn === l.seat ? ' turn' : '')} data-bot-seat={l.seat}>🤖 {l.name}<small>{st.hands[l.seat]?.length ?? 0}</small></div>
    </Html>
  ))}</>;
}
function ClubMenu({ uid }: { uid: string }) {
  const t = tableOf(uid); if (!t) return null; const g = gameById(t.gameId); const playable = g?.status === 'playable';
  const isChair = t.chairs.includes(uid); const p = clubItemPos(uid); const busy = !!club.s.session;
  return (
    <Html position={[p.x, 0.75, p.z]} center zIndexRange={[40, 20]}>
      <div className="imenu" onPointerDown={(e) => e.stopPropagation()}>
        <div className="imenu-title">{isChair ? 'Chaise' : t.name}{!playable && ' · bientôt'}</div>
        {playable && !busy && <button className="btn" data-act="play" onClick={() => club.act(uid, 'play')}>{g!.icon} Jouer aux {g!.name.toLowerCase()}</button>}
        {playable && <div className="imenu-note">{LOCAL_BADGE}</div>}
        {isChair && <button className="btn" onClick={() => club.act(uid, 'sit')}>🪑 S’asseoir</button>}
        {!playable && <button className="btn" onClick={() => club.act(uid, 'look')}>👀 Regarder</button>}
      </div>
    </Html>
  );
}
export function ClubView() {
  const menu = useStore(game.store, (s) => s.menuItem);
  const batches = useMemo(() => { const by = new Map<string, PlacedItem[]>(); for (const it of CLUB.items) (by.get(it.defId) ?? by.set(it.defId, []).get(it.defId)!).push(it); return [...by.entries()]; }, []);
  return (
    <group>
      <Floor apt={CLUB} />
      <Walls apt={CLUB} />
      <ClubDecor />
      {batches.map(([defId, items]) => <Batch key={defId} defId={defId} items={items} />)}
      <TableTiles />
      <pointLight position={[3.45, 1.35, 3.0]} color="#ffd08a" intensity={1.6} distance={3.2} decay={1.6} />
      <SeatTags />
      {menu && tableOf(menu) && <ClubMenu uid={menu} />}
    </group>
  );
}
