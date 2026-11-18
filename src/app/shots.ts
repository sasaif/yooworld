import * as THREE from 'three';
import { goTo, say, world } from '../game/world';
import { freeSeat } from '../game/apartment/worldSync';
import { game } from './services';
/** Deterministic scripted states used by tools/shot.mjs (?shot=...). Not part of gameplay. */
export const SHOT = new URLSearchParams(location.search).get('shot');
const close = { target: new THREE.Vector3(2.75, 0.55, 1.15), zoom: 330, dir: new THREE.Vector3(0.55, 0.62, 1).normalize() };
export const SHOT_CAM: Record<string, { target: THREE.Vector3; zoom: number; dir?: THREE.Vector3 }> = {
  overview: { target: new THREE.Vector3(3.4, 0.35, 2.7), zoom: 122 }, close, sit: close, decor: { target: new THREE.Vector3(3.4, 0.35, 2.7), zoom: 122 },
  walk: { target: new THREE.Vector3(3.7, 0.4, 2.6), zoom: 200 }, edit: { target: new THREE.Vector3(3.4, 0.35, 2.7), zoom: 122 },
  ui: { target: new THREE.Vector3(3.2, 0.35, 2.7), zoom: 122 }, ui_m: { target: new THREE.Vector3(3.0, 0.35, 2.6), zoom: 70 },
};
const byDef = (d: string) => game.s.apartment!.items.find((i) => i.defId === d)!;
export function runShotScript() {
  const sit = (id: string, uid: string) => { const c = world.chars[id]; const s = freeSeat(uid, c.pos, id)!; c.pos.copy(s.front); c.path = [s.front.clone()]; c.pendingSeat = s; };
  const sofa = byDef('loungeSofa').uid, chair = byDef('loungeChair').uid;
  if (SHOT === 'overview' || SHOT === 'ui_m' || SHOT === 'ui') { sit('m', sofa); say('f', 'Bienvenue chez moi !', 1e9); say('m', 'Coucou !', 1e9); }
  if (SHOT === 'close' || SHOT === 'sit') { sit('m', sofa); const f = world.chars.f; if (SHOT === 'close') { f.pos.set(3.45, 0, 1.25); f.yaw = -0.6; f.emote = true; say('f', 'Trop bien ton canapé !', 1e9); } else sit('f', sofa); }
  if (SHOT === 'decor') {
    const a = game.s.apartment!; game.store.set({ apartment: { ...a, wall: 'night', floor: 'walnut', items: a.items.map((i) => (['televisionModern', 'radio'].includes(i.defId) ? { ...i, on: true } : i)) } });
    sit('m', sofa); sit('f', sofa); world.chars.f.emote = false;
  }
  if (SHOT === 'walk') { const f = world.chars.f, m = world.chars.m; f.pos.set(2.3, 0, 2.9); m.pos.set(5.2, 0, 2.5); goTo('f', new THREE.Vector3(5.6, 0, 2.4)); goTo('m', new THREE.Vector3(1.6, 0, 2.7), { run: true }); say('f', 'On va à la cuisine ?', 1e9); }
  if (SHOT === 'edit') { game.setMode('edit'); game.startPlace('loungeDesignSofa'); game.ghostAt(4.9, 2.8); }
  setTimeout(() => ((window as unknown as { __ready: boolean }).__ready = true), SHOT === 'walk' ? 2600 : 4500);
}
