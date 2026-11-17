import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { clone as skeletonClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { MIXAMO, QUATERNIUS_23 } from './avatar/boneMaps';
import { retargetClip } from './avatar/retarget';
import { world, type CharState } from './world';

export const Q23 = '/models/anim/QACP_Casual_Female_23bones.glb';
useGLTF.preload(Q23);
const WALK_SPEED = 0.85; // m/s, matched by eye to the retargeted stride at Juanita scale
const CLIPS = { idle: 'Idle', walk: 'Walk', sit: 'SitDown', stand: 'StandUp', emote: 'Victory' } as const;
type Key = keyof typeof CLIPS;

function inPlace(clip: THREE.AnimationClip) {
  // remove horizontal root motion (movement is driven by the click-to-walk controller)
  clip.tracks.forEach((t) => {
    if (!t.name.endsWith('.position')) return;
    const v = t.values; const x0 = v[0], z0 = v[2];
    for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
  });
  return clip;
}

export function Character({ c, url, tagColor, selected, onSelect }: { c: CharState; url: string; tagColor: string; selected: boolean; onSelect: () => void }) {
  const body = useGLTF(url); const q23 = useGLTF(Q23);
  const outer = useRef<THREE.Group>(null!);
  const bubble = useRef<HTMLDivElement>(null);
  const tag = useRef<THREE.Group>(null!);
  const built = useMemo(() => {
    const root = skeletonClone(body.scene) as THREE.Group;
    root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh) return;
      m.castShadow = true; m.frustumCulled = false;
      const mat = (m.material as THREE.MeshBasicMaterial).clone(); mat.color.multiply(new THREE.Color('#fff2e8')); m.material = mat;
    });
    const holder = new THREE.Group(); holder.rotation.y = Math.PI; holder.add(root); // VRM0 faces -Z
    const mixer = new THREE.AnimationMixer(root);
    const actions = {} as Record<Key, THREE.AnimationAction>;
    (Object.keys(CLIPS) as Key[]).forEach((k) => {
      const src = q23.animations.find((a) => a.name === CLIPS[k])!;
      let { clip } = retargetClip(skeletonClone(q23.scene), src, QUATERNIUS_23, skeletonClone(body.scene), MIXAMO, { name: k });
      if (k === 'idle' || k === 'walk' || k === 'emote') clip = inPlace(clip);
      const a = mixer.clipAction(clip);
      if (k === 'sit' || k === 'stand') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      actions[k] = a;
    });
    return { holder, mixer, actions };
  }, [body, q23]);

  const cur = useRef<Key>('idle');
  const play = (k: Key, fade = 0.25) => {
    if (cur.current === k) return; const prev = built.actions[cur.current]; const next = built.actions[k];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play(); prev.fadeOut(fade); cur.current = k;
  };
  useEffect(() => { built.actions.idle.play(); return () => { built.mixer.stopAllAction(); }; }, [built]);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const s = c; const fwd = new THREE.Vector3();
    if (s.mode === 'standing') {
      play('stand', 0.15);
      if (built.actions.stand.time >= built.actions.stand.getClip().duration - 0.05) { if (s.sitOn) s.pos.copy(s.sitOn.front).setY(0); s.sitOn = undefined; s.mode = 'idle'; }
    } else if (s.mode !== 'sitting' && s.path.length) {
      s.mode = 'walk'; play('walk');
      const tgt = s.path[0]; const d = tgt.clone().sub(s.pos).setY(0); const dist = d.length();
      if (dist < 0.03) s.path.shift();
      else {
        const step = Math.min(dist, WALK_SPEED * dt); s.pos.addScaledVector(d.normalize(), step);
        const want = Math.atan2(d.x, d.z); let dy = want - s.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); s.yaw += dy * Math.min(1, dt * 10);
      }
      if (!s.path.length && s.pendingSeat) {
        const seat = s.pendingSeat; s.pendingSeat = undefined; s.sitOn = seat; s.mode = 'sitting'; s.yaw = seat.yaw;
        fwd.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw)); s.pos.copy(seat.pos).addScaledVector(fwd, SIT_FWD); s.pos.y = SIT_Y;
        play('sit', 0.2);
      } else if (!s.path.length) s.mode = 'idle';
    } else if (s.mode === 'walk' || s.mode === 'idle') { s.mode = s.emote ? 'emote' : 'idle'; }
    if (s.mode === 'idle') play(s.emote ? 'emote' : 'idle');
    if (s.mode === 'emote') { play(s.emote ? 'emote' : 'idle'); if (!s.emote) s.mode = 'idle'; }
    built.mixer.update(dt);
    outer.current.position.copy(s.pos); outer.current.rotation.y = s.yaw;
    tag.current.position.y += ((s.mode === 'sitting' ? 0.86 : 1.12) - tag.current.position.y) * Math.min(1, dt * 6);
    if (bubble.current) { const on = !!s.say && s.say.until > performance.now(); bubble.current.style.opacity = on ? '1' : '0'; if (on) bubble.current.textContent = s.say!.text; }
  });

  return (
    <group ref={outer} onPointerDown={(e) => { e.stopPropagation(); onSelect(); }}>
      <primitive object={built.holder} />
      {selected && <mesh rotation-x={-Math.PI / 2} position-y={0.01}><ringGeometry args={[0.24, 0.29, 40]} /><meshBasicMaterial color={tagColor} transparent opacity={0.85} /></mesh>}
      <group ref={tag} position-y={1.12}><Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, transform: 'translateY(-14px)' }}>
          <div ref={bubble} style={{ opacity: 0, transition: 'opacity .2s', background: '#fff', color: '#2a2440', padding: '5px 10px', borderRadius: 12, fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,.25)' }} />
          <div style={{ background: tagColor, color: '#fff', padding: '2px 8px', borderRadius: 10, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', textShadow: '0 1px 1px rgba(0,0,0,.3)' }}>{c.name}</div>
        </div>
      </Html></group>
    </group>
  );
}
export const SIT_FWD = 0.15;
export const SIT_Y = 0.05;
