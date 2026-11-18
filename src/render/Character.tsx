import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { ANIM_LIBRARY, type AvatarDef, type ClipKey } from '../data/avatars';
import type { Look } from '../fashion/types';
import { useCustomAvatar } from './avatar/custom/useCustomAvatar';
import { LOCO, stepMover } from '../game/character/locomotion';
import type { CharState } from '../game/world';
import { FaceAnimator, morphIndex } from './avatar/face';

useGLTF.preload(ANIM_LIBRARY);

export function Character({ c, def, look, selected, onSelect }: { c: CharState; def: AvatarDef; look: Look; selected: boolean; onSelect: () => void }) {
  const outer = useRef<THREE.Group>(null!); const tag = useRef<THREE.Group>(null!); const bubble = useRef<HTMLDivElement>(null);
  const built = useCustomAvatar(def, look);
  built.holder.userData.avatarId = def.id; // read by Stats.__metrics
  const face = useMemo(() => ({ anim: new FaceAnimator(), idx: built.faces.map((m) => morphIndex(m.morphTargetDictionary!)) }), [built]);
  const dance = useRef(0);
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
        // stride grows with the avatar scale: play the cycle slower so feet don't slide
        built.actions[run ? 'run' : 'walk'].timeScale = THREE.MathUtils.clamp(s.speed / ((run ? LOCO.run : LOCO.walk) * def.scale), 0.45, 1.3);
      } else if (s.pendingSeat) {
        const seat = s.pendingSeat; s.pendingSeat = undefined; s.sitOn = seat; s.mode = 'sitting'; s.yaw = seat.yaw;
        const fwd = new THREE.Vector3(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
        s.pos.copy(seat.pos).addScaledVector(fwd, def.sitForward * def.scale); s.pos.y = 0.04 - (def.scale - 1) * 0.22; // hips stay on the cushion
        play('sit', 0.25);
      } else { if (s.pendingEmote) { s.pendingEmote = false; s.emote = true; } s.mode = s.emote ? 'emote' : 'idle'; play(s.emote ? 'emote' : 'idle', 0.3); }
    }
    built.mixer.update(dt);
    // face: blink, smile, grin while dancing, lip flap while a bubble is shown
    const talking = !!s.say && s.say.until > performance.now();
    const w = face.anim.update(dt, { emote: s.mode === 'emote', talking, sitting: s.mode === 'sitting', walking: s.mode === 'walk' });
    built.faces.forEach((m, i) => { const ix = face.idx[i]; for (const k in w) { const j = ix[k as keyof typeof w]; if (j !== undefined) m.morphTargetInfluences![j] = w[k as keyof typeof w]; } });
    // dance groove on top of the cheer clip: bounce on the beat, hip sway, body twist (eased in/out)
    dance.current += ((s.mode === 'emote' ? 1 : 0) - dance.current) * Math.min(1, dt * 5);
    const t = performance.now() / 1000, beat = t * Math.PI * 2 * 1.05, k = dance.current;
    built.holder.position.y = Math.abs(Math.sin(beat)) * 0.035 * k;
    built.holder.rotation.z = Math.sin(beat) * 0.07 * k;
    built.holder.rotation.y = (def.facing === 'negZ' ? Math.PI : 0) + Math.sin(beat / 2) * 0.35 * k;
    outer.current.position.copy(s.pos); outer.current.rotation.y = s.yaw;
    tag.current.position.y += ((s.mode === 'sitting' ? 0.95 : 1.14) - tag.current.position.y) * Math.min(1, dt * 6);
    if (bubble.current) { const on = !!s.say && s.say.until > performance.now(); bubble.current.style.opacity = on ? '1' : '0'; if (on) bubble.current.textContent = s.say!.text; }
  });

  return (
    <group ref={outer} scale={def.scale} onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); onSelect(); }}>
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
