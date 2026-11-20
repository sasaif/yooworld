import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as THREE from 'three';
import { GameController } from '../src/game/GameController';
import { MemoryRepository } from '../src/persistence/LocalStorageRepository';
import { OfflineTransport } from '../src/net/NetworkTransport';
import { makeChar, world } from '../src/game/world';
import { freeSeat } from '../src/game/apartment/worldSync';
import { BEACH, BEACH_PROPS, BEACH_SPAWN, DANCE_SPOTS, beachNav, beachSeats, inWater, onBoardwalk, shoreX } from '../src/game/beach/beachLayout';
import { LOCATIONS } from '../src/data/locations';

async function boot(repo = new MemoryRepository()) { const g = new GameController(repo, new OfflineTransport()); await g.init(); return { g, repo }; }
beforeEach(() => { world.chars = { f: makeChar('f', 'Juanita', 3.0, 2.85), m: makeChar('m', 'Juan', 3.7, 2.85) }; });

describe('Yoo Plage layout', () => {
  it('is listed as a playable public location', () => {
    const b = LOCATIONS.find((l) => l.id === 'beach')!; expect(b.status).toBe('playable'); expect(b.kind).toBe('public'); expect(b.name).toBe('Yoo Plage');
  });
  it('separates sea, sand and the pier', () => {
    expect(inWater(1, 5)).toBe(true); expect(inWater(9, 5)).toBe(false);
    expect(onBoardwalk(2.0, 1.2)).toBe(true); expect(inWater(2.0, 1.2)).toBe(false); // pier over the water is walkable
    for (let z = 0; z <= BEACH.d; z += 0.5) expect(shoreX(z)).toBeGreaterThan(2.4);
  });
  it('seat registry: unique ids keyed by prop, fronts reachable from the spawn, none in the sea', () => {
    const seats = beachSeats(); const nav = beachNav();
    const expected = BEACH_PROPS.reduce((n, p) => n + (p.seat?.slots.length ?? 0), 0);
    expect(seats.length).toBe(expected); expect(seats.length).toBeGreaterThanOrEqual(14);
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
    for (const s of seats) {
      expect(BEACH_PROPS.some((p) => s.id.startsWith(p.id + ':') && p.seat)).toBe(true);
      expect(inWater(s.pos.x, s.pos.z)).toBe(false);
      expect(nav.free(...nav.toCell(s.front.x, s.front.z)), `front of ${s.id} walkable`).toBe(true);
      const path = nav.path(BEACH_SPAWN.player, s.front); expect(path.length, `path to ${s.id}`).toBeGreaterThan(0);
      expect(path[path.length - 1].distanceTo(s.front)).toBeLessThan(0.05);
    }
  });
  it('dance spots and spawn points are walkable and connected', () => {
    const nav = beachNav();
    for (const p of [BEACH_SPAWN.player, BEACH_SPAWN.buddy, ...DANCE_SPOTS]) expect(nav.free(...nav.toCell(p.x, p.z))).toBe(true);
    for (const d of DANCE_SPOTS) expect(nav.path(BEACH_SPAWN.player, d).length).toBeGreaterThan(0);
  });
});

describe('location switching', () => {
  it('starts at home, travels to the beach and back; both avatars come along', async () => {
    const { g } = await boot(); expect(g.s.location).toBe('home'); const homeNav = world.nav!;
    expect(g.travel('beach')).toBe(true);
    expect(g.s.location).toBe('beach'); expect(world.location).toBe('beach'); expect(world.nav).not.toBe(homeNav);
    expect(world.nav!.nx).toBe(Math.ceil(BEACH.w / 0.2));
    expect(world.seats.some((s) => s.id.startsWith('bench1:'))).toBe(true);
    expect(world.chars.f.pos.distanceTo(BEACH_SPAWN.player)).toBeLessThan(1e-6);
    expect(world.chars.m.pos.distanceTo(BEACH_SPAWN.buddy)).toBeLessThan(1e-6);
    expect(g.travel('beach')).toBe(false); expect(g.travel('mall')).toBe(false); expect(g.travel('nowhere')).toBe(false);
    expect(g.travel('home')).toBe(true); expect(g.s.location).toBe('home');
    expect(world.seats.some((s) => s.id.startsWith('bench1:'))).toBe(false); expect(world.nav!.nx).toBe(36);
  });
  it('closes edit mode / panels when leaving, and editing furniture at the beach does not touch the beach nav', async () => {
    const { g } = await boot(); g.setMode('edit'); g.setPanel('catalog');
    g.travel('beach'); expect(g.s.mode).toBe('play'); expect(g.s.panel).toBe(null);
    const nav = world.nav; await g.resetSave(); expect(world.nav).toBe(nav);
  });
  it('fade travel switches mid-fade and clears the transition', async () => {
    vi.useFakeTimers(); const { g } = await boot();
    expect(g.travelWithFade('beach', 400, 500)).toBe(true); expect(g.s.transition?.to).toBe('beach'); expect(g.s.location).toBe('home');
    expect(g.travelWithFade('home')).toBe(false); // ignored while fading
    vi.advanceTimersByTime(420); expect(g.s.location).toBe('beach'); expect(g.s.transition).not.toBe(null);
    vi.advanceTimersByTime(520); expect(g.s.transition).toBe(null); vi.useRealTimers();
  });
});

describe('beach persistence & interactions', () => {
  it('the current location persists in the local save and is restored on the next boot', async () => {
    vi.useFakeTimers(); const repo = new MemoryRepository(); const { g } = await boot(repo);
    g.travel('beach'); vi.advanceTimersByTime(400); vi.useRealTimers();
    expect((await repo.loadProfile())!.location).toBe('beach');
    const again = await boot(repo); expect(again.g.s.location).toBe('beach'); expect(world.location).toBe('beach');
    expect(world.seats.length).toBe(beachSeats().length);
  });
  it('older saves without a location (or an unknown one) start at home', async () => {
    const repo = new MemoryRepository(); const { g } = await boot(repo);
    await repo.saveProfile({ ...g.s.profile!, location: 'moon' }); expect((await boot(repo)).g.s.location).toBe('home');
  });
  it('sitting on a bench reuses the seat system; two avatars get two slots', async () => {
    const { g } = await boot(); g.travel('beach');
    // Ambient PNJs may already claim a public seat; this assertion is about the two player avatars.
    for (const c of Object.values(world.chars)) {
      if (!c.id.startsWith('npc_')) continue;
      c.pendingSeat = undefined; c.sitOn = undefined; c.path = [];
      if (c.mode === 'sitting' || c.mode === 'standing') c.mode = 'idle';
    }
    g.interactProp('bench1', 'sit'); const f = world.chars.f; expect(f.pendingSeat?.id.startsWith('bench1:')).toBe(true);
    const other = freeSeat('bench1', world.chars.m.pos, 'm')!; expect(other.id).not.toBe(f.pendingSeat!.id);
    g.interactProp('towel2', 'sit'); expect(f.pendingSeat?.id).toBe('lounger2:0'); // tapping a towel sits on its transat
  });
  it('DJ: music toggles, dancing walks to the floor with a pending dance', async () => {
    const { g } = await boot(); g.travel('beach');
    g.interactProp('dj', 'music'); expect(g.s.beachMusic).toBe(true); g.interactProp('dj', 'music'); expect(g.s.beachMusic).toBe(false);
    g.interactProp('dj', 'dance'); const f = world.chars.f;
    expect(g.s.beachMusic).toBe(true); expect(f.pendingEmote).toBe(true); expect(f.path.length).toBeGreaterThan(0);
    const end = f.path[f.path.length - 1]; expect(Math.min(...DANCE_SPOTS.map((d) => d.distanceTo(end)))).toBeLessThan(0.05);
  });
  it('mood cycles day → sunset → auto', async () => {
    const { g } = await boot(); expect(g.s.mood).toBe('day'); g.cycleMood(); expect(g.s.mood).toBe('sunset'); g.cycleMood(); expect(g.s.mood).toBe('cycle'); g.cycleMood(); expect(g.s.mood).toBe('day');
  });
  it('beach props are ignored while at home', async () => {
    const { g } = await boot(); g.interactProp('dj', 'music'); expect(g.s.beachMusic).toBe(false);
    expect(new THREE.Vector3().copy(world.chars.f.pos).length()).toBeGreaterThan(0);
  });
});

describe('Task A: start location + shared saves', () => {
  it('init({startAt:"beach"}) starts at Yoo Plage even with a home save, and persists it', async () => {
    const repo = new MemoryRepository(); const a = await boot(repo); expect(a.g.s.location).toBe('home');
    const g = new GameController(repo, new OfflineTransport()); await g.init({ startAt: 'beach' });
    expect(g.s.location).toBe('beach'); expect((await repo.loadProfile())!.location).toBe('beach');
  });
  it('ignores unknown / unplayable start locations', async () => {
    const g = new GameController(new MemoryRepository(), new OfflineTransport()); await g.init({ startAt: 'disco' }); expect(g.s.location).toBe('home');
  });
  it('a save from another build with unknown furniture loads without crashing', async () => {
    const repo = new MemoryRepository(); const { g } = await boot(repo); const apt = g.s.apartment!;
    await repo.saveApartment({ ...apt, items: [...apt.items, { ...apt.items[0], uid: 'zz', defId: 'notInThisBuild' }] });
    const g2 = new GameController(repo, new OfflineTransport()); await g2.init();
    expect(g2.s.apartment!.items.some((i) => i.defId === 'notInThisBuild')).toBe(false); expect(g2.s.apartment!.items.length).toBe(apt.items.length);
  });
});
