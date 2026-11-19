import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { useStore } from '../../core/store';
import { club } from '../../app/clubService';
import { AVATARS, type AvatarDef } from '../../data/avatars';
import { BOT_TAG } from '../../game/club/botAvatars';
import { clubItemPos } from '../../game/club/clubLayout';
import type { ClubBot } from '../../game/club/ClubController';
import { world } from '../../game/world';
import { Character } from '../Character';

/**
 * Bot players of the club table: ordinary YooWorld avatars (same bodies, looks from the catalogue, same sit / stand
 * transitions as the player) seated on their chairs, with a normal name tag + "🤖" chip instead of a floating label.
 * Budget (club ≤ 40 draw calls, < 100k triangles with 3 bots): bots are `lite` avatars (no outline hull, no blob shadow,
 * no shadow-map pass) and wear no hair-tie / accessory meshes (game/club/botAvatars.ts): 2 calls, ~11k triangles each. The gold turn ring is a single mesh moved to the active seat's chair.
 */
const noop = () => {};
function Bot({ b }: { b: ClubBot }) {
  const def = useMemo<AvatarDef>(() => ({ ...AVATARS[b.look.body], id: b.id, tagColor: BOT_TAG }), [b.id, b.look.body]);
  const c = world.chars[b.id]; if (!c) return null;
  return <Character c={c} def={def} look={b.look} selected={false} onSelect={noop} npcLabel="🤖" lite tagClass="bot" />;
}
function TurnRing() {
  useStore(club.store, (s) => s.tick); const ses = useStore(club.store, (s) => s.session);
  const ref = useRef<THREE.Mesh>(null); const mat = useRef<THREE.MeshBasicMaterial>(null);
  const st = ses?.host.state; const turn = ses && ses.phase === 'playing' && st?.phase === 'playing' ? st.turn : null;
  const chair = turn !== null && ses ? ses.seatChairs[turn] : null; const p = chair ? clubItemPos(chair) : null;
  useFrame(() => { if (mat.current) mat.current.opacity = 0.55 + 0.35 * Math.sin(performance.now() / 220); });
  if (!p) return null;
  return (
    <mesh ref={ref} position={[p.x, 0.014, p.z]} rotation-x={-Math.PI / 2} raycast={noop} renderOrder={1} userData={{ clubTurnSeat: turn }}>
      <ringGeometry args={[0.31, 0.38, 40]} />
      <meshBasicMaterial ref={mat} color={turn === 0 ? '#ffc857' : '#ffe08a'} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}
export function ClubBots() {
  const bots = useStore(club.store, (s) => s.bots);
  return <>{bots.map((b) => <Bot key={b.id} b={b} />)}<TurnRing /></>;
}
