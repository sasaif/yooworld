import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { AVATARS } from '../../data/avatars';
import type { Look } from '../../fashion/types';
import { useCustomAvatar } from '../../render/avatar/custom/useCustomAvatar';
import { FaceAnimator, morphIndex } from '../../render/avatar/face';
/** The customisable avatar on its own (studio preview, thumbnails): idle loop, blinking, optional dance. */
export function AvatarFigure({ look, yaw = 0, dance = false, still = false, onBuilt }: { look: Look; yaw?: number; dance?: boolean; still?: boolean; onBuilt?: (o: THREE.Object3D) => void }) {
  const def = AVATARS[look.body]; const a = useCustomAvatar(def, look, 'studio'); const g = useRef<THREE.Group>(null!);
  const face = useRef({ anim: new FaceAnimator(() => 0.5), idx: a.faces.map((m) => morphIndex(m.morphTargetDictionary!)) });
  useEffect(() => { face.current.idx = a.faces.map((m) => morphIndex(m.morphTargetDictionary!)); a.actions.idle.reset().play(); if (still) { a.mixer.update(0.6); } onBuilt?.(a.holder); return () => { a.mixer.stopAllAction(); }; }, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = useRef<'idle' | 'emote'>('idle');
  useFrame((_, dt) => {
    if (still) return; dt = Math.min(dt, 0.05);
    const want = dance ? 'emote' : 'idle'; if (cur.current !== want) { a.actions[want].reset().fadeIn(0.25).play(); a.actions[cur.current].fadeOut(0.25); cur.current = want; }
    a.mixer.update(dt);
    const w = face.current.anim.update(dt, { emote: dance, talking: false, sitting: false, walking: false });
    a.faces.forEach((m, i) => { const ix = face.current.idx[i]; for (const k in w) { const j = ix[k as keyof typeof w]; if (j !== undefined) m.morphTargetInfluences![j] = w[k as keyof typeof w]; } });
    g.current.rotation.y += (yaw - g.current.rotation.y) * Math.min(1, dt * 8);
  });
  return <group ref={g} rotation-y={yaw}><primitive object={a.holder} /></group>;
}
export type CamFrame = 'face' | 'head' | 'body' | 'legs' | 'feet' | 'upper' | 'hand';
export const FRAMES: Record<CamFrame, { y: number; h: number }> = {
  face: { y: 0.67, h: 0.48 }, head: { y: 0.68, h: 0.66 }, upper: { y: 0.55, h: 0.6 }, body: { y: 0.48, h: 1.08 }, legs: { y: 0.24, h: 0.62 }, feet: { y: 0.09, h: 0.32 }, hand: { y: 0.3, h: 0.5 },
};
