import * as THREE from 'three';
import { AVATARS, type AvatarDef } from '../../data/avatars';
import { BOT_LOOKS } from '../club/botAvatars';
import type { Look } from '../../fashion/types';
import type { NavGrid } from '../nav/NavGrid';
import { goTo, makeChar, world, type Seat } from '../world';

/** Hard cap: at most two ambient NPCs in any one location. */
export const MAX_NPCS_PER_LOCATION = 2;
/** Name-tag colour, distinct from the player colours and from club-table bots. */
export const NPC_TAG = '#2e7d6f';
const PREFIX = 'npc_';

/**
 * Ambient background avatars (wander / sit / emote). They are local display-only NPCs:
 * never saved, never added to friends, never counted as online players, always badged « PNJ ».
 * They reuse existing catalogue looks (no new assets, no wardrobe / economy writes).
 *
 * Spawn policy (open scenes on this branch):
 *  - Yoo Plage: 2 lite NPCs on the walkable sand / boardwalk
 *  - Mon appart: none (private home; Juan is already the local companion)
 *  - Yoo Games Club: none (table bots already occupy the room during a game; adding more would blow the draw budget)
 */
export const AMBIENT_COUNTS: Record<string, number> = { beach: 2 };
/** Preferred wander / spawn box so NPCs stay in the visible social area (cafe, boardwalk, loungers), not off-camera at the waterline. */
export const AMBIENT_AREAS: Record<string, { x0: number; z0: number; x1: number; z1: number }> = {
  beach: { x0: 6.0, z0: 2.3, x1: 10.8, z1: 4.5 },
};

const NAMES = ['Léa', 'Noah', 'Maya', 'Omar', 'Inès', 'Théo'];

export type AmbientNpc = { id: string; name: string; look: Look; body: 'f' | 'm'; location: string; nextAt: number };

let roster: AmbientNpc[] = [];

export const isAmbientNpc = (id: string) => id.startsWith(PREFIX);
export const isPlayerChar = (id: string) => id === 'f' || id === 'm';
export const listAmbient = () => roster;
export const ambientCount = (location?: string) => location ? roster.filter((n) => n.location === location).length : roster.length;

export function npcDef(n: AmbientNpc): AvatarDef {
  return { ...AVATARS[n.body], id: n.id, tagColor: NPC_TAG, label: n.name };
}

function inArea(p: THREE.Vector3, box?: { x0: number; z0: number; x1: number; z1: number }) {
  if (!box) return true;
  return p.x >= box.x0 && p.x <= box.x1 && p.z >= box.z0 && p.z <= box.z1;
}
function randFree(nav: NavGrid, rnd: () => number, minDist = 0, from?: THREE.Vector3, box?: { x0: number; z0: number; x1: number; z1: number }): THREE.Vector3 | null {
  for (let k = 0; k < 64; k++) {
    const i = Math.floor(rnd() * nav.nx), j = Math.floor(rnd() * nav.nz);
    if (!nav.free(i, j)) continue;
    const p = nav.center(i, j);
    if (box && !inArea(p, box)) continue;
    if (minDist && from && p.distanceTo(from) < minDist) continue;
    return p;
  }
  return null;
}

function seeded(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => { s = Math.imul(s ^ (s << 13), 1597334677); s ^= s >>> 16; return (s >>> 0) / 4294967296; };
}

function takenSeats(except?: string) {
  return new Set(Object.values(world.chars).filter((c) => c.id !== except).map((c) => (c.sitOn ?? c.pendingSeat)?.id).filter(Boolean) as string[]);
}

function freeSitSeat(except?: string): Seat | undefined {
  const taken = takenSeats(except);
  // Prefer cafe chairs and benches (sit) over loungers (lie) so the NPC stays clearly "seated in public"
  const sit = world.seats.filter((s) => s.pose !== 'lie' && !taken.has(s.id));
  if (sit.length) return sit[Math.floor(Math.random() * sit.length)];
  return world.seats.find((s) => !taken.has(s.id));
}

export function clearAmbient() {
  for (const n of roster) delete world.chars[n.id];
  roster = [];
}

/** Spawn (or replace) the ambient NPCs of a location. Safe to call on every enterWorld. */
export function syncAmbientNpcs(location: string, seed = 1) {
  clearAmbient();
  const n = Math.min(MAX_NPCS_PER_LOCATION, AMBIENT_COUNTS[location] ?? 0);
  const nav = world.nav; if (!n || !nav) return roster;
  const rnd = seeded(seed + location.length * 17);
  const looks = BOT_LOOKS;
  const start = Math.floor(rnd() * looks.length);
  const box = AMBIENT_AREAS[location];
  for (let i = 0; i < n; i++) {
    const look = looks[(start + i * 2) % looks.length];
    const id = `${PREFIX}${location}_${i + 1}`;
    const name = NAMES[(start + i) % NAMES.length];
    const p = randFree(nav, rnd, 0, undefined, box) ?? randFree(nav, rnd) ?? nav.center(2, 2);
    const npc: AmbientNpc = { id, name, look, body: look.body, location, nextAt: (typeof performance !== 'undefined' ? performance.now() : 0) + 400 + i * 700 };
    roster.push(npc);
    world.chars[id] = makeChar(id, name, p.x, p.z, rnd() * Math.PI * 2);
    npc.nextAt = 0;
  }
  // Kick a first wander / sit immediately so they are not frozen on spawn.
  stepAmbientNpcs((typeof performance !== 'undefined' ? performance.now() : 0) + 1);
  return roster;
}

function arriveIdle(n: AmbientNpc, now: number, hold: [number, number]) {
  const c = world.chars[n.id]; if (!c) return;
  if (c.path.length || c.mode === 'standing' || c.pendingSeat) return;
  n.nextAt = now + hold[0] + Math.random() * (hold[1] - hold[0]);
}

/** Pick the next idle behaviour. Called once a frame from the render loop. */
export function stepAmbientNpcs(now: number) {
  if (!world.nav) return;
  for (const n of roster) {
    const c = world.chars[n.id]; if (!c) continue;
    if (now < n.nextAt) continue;
    if (c.path.length || c.mode === 'standing' || c.pendingSeat) { arriveIdle(n, now, [400, 1200]); continue; }

    if (c.mode === 'sitting') {
      // stand up and walk away
      const away = randFree(world.nav, Math.random, 1.2, c.pos, AMBIENT_AREAS[n.location]) ?? c.sitOn?.front;
      if (away && goTo(n.id, away)) n.nextAt = now + 4000;
      else { c.mode = 'idle'; c.sitOn = undefined; n.nextAt = now + 800; }
      continue;
    }
    if (c.emote) { c.emote = false; n.nextAt = now + 800; continue; }

    const r = Math.random();
    if (r < 0.18) {
      const seat = freeSitSeat(n.id);
      if (seat && goTo(n.id, seat.approach ?? seat.front, { seat })) { n.nextAt = now + 8000 + Math.random() * 6000; continue; }
    }
    if (r < 0.32) {
      c.emote = true; c.mode = 'emote';
      n.nextAt = now + 2800 + Math.random() * 1200;
      continue;
    }
    const dest = randFree(world.nav, Math.random, 1.2, c.pos, AMBIENT_AREAS[n.location])
      ?? randFree(world.nav, Math.random, 1.2, c.pos);
    if (dest && goTo(n.id, dest)) n.nextAt = now + 2500 + Math.random() * 3500;
    else n.nextAt = now + 800;
  }
}
