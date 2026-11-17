import * as THREE from 'three';
import type { NavGrid } from './nav';
import type { Seat } from './Room';
export type Mode = 'idle' | 'walk' | 'sitting' | 'standing' | 'emote';
export interface CharState { id: string; name: string; pos: THREE.Vector3; yaw: number; path: THREE.Vector3[]; mode: Mode; sitOn?: Seat; pendingSeat?: Seat; say?: { text: string; until: number }; emote?: boolean }
export const world = { nav: null as NavGrid | null, seats: [] as Seat[], chars: {} as Record<string, CharState> };
export function goTo(id: string, p: THREE.Vector3, seat?: Seat) {
  const c = world.chars[id]; if (!c || !world.nav) return;
  c.pendingSeat = seat; c.emote = false;
  c.path = world.nav.path(c.pos, p);
  if (c.mode === 'sitting') c.mode = 'standing';
}
