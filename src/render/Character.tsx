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
import { LIE_PITCH, lieRoot, sitRoot } from '../game/interact/anchors';
import { SitPose } from './avatar/sitPose';
import { LOUNGER_ANCHOR } from '../data/interactionRegistry';
import { beginSeat, motionSeat, newSeatMotion, newSeatPose, presetOf, seatPose, smooth, stepSeat, type SeatPhase } from '../game/interact/seatMotion';

useGLTF.preload(ANIM_LIBRARY);

const LOCO_KEYS = ['idle', 'walk', 'run'] as const;
type LocoKey = typeof LOCO_KEYS[number];
const camDir = new THREE.Vector3(); const qCur = new THREE.Quaternion(), qLie = new THREE.Quaternion(), qInv = new THREE.Quaternion(); const eLie = new THREE.Euler(); const qLeg = new THREE.Quaternion();
const _hw = new THREE.Vector3(), _hl = new THREE.Vector3(), _lr = new THREE.Vector3(), _H = new THREE.Vector3();
const lieBlend = { legs: 0, body: 0, q: qCur, qLie: qLeg };
const SIT_IN = 0.5; // s: legacy seats (Yoo Plage loungers, SitDown clip)
/** Debug / e2e: last locomotion blend of each avatar (weights + playback rates). */
export const animDebug: Record<string, { speed: number; idle: number; walk: number; run: number; walkTS: number; runTS: number; clip: string }> = {};
/** Debug / e2e: seat transition state of each avatar (phase, progress, layer weight, lie tilt 0..1). */
export const seatDebug: Record<string, { phase: SeatPhase; sp: number; lp: number; w: number; pitch: number; seat: string | null }> = {};

/** `controlled` = this is the player's avatar: the analog stick / keyboard may drive it. */
export function Character({ c, def, look, selected, onSelect, controlled = false }: { c: CharState; def: AvatarDef; look: Look; selected: boolean; onSelect: () => void; controlled?: boolean }) {
  const outer = useRef<THREE.Group>(null!); const tag = useRef<THREE.Group>(null!); const bubble = useRef<HTMLDivElement>(null);
  const built = useCustomAvatar(def, look);
  built.holder.userData.avatarId = def.id; // read by Stats.__metrics
  const face = useMemo(() => ({ anim: new FaceAnimator(), idx: built.faces.map((m) => morphIndex(m.morphTargetDictionary!)) }), [built]);
  const dance = useRef(0);
  const blob = useRef<THREE.Mesh>(null); const ring = useRef<THREE.Mesh>(null);
  /** seat / bed blend: root goes from `from` to `to` (and the body tilts onto its back when lying), t in s */
  const pose = useRef({ from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 0, pitch: 0, bag: 1 });
  /** sit / lie / stand-up transitions (game/interact/seatMotion.ts) and their per-frame outputs */
  const M = useMemo(newSeatMotion, []); const SP = useMemo(newSeatPose, []);
  const dbg = useMemo(() => (seatDebug[c.id] = { phase: 'none' as SeatPhase, sp: 0, lp: 0, w: 0, pitch: 0, seat: null as string | null }), [c.id]);
  /** procedural seated pose layer on this avatar's skeleton (chairs, stools, sofas, bed edge) */
  const sit = useMemo(() => new SitPose(built.holder), [built]);
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
    const P = pose.current;
    if (M.phase !== 'none' && (s.mode === 'sitting' || s.mode === 'standing')) {
      // registry seats: turn round, sit down, (bed) lie back; standing up = the same curves backwards from wherever we are
      const free = stepSeat(M, dt, s.mode === 'standing'); const px = s.pos.x, pz = s.pos.z;
      seatPose(M, SP);
      // the last steps to the approach point are walked (feet move), the rest of the transition stands on idle
      loco(M.phase === 'turn' && dt > 0 ? Math.hypot(SP.root.x - px, SP.root.z - pz) / dt : 0, dt);
      if (free) { M.phase = 'none'; SP.sitW = 0; SP.pitch = 0; s.sitOn = undefined; s.mode = s.path.length ? 'walk' : 'idle'; }
      s.pos.copy(SP.root); s.yaw = SP.yaw;
      if (M.seat?.pose === 'lie' && SP.slide > 0) s.pos.lerp(M.seat.preset === 'lounger' ? _lr.copy(M.seat.hip!).setY(0) : lieRoot(M.seat, def.scale, _lr), SP.slide);
      P.pitch = (M.seat ? presetOf(M.seat).liePitch ?? LIE_PITCH : LIE_PITCH) * SP.pitch;
    } else if (s.mode === 'standing') {
      // legacy seats (Yoo Plage loungers): SitDown clip then StandUp clip
      play('stand', 0.15);
      const a = built.actions.stand; const k = Math.min(1, a.time / Math.max(0.01, a.getClip().duration - 0.05));
      if (s.pos.y !== 0) s.pos.y = P.to.y * (1 - smooth(k)); // come down with the stand-up clip
      if (a.time >= a.getClip().duration - 0.05) { if (s.sitOn) s.pos.copy(s.sitOn.front).setY(0); s.sitOn = undefined; s.mode = s.path.length ? 'walk' : 'idle'; }
    } else if (s.mode === 'sitting') {
      if (P.t < P.dur) { P.t += dt; s.pos.lerpVectors(P.from, P.to, smooth(Math.min(1, P.t / P.dur))); }
    } else {
      const moving = driven ? s.speed > 0.005 : stepMoverSub(s, dt);
      if (moving) {
        s.mode = 'walk';
        loco(s.speed, dt);
      } else if (!driven && s.pendingSeat) {
        const seat = s.pendingSeat; s.pendingSeat = undefined; s.sitOn = seat; s.mode = 'sitting';
        if (motionSeat(seat)) { beginSeat(M, seat, s.pos, s.yaw); loco(0, dt); }
        else {
          // legacy seats (Yoo Plage loungers): SitDown clip + root lift
          s.yaw = seat.yaw; sitRoot(seat, def.scale, def.sitForward, P.to); P.from.copy(P.to); P.from.y = Math.min(P.to.y, 0.02); s.pos.copy(P.from);
          P.t = 0; P.dur = SIT_IN; play('sit', 0.25);
        }
      } else {
        if (s.pendingEmote) { s.pendingEmote = false; s.emote = true; } s.mode = s.emote ? 'emote' : 'idle';
        if (s.emote) play('emote', 0.3); else loco(0, dt);
      }
    }
    if (s.mode !== 'sitting' && s.mode !== 'standing') { P.pitch = 0; if (M.phase !== 'none') { M.phase = 'none'; SP.sitW = 0; SP.pitch = 0; } }
    outer.current.position.copy(s.pos); outer.current.rotation.set(P.pitch, s.yaw, 0, 'YXZ');
    sit.restore(); built.mixer.update(dt); sit.snapshot();
    if (M.phase !== 'none' && SP.sitW > 0.001 && M.seat) {
      const seat = M.seat; const st = presetOf(seat).style;
      if (seat.pose === 'lie' && (SP.legs > 0 || SP.pitch > 0)) {
        // hips of the calibrated lying pose (feet root at lieRoot, group fully tilted), from this frame's idle pose
        outer.current.updateWorldMatrix(true, false); qCur.copy(outer.current.quaternion);
        sit.hips!.updateWorldMatrix(true, false); _hl.setFromMatrixPosition(sit.hips!.matrixWorld).sub(outer.current.position);
        qLie.setFromEuler(eLie.set(presetOf(seat).liePitch ?? LIE_PITCH, seat.yaw, 0, 'YXZ')); qLeg.setFromEuler(eLie.set(LIE_PITCH, seat.yaw, 0, 'YXZ')); _hl.applyQuaternion(qInv.copy(qCur).invert()).applyQuaternion(qLie);
        if (seat.preset === 'lounger') _hw.copy(seat.hip!).setY(seat.h! + LOUNGER_ANCHOR.lieClear);
        else _hw.copy(lieRoot(seat, def.scale, _lr)).add(_hl);
        // hips scoot from the bed edge to the lying spot, lifted a little on the way (never dragged through the mattress)
        _H.lerpVectors(SP.hip, _hw, SP.slide); _H.y += 0.03 * Math.sin(Math.PI * SP.slide);
        lieBlend.legs = SP.legs; lieBlend.body = SP.pitch; sit.apply(SP.sitW, _H, seat.yaw, st, lieBlend);
      } else {
        // getting onto the seat: the hips rise to the cushion height first, then move back over it (and the reverse when
        // standing up), so the pelvis never cuts through the front edge of a high stool or a chair
        sit.hips!.updateWorldMatrix(true, false); _hw.setFromMatrixPosition(sit.hips!.matrixWorld);
        const e = SP.sitW, ey = smooth(e / 0.5), exz = smooth((e - 0.4) / 0.6);
        _H.set(_hw.x + (SP.hip.x - _hw.x) * exz, _hw.y + (SP.hip.y - _hw.y) * ey, _hw.z + (SP.hip.z - _hw.z) * exz);
        _H.y += (presetOf(seat).clearance ?? 0) * Math.sin(Math.PI * e);
        sit.apply(e, _H, seat.yaw, st, undefined, 1);
      }
    }
    // lying on the back: the backpack is put aside (it would hold the body up off the mattress): shrinks away as the back
    // comes down instead of popping
    const bagK = 1 - smooth((SP.pitch - 0.25) / 0.35);
    if (bagK !== P.bag) { const bag = built.holder.getObjectByName('acc_backpack'); if (bag) { bag.scale.setScalar(Math.max(0.001, bagK)); bag.visible = bagK > 0.01; } P.bag = bagK; }
    Object.assign(dbg, { phase: M.phase, sp: M.sp, lp: M.lp, w: SP.sitW, pitch: SP.pitch, seat: M.seat && M.phase !== 'none' ? M.seat.id : null });
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
    const lk = P.pitch / LIE_PITCH; // 0 upright … 1 lying
    if (blob.current) { blob.current.scale.setScalar(Math.max(0.001, 1 - lk * 1.6)); blob.current.visible = lk < 0.6; } if (ring.current) ring.current.visible = lk < 0.2;
    // name tag: above the head, also when lying (the group is tilted, so lift it along the body instead)
    const kt = Math.min(1, dt * 6); const up = SP.sitW > 0 ? 1.14 - SP.sitW * (0.26 - (SP.hip.y - s.pos.y) / def.scale) : s.mode === 'sitting' ? 0.95 : 1.14;
    tag.current.position.y += (up + (0.9 - up) * lk - tag.current.position.y) * kt;
    tag.current.position.z += (0.4 * lk - tag.current.position.z) * kt;
    if (bubble.current) { const on = !!s.say && s.say.until > performance.now(); bubble.current.style.opacity = on ? '1' : '0'; if (on) bubble.current.textContent = s.say!.text; }
  });

  return (
    <group ref={outer} scale={def.scale} onClick={(e) => { if (e.delta > 8) return; e.stopPropagation(); onSelect(); }}>
      <primitive object={built.holder} />
      {/* soft blob shadow: cheap contact shadow that also works when real shadows are off (mobile) */}
      <mesh ref={blob} rotation-x={-Math.PI / 2} position-y={0.006} renderOrder={-1}><circleGeometry args={[0.2, 24]} /><meshBasicMaterial color="#2a1530" transparent opacity={0.22} depthWrite={false} /></mesh>
      {selected && <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.012}><ringGeometry args={[0.24, 0.29, 40]} /><meshBasicMaterial color={def.tagColor} transparent opacity={0.85} depthWrite={false} /></mesh>}
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
