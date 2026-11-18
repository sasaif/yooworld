import * as THREE from 'three';
import type { NavGrid } from './nav/NavGrid';
import type { Mover } from './character/locomotion';

export type Mode = 'idle' | 'walk' | 'sitting' | 'standing' | 'emote';
export interface Seat { id: string; pos: THREE.Vector3; yaw: number; front: THREE.Vector3 }
/** Runtime state of a character in the current scene (mutable, read by the render loop). */
export interface CharState extends Mover {
  id: string; name: string; mode: Mode; local: true;
  sitOn?: Seat; pendingSeat?: Seat; pendingEmote?: boolean; say?: { text: string; until: number }; emote?: boolean;
}
export const world = { location: 'home' as string, nav: null as NavGrid | null, seats: [] as Seat[], chars: {} as Record<string, CharState> };

export function makeChar(id: string, name: string, x: number, z: number, yaw = 0): CharState {
  return { id, name, local: true, pos: new THREE.Vector3(x, 0, z), yaw, speed: 0, path: [], running: false, mode: 'idle' };
}
export function goTo(id: string, p: THREE.Vector3, opts: { seat?: Seat; run?: boolean; emote?: boolean } = {}) {
  const c = world.chars[id]; if (!c || !world.nav) return false;
  const path = world.nav.path(c.mode === 'sitting' && c.sitOn ? c.sitOn.front : c.pos, p);
  if (!path.length) return false;
  c.pendingSeat = opts.seat; c.pendingEmote = !!opts.emote; c.emote = false; c.running = !!opts.run; c.path = path;
  if (c.mode === 'sitting') c.mode = 'standing';
  return true;
}
export function say(id: string, text: string, ms = 6000) { const c = world.chars[id]; if (c) c.say = { text, until: performance.now() + ms }; }
/** Put a character down at a spot (travel / spawn): stops any walk, sit or dance. */
export function placeChar(id: string, p: THREE.Vector3, yaw: number) {
  const c = world.chars[id]; if (!c) return;
  c.pos.copy(p).setY(0); c.yaw = yaw; c.path = []; c.speed = 0; c.mode = 'idle'; c.sitOn = undefined; c.pendingSeat = undefined; c.pendingEmote = false; c.emote = false;
}
