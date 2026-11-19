import { describe, expect, it, vi } from 'vitest';
import { GameController } from '../src/game/GameController';
import { MemoryRepository } from '../src/persistence/LocalStorageRepository';
import { OfflineTransport } from '../src/net/NetworkTransport';
import { makeChar, world } from '../src/game/world';
import { FURNITURE } from '../src/data/furniture';
import { footprint, CELL } from '../src/game/apartment/ApartmentModel';
import { computeSeats, syncWorld } from '../src/game/apartment/worldSync';
import { CLUB, CLUB_SPAWN, CLUB_TABLES, chairsFor, tableOf } from '../src/game/club/clubLayout';
import { LOCATIONS, isPlayable, remembered } from '../src/data/locations';
import { startLocation } from '../src/app/startLocation';
import { APT_COLS, APT_ROWS } from '../src/data/defaultApartment';

async function boot() {
  world.chars.f = makeChar('f', 'Juanita', 3, 2.85); world.chars.m = makeChar('m', 'Juan', 3.7, 2.85);
  const repo = new MemoryRepository(); const g = new GameController(repo, new OfflineTransport()); await g.init(); return { g, repo };
}

describe('Yoo Games Club: place', () => {
  it('is a playable public place, reachable from Lieux, never remembered as the current location', () => {
    const c = LOCATIONS.find((l) => l.id === 'club')!;
    expect(c).toMatchObject({ kind: 'public', status: 'playable', name: 'Yoo Games Club' }); expect(isPlayable('club')).toBe(true);
    expect(remembered('club')).toBe(false); expect(remembered('beach')).toBe(true); expect(remembered('home')).toBe(true);
    expect(startLocation('?lieu=club', undefined, false)).toBe('club'); expect(startLocation('?lieu=jeux', undefined, false)).toBe('club');
  });
  it('same footprint as the apartment (same wall kit, same camera framing)', () => {
    expect([CLUB.cols, CLUB.rows]).toEqual([APT_COLS, APT_ROWS]);
  });
  it('every item is a known Kenney model, inside the room, and floor items never overlap', () => {
    const floor = CLUB.items.filter((i) => FURNITURE[i.defId].layer === 'floor');
    for (const it of CLUB.items) { expect(FURNITURE[it.defId]).toBeTruthy(); const f = footprint(it, FURNITURE); expect(f.x >= 0 && f.z >= 0 && f.x + f.w <= CLUB.cols && f.z + f.d <= CLUB.rows).toBe(true); }
    for (let i = 0; i < floor.length; i++) for (let j = i + 1; j < floor.length; j++) {
      const a = footprint(floor[i], FURNITURE), b = footprint(floor[j], FURNITURE);
      expect(a.x < b.x + b.w && b.x < a.x + a.w && a.z < b.z + b.d && b.z < a.z + a.d, `${floor[i].uid} / ${floor[j].uid}`).toBe(false);
    }
    expect(new Set(CLUB.items.map((i) => i.uid)).size).toBe(CLUB.items.length);
  });
  it('the domino table has 4 chair seats facing the table, each reachable on foot from the entrance', () => {
    syncWorld(CLUB, FURNITURE);
    const t = CLUB_TABLES.find((x) => x.gameId === 'dominoes')!; const tp = CLUB.items.find((i) => i.uid === t.table)!; const tf = footprint(tp, FURNITURE);
    const centre = { x: (tf.x + tf.w / 2) * CELL, z: (tf.z + tf.d / 2) * CELL };
    for (const c of t.chairs) {
      const s = world.seats.find((x) => x.id === `${c}:0`)!; expect(s, c).toBeTruthy(); expect(s.preset).toBe('chair');
      const to = { x: centre.x - s.pos.x, z: centre.z - s.pos.z }; const d = Math.hypot(to.x, to.z);
      expect((Math.sin(s.yaw) * to.x + Math.cos(s.yaw) * to.z) / d, `${c} faces the table`).toBeGreaterThan(0.9);
      expect(world.nav!.path(CLUB_SPAWN.player, s.front).length, `${c} reachable`).toBeGreaterThan(0);
    }
    expect(computeSeats(CLUB, FURNITURE).length).toBeGreaterThanOrEqual(10);
  });
  it('chairs per player count: face to face for 2, human always seat 0', () => {
    const t = CLUB_TABLES[0];
    expect(chairsFor(t, 't_dominoes_N', 2)).toEqual(['t_dominoes_N', 't_dominoes_S']);
    expect(chairsFor(t, 't_dominoes_E', 3)).toEqual(['t_dominoes_E', 't_dominoes_S', 't_dominoes_N']);
    expect(chairsFor(t, 't_dominoes_W', 4)).toEqual(['t_dominoes_W', 't_dominoes_N', 't_dominoes_E', 't_dominoes_S']);
    expect(tableOf('t_dominoes_S')?.id).toBe('t_dominoes'); expect(tableOf('club_0')).toBeUndefined();
  });
});

describe('Yoo Games Club: travel without saving', () => {
  it('travel home → club → home: club nav/seats, avatars at the entrance, profile location NOT written as club', async () => {
    vi.useFakeTimers();
    const { g, repo } = await boot();
    expect(g.travel('club')).toBe(true); expect(g.s.location).toBe('club'); expect(world.location).toBe('club');
    expect(world.seats.some((s) => s.id === 't_dominoes_N:0')).toBe(true);
    expect(world.chars.f.pos.distanceTo(CLUB_SPAWN.player)).toBeLessThan(1e-6);
    expect(g.s.profile!.location).not.toBe('club');
    vi.advanceTimersByTime(1000);
    expect((await repo.loadProfile())!.location).not.toBe('club');
    expect(g.travel('home')).toBe(true); expect(world.seats.some((s) => s.id.startsWith('t_dominoes'))).toBe(false);
    vi.useRealTimers();
  });
  it('deep link ?lieu=club opens the club without saving it as the location', async () => {
    world.chars.f = makeChar('f', 'Juanita', 3, 2.85); world.chars.m = makeChar('m', 'Juan', 3.7, 2.85);
    const repo = new MemoryRepository(); const g = new GameController(repo, new OfflineTransport()); await g.init({ startAt: 'club' });
    expect(g.s.location).toBe('club'); expect((await repo.loadProfile())!.location ?? 'home').not.toBe('club');
  });
});
