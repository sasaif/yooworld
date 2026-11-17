import * as THREE from 'three';
import { goTo, say, world } from '../game/world';
/** Deterministic scripted states used by tools/shot.mjs (?shot=...). Not part of gameplay. */
export const SHOT = new URLSearchParams(location.search).get('shot');
const close = { target: new THREE.Vector3(2.75, 0.55, 1.15), zoom: 330, dir: new THREE.Vector3(0.55, 0.62, 1).normalize() };
export const SHOT_CAM: Record<string, { target: THREE.Vector3; zoom: number; dir?: THREE.Vector3 }> = {
  overview: { target: new THREE.Vector3(3.4, 0.35, 2.7), zoom: 122 }, close, sit: close,
  walk: { target: new THREE.Vector3(3.7, 0.4, 2.6), zoom: 200 },
  mobile: { target: new THREE.Vector3(3.2, 0.35, 2.6), zoom: 62 },
};
export function runShotScript() {
  const sofa = world.seats.find((s) => s.id === 'sofa')!; const chair = world.seats.find((s) => s.id === 'chair')!;
  const sitNow = (id: string, seat = sofa) => { const c = world.chars[id]; c.pos.copy(seat.front); c.path = [seat.front.clone()]; c.pendingSeat = seat; };
  if (SHOT === 'overview' || SHOT === 'mobile') { sitNow('m'); say('f', 'Bienvenue chez nous !', 1e9); say('m', 'Coucou !', 1e9); }
  if (SHOT === 'close' || SHOT === 'sit') { sitNow('m'); const f = world.chars.f; f.pos.set(3.45, 0, 1.25); f.yaw = -0.6; if (SHOT === 'close') { f.emote = true; say('f', 'Trop bien ton canapé !', 1e9); } else sitNow('f', chair); }
  if (SHOT === 'walk') { const f = world.chars.f, m = world.chars.m; f.pos.set(2.3, 0, 2.9); m.pos.set(5.2, 0, 2.5); goTo('f', new THREE.Vector3(5.6, 0, 2.4)); goTo('m', new THREE.Vector3(1.6, 0, 2.7), { run: true }); say('f', 'On va à la cuisine ?', 1e9); }
  setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), SHOT === 'walk' ? 2600 : 4500);
}
