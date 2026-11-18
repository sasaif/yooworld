import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { ANIM_LIBRARY, type AvatarDef, type ClipKey } from '../data/avatars';
import { LOCO, stepMover } from '../game/character/locomotion';
import type { CharState } from '../game/world';
import { buildAvatar } from './avatar/AvatarModel';

useGLTF.preload(ANIM_LIBRARY);

export function Character({ c, def, selected, onSelect }: { c: CharState; def: AvatarDef; selected: boolean; onSelect: () => void }) {
  const body = useGLTF(def.url); const lib = useGLTF(ANIM_LIBRARY);
  const outer = useRef<THREE.Group>(null!); const tag = useRef<THREE.Group>(null!); const bubble = useRef<HTMLDivElement>(null);
  const built = useMemo(() => buildAvatar(body, lib, def), [body, lib, def]);
  built.holder.userData.avatarId = def.id; // read by Stats.__metrics
  const cur = useRef<ClipKey>('idle');
  const play = (k: ClipKey, fade = 0.25) => {
    if (cur.current === k) return; const prev = built.actions[cur.current]; const next = built.actions[k];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play(); prev.fadeOut(fade); cur.current = k;
  };
  useEffect(() => { built.actions.idle.play(); return () => { built.mixer.stopAllAction(); }; }, [built]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05); const s = c;
    if (s.mode === 'standing') {
      play('stand', 0.15);
      const a = built.actions.stand;
      if (a.time >= a.getClip().duration - 0.05) { if (s.sitOn) s.pos.copy(s.sitOn.front).setY(0); s.sitOn = undefined; s.mode = s.path.length ? 'walk' : 'idle'; }
    } else if (s.mode !== 'sitting') {
      const moving = stepMover(s, dt);
      if (moving) {
        s.mode = 'walk';
        const run = s.speed > (LOCO.walk + LOCO.run) / 2;
        play(run ? 'run' : 'walk', 0.2);
        built.actions[run ? 'run' : 'walk'].timeScale = THREE.MathUtils.clamp(s.speed / (run ? LOCO.run : LOCO.walk), 0.45, 1.3);
      } else if (s.pendingSeat) {
        const seat = s.pendingSeat; s.pendingSeat = undefined; s.sitOn = seat; s.mode = 'sitting'; s.yaw = seat.yaw;
        const fwd = new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
        s.pos.copy(seat.pos).addScaledVector(fwd, def.sitForward); s.pos.y = 0.04;
        play('sit', 0.25);
      } else { s.mode = s.emote ? 'emote' : 'idle'; play(s.emote ? 'emote' : 'idle', 0.3); }
    }
    built.mixer.update(dt);
    outer.current.position.copy(s.pos); outer.current.rotation.y = s.yaw;
    tag.current.position.y += ((s.mode === 'sitting' ? 0.86 : 1.12) - tag.current.position.y) * Math.min(1, dt * 6);
    if (bubble.current) { const on = !!s.say && s.say.until > performance.now(); bubble.current.style.opacity = on ? '1' : '0'; if (on) bubble.current.textContent = s.say!.text; }
  });

  return (
    <group ref={outer} onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); onSelect(); }}>
      <primitive object={built.holder} />
      {/* soft blob shadow: cheap contact shadow that also works when real shadows are off (mobile) */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.006} renderOrder={-1}><circleGeometry args={[0.2, 24]} /><meshBasicMaterial color="#2a1530" transparent opacity={0.22} depthWrite={false} /></mesh>
      {selected && <mesh rotation-x={-Math.PI / 2} position-y={0.012}><ringGeometry args={[0.24, 0.29, 40]} /><meshBasicMaterial color={def.tagColor} transparent opacity={0.85} depthWrite={false} /></mesh>}
      <group ref={tag} position-y={1.12}>
        <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tagwrap">
            <div ref={bubble} className="bubble" />
            <div className="nametag" style={{ background: def.tagColor }}>{c.name}</div>
          </div>
        </Html>
      </group>
    </group>
  );
}
