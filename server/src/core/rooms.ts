/**
 * Room catalogue: which locations exist, their geometry, and how product values (capacities, kick ban) map from
 * eco.config. Product values are NEVER hard-coded here: they come from eco.config (status pending_approval or
 * owner_rule) and travel to the room inside the signed ticket. Technical values (rates, slack) are constants.
 */
import type { RoomConfig, RoomKind, Rect, Vec } from './roomcore';

export interface LocationDef { id: string; bounds: Rect; blocked: Rect[]; spawn: Vec; sharded: boolean }
/** Beach geometry mirrors the client (src/game/beach/beachLayout.ts: BEACH = 16 x 11, spawn 7.2,1.3). */
export const LOCATIONS: Record<string, LocationDef> = {
  beach:   { id: 'beach',   bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 11 }, blocked: [], spawn: { x: 7.2, z: 1.3 }, sharded: true },
  factory: { id: 'factory', bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 14 }, blocked: [], spawn: { x: 2, z: 2 }, sharded: true },
  farm:    { id: 'farm',    bounds: { minX: 0, maxX: 20, minZ: 0, maxZ: 14 }, blocked: [], spawn: { x: 2, z: 2 }, sharded: true },
  apartment: { id: 'apartment', bounds: { minX: 0, maxX: 12, minZ: 0, maxZ: 10 }, blocked: [], spawn: { x: 6, z: 1 }, sharded: false },
  event:   { id: 'event',   bounds: { minX: 0, maxX: 30, minZ: 0, maxZ: 20 }, blocked: [], spawn: { x: 15, z: 2 }, sharded: false },
};

/** Technical constants (Phase A §7.3). Client run speed is 2.8 m/s (src/game/movement/walkProfile.ts), unchanged. */
export const TECH = {
  tickMs: 100,               // 10 Hz snapshots, only while someone moves
  inputMinIntervalMs: 200,   // 5 Hz client input
  maxSpeed: 2.8, speedTolerance: 1.35, slackM: 0.25,
  interestRadius: 15, farEvery: 5,
  chatMaxLen: 200, chatPerWindow: 5, chatWindowMs: 10_000,
} as const;

/** eco.config keys that drive rooms (see db/migrations/0007_rooms_saves.sql). */
export const ROOM_CONFIG_KEYS = ['room.public_soft_cap', 'room.public_hard_cap', 'room.apartment_visitors', 'event.capacity_default', 'event.kick_ban_minutes'] as const;
export type RoomProductConfig = Record<(typeof ROOM_CONFIG_KEYS)[number], number>;

/** Room names: '<env>:<location>:<n>' (public shard), '<env>:apt:<owner>', '<env>:event:<id>'. */
export function parseRoom(name: string): { env: string; kind: RoomKind; location: string; shard?: number; ref?: string } | null {
  const m = /^(local|uat|prod):(beach|factory|farm|apt|event):([A-Za-z0-9-]{1,64})$/.exec(name);
  if (!m) return null;
  const [, env, loc, ref] = m;
  if (loc === 'apt') return { env, kind: 'apartment', location: 'apartment', ref };
  if (loc === 'event') return { env, kind: 'event', location: 'event', ref };
  const n = Number(ref); if (!Number.isInteger(n) || n < 1 || n > 10_000) return null;
  return { env, kind: 'public', location: loc, shard: n };
}

export function roomConfig(name: string, claims: { kind: string; cap?: number; owner?: string }, kickBanMs: number): RoomConfig {
  const r = parseRoom(name); if (!r) throw new Error('bad room name');
  const loc = LOCATIONS[r.location];
  if (!claims.cap || claims.cap < 1 || claims.cap > 200) throw new Error('ticket without capacity');
  return {
    kind: r.kind, location: r.location, hardCap: claims.cap, ownerId: claims.owner, kickBanMs,
    maxSpeed: TECH.maxSpeed, speedTolerance: TECH.speedTolerance, slackM: TECH.slackM,
    bounds: loc.bounds, blocked: loc.blocked, spawn: loc.spawn,
    interestRadius: TECH.interestRadius, farEvery: TECH.farEvery,
    chatMaxLen: TECH.chatMaxLen, chatPerWindow: TECH.chatPerWindow, chatWindowMs: TECH.chatWindowMs,
    moveMinIntervalMs: TECH.inputMinIntervalMs,
  };
}
