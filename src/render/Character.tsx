import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Html, useGLTF } from '@react-three/drei';
import { ANIM_LIBRARY, type AvatarDef, type ClipKey } from '../data/avatars';
import type { Look } from '../fashion/types';
import { useCustomAvatar } from './avatar/custom/useCustomAvatar';
import { LOCO, stepMoverSub } from '../game/character/locomotion';
import { locoBlend } from '../game/movement/animBlend';
import { driveCharacter } from '../game/movement/playerMotion';
import { world } from '../game/world';
import type { CharState } from '../game/world';
import { FaceAnimator, morphIndex } from './avatar/face';

useGLTF.preload(ANIM_LIBRARY);

const LOCO_KEYS = ['idle', 'walk', 'run'] as const;
type LocoKey = typeof LOCO_KEYS[number];
const camDir = new THREE.Vector3();
const sitFwd = new THREE.Vector3();
/** Debug / e2e: last locomotion blend of each avatar (weights + playback rates). */
export const animDebug: Record<string, { speed: number; idle: number; walk: number; run: number; walkTS: number; runTS: number; clip: string }> = {};

/** `controlled` = this is the player's avatar: the analog stick / keyboard may drive it. */
export function Character({ c, def, look, selected, onSelect, controlled = false }: { c: CharState; def: AvatarDef; look: Look; selected: boolean; onSelect: () => void; controlled?: boolean }) {
  const outer = useRef<THREE.Group>(null!); const tag = useRef<THREE.Group>(null!); const bubble = useRef<HTMLDivElement>(null);
  const built = useCustomAvatar(def, look);
  built.holder.userData.avatarId = def.id; // read by Stats.__metrics
  const face = useMemo(() => ({ anim: new FaceAnimator(), idx: built.faces.map((m) => morphIndex(m.morphTargetDictionary!)) }), [built]);
  const dance = useRef(0);
  // 'loco' = idle/walk/run blended by the actual ground speed; other clips (sit, stand, emote) cross-fade as before
  const cur = useRef<ClipKey | 'loco'>('idle');
  const lw = useRef<Record<LocoKey, number>>({ idle: 1, walk: 0, run: 0 });
  const play = (k: ClipKey, fade = 0.25) => {
    if (cur.current === k) return; const next = built.actions[k];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (cur.current === 'loco') for (const lk of LOCO_KEYS) built.actions[lk].fadeOut(fade); else built.actions[cur.current].fadeOut(fade);
    cur.current = k;
  };
  const loco = (speed: number, dt: number) => {
    if (cur.current !== 'loco') {
      const prev = cur.current; const w = lw.current;
      if (prev === 'idle' || prev === 'walk' || prev === 'run') { for (const lk of LOCO_KEYS) w[lk] = lk === prev ? built.actions[lk].getEffectiveWeight() : 0; }
      else { built.actions[prev].fadeOut(0.25); for (const lk of LOCO_KEYS) w[lk] = 0; }
      for (const lk of LOCO_KEYS) { const a = built.actions[lk]; a.stopFading(); if (!a.enabled || !a.isRunning()) a.reset().play(); a.setEffectiveWeight(w[lk]); }
      cur.current = 'loco';
    }
    const vW = LOCO.walk * def.scale, vR = LOCO.run * def.scale; // stride grows with the avatar scale
    const b = locoBlend(speed, vW, vR); const k = 1 - Math.exp(-dt * 10); const w = lw.current;
    w.idle += (b.idle - w.idle) * k; w.walk += (b.walk - w.walk) * k; w.run += (b.run - w.run) * k;
    const A = built.actions;
    A.idle.setEffectiveWeight(w.idle); A.walk.setEffectiveWeight(w.walk); A.run.setEffectiveWeight(w.run);
    // playback rate = actual speed / the clip's natural speed (never faster than the body moves)
    A.walk.timeScale = b.walkTS; A.run.timeScale = b.runTS;
    animDebug[c.id] = { speed, idle: w.idle, walk: w.walk, run: w.run, walkTS: b.walkTS, runTS: b.runTS, clip: 'loco' };
  };
  useEffect(() => { built.actions.idle.play(); cur.current = 'idle'; return () => { built.mixer.stopAllAction(); }; }, [built]);

  useFrame((state, dtRaw) => {
    // same frame-time clamp as the analog controller (0.25 s): on a slow device (< 20 fps) the clips and the tap-to-move
    // walk used to be clamped to 0.05 s per frame, i.e. they ran slower than real time (at 5 fps: 25 % speed, feet sliding
    // behind the joystick-driven body). Tap-to-move is sub-stepped at ≤ 0.05 s so its path following is unchanged.
    const dt = Math.min(Math.max(dtRaw, 0), 0.25); const s = c;
    // analog stick / keyboard (player's avatar only): may stand the avatar up, then drives it
    let driven = false;
    if (controlled) { state.camera.getWorldDirection(camDir); driven = driveCharacter(s, dtRaw, camDir, world.nav); } // the controller clamps dt itself
    if (s.mode === 'standing') {
      play('stand', 0.15);
      const a = built.actions.stand;
      if (a.time >= a.getClip().duration - 0.05) { if (s.sitOn) s.pos.copy(s.sitOn.front).setY(0); s.sitOn = undefined; s.mode = s.path.length ? 'walk' : 'idle'; }
    } else if (s.mode !== 'sitting') {
      const moving = driven ? s.speed > 0.005 : stepMoverSub(s, dt);
      if (moving) {
        s.mode = 'walk';
        loco(s.speed, dt);
      } else if (!driven && s.pendingSeat) {
        const seat = s.pendingSeat; s.pendingSeat = undefined; s.sitOn = seat; s.mode = 'sitting'; s.yaw = seat.yaw;
        sitFwd.set(Math.sin(seat.yaw), 0, Math.cos(seat.yaw));
        s.pos.copy(seat.pos).addScaledVector(sitFwd, def.sitForward * def.scale); s.pos.y = 0.04 - (def.scale - 1) * 0.22; // hips stay on the cushion
        play('sit', 0.25);
      } else {
        if (s.pendingEmote) { s.pendingEmote = false; s.emote = true; } s.mode = s.emote ? 'emote' : 'idle';
        if (s.emote) play('emote', 0.3); else loco(0, dt);
      }
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
            <div className="nametag" style={{ background: def.tagColor }}>{c.name}{!controlled && <span className="npc" title="Personnage local de test (pas un joueur en ligne)">PNJ</span>}</div>
          </div>
        </Html>
      </group>
    </group>
  );
}
