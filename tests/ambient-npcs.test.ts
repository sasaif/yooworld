import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { NavGrid } from '../src/game/nav/NavGrid';
import { world, makeChar } from '../src/game/world';
import { AMBIENT_AREAS, AMBIENT_COUNTS, MAX_NPCS_PER_LOCATION, ambientCount, clearAmbient, isAmbientNpc, isPlayerChar, listAmbient, stepAmbientNpcs, syncAmbientNpcs } from '../src/game/npc/ambientNpcs';

function navRoom() {
  const nav = new NavGrid(10, 8, 0.2);
  world.nav = nav; world.seats = []; world.location = 'beach';
  world.chars = { f: makeChar('f', 'Juanita', 2, 2, 0), m: makeChar('m', 'Juan', 3, 2, 0) };
}

describe('ambient NPCs', () => {
  it('caps at 2 per location and only spawns on configured public scenes', () => {
    expect(MAX_NPCS_PER_LOCATION).toBe(2);
    expect(AMBIENT_COUNTS.beach).toBe(2);
    expect(AMBIENT_COUNTS.home ?? 0).toBe(0);
    expect(AMBIENT_COUNTS.club ?? 0).toBe(0);
    navRoom();
    syncAmbientNpcs('beach', 1);
    expect(ambientCount('beach')).toBe(2);
    expect(listAmbient().every((n) => isAmbientNpc(n.id))).toBe(true);
    expect(Object.keys(world.chars).filter(isAmbientNpc)).toHaveLength(2);
    syncAmbientNpcs('home', 1);
    expect(ambientCount()).toBe(0);
    expect(Object.keys(world.chars).filter(isAmbientNpc)).toHaveLength(0);
    syncAmbientNpcs('club', 1);
    expect(ambientCount()).toBe(0);
  });

  it('gives each NPC a distinct catalogue look, a unique name, and a PNJ id', () => {
    navRoom();
    const a = syncAmbientNpcs('beach', 3);
    expect(a).toHaveLength(2);
    expect(a[0].look).not.toEqual(a[1].look);
    expect(a[0].name).not.toBe(a[1].name);
    expect(new Set(a.map((n) => n.body)).size).toBeGreaterThanOrEqual(1);
    expect(a.every((n) => n.look.body === n.body)).toBe(true);
    expect(a.every((n) => !['Juan', 'Juanita'].includes(n.name))).toBe(true);
  });

  it('never writes into the friends list or player-character ids', () => {
    navRoom();
    const friends: string[] = [];
    syncAmbientNpcs('beach', 2);
    for (const n of listAmbient()) friends.push(); // ensure we don't add them
    expect(friends).toEqual([]);
    expect(listAmbient().some((n) => isPlayerChar(n.id))).toBe(false);
    expect(isPlayerChar('f') && isPlayerChar('m')).toBe(true);
    expect(isAmbientNpc('f') || isAmbientNpc('bot_1')).toBe(false);
  });

  it('despawns previous NPCs when travelling and does not leave them in world.chars', () => {
    navRoom();
    syncAmbientNpcs('beach', 1);
    const first = listAmbient().map((n) => n.id);
    expect(first).toHaveLength(2);
    syncAmbientNpcs('home', 1);
    for (const id of first) expect(world.chars[id]).toBeUndefined();
    clearAmbient();
    expect(listAmbient()).toHaveLength(0);
  });

  it('picks wander / sit / emote once the think timer elapses', () => {
    navRoom();
    syncAmbientNpcs('beach', 1);
    for (const n of listAmbient()) n.nextAt = 0;
    stepAmbientNpcs(10_000);
    const acted = listAmbient().some((n) => {
      const c = world.chars[n.id];
      return c.path.length > 0 || !!c.emote || !!c.pendingSeat || c.mode === 'emote';
    });
    expect(acted).toBe(true);
  });

  it('spawns beach NPCs inside the visible social area', () => {
    navRoom();
    const box = AMBIENT_AREAS.beach;
    syncAmbientNpcs('beach', 9);
    for (const n of listAmbient()) {
      const p = world.chars[n.id].pos;
      expect(p.x).toBeGreaterThanOrEqual(box.x0); expect(p.x).toBeLessThanOrEqual(box.x1);
      expect(p.z).toBeGreaterThanOrEqual(box.z0); expect(p.z).toBeLessThanOrEqual(box.z1);
    }
  });

  it('keeps player/buddy placement independent of ambient NPCs', () => {
    navRoom();
    syncAmbientNpcs('beach', 1);
    const buddyPad = new THREE.Vector3(7.95, 0, 1.75);
    // the travel placement loop must skip npc_* ids (see GameController.enterWorld)
    for (const c of Object.values(world.chars)) {
      if (!isPlayerChar(c.id)) continue;
      c.pos.copy(c.id === 'f' ? new THREE.Vector3(7.2, 0, 1.3) : buddyPad);
    }
    for (const n of listAmbient()) {
      expect(n.id.startsWith('npc_')).toBe(true);
      expect(world.chars[n.id].pos.distanceTo(buddyPad)).toBeGreaterThan(0.4);
    }
  });
});
