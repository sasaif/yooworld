// RoomCore unit tests (portable room logic, fake clock): movement validation with the client's speeds,
// idle = 0 messages, interest management, chat, capacity, tickets, replacement, kick ban, rate limits.
import { describe, it, expect } from 'vitest';
import { RoomCore, MSG_RATE, type Out, type Persist } from '../../src/core/roomcore';
import { roomConfig, TECH, LOCATIONS, parseRoom } from '../../src/core/rooms';

// Client constants (src/game/movement/walkProfile.ts GAIT_SPEEDS) — read, never changed.
const CLIENT_WALK = 1.2, CLIENT_RUN = 2.8;
function harness(name = 'local:beach:1', cap = 30, owner?: string) {
  let t = 1_000_000; const out: { conn: string; m: Out }[] = []; const closed: { conn: string; code: number }[] = [];
  const bans = new Map<string, number>(); const used = new Set<string>();
  const persist: Persist = { getBan: (p) => bans.get(p) ?? null, putBan: (p, u) => { bans.set(p, u); }, useTicket: (j) => (used.has(j) ? false : (used.add(j), true)) };
  const core = new RoomCore(roomConfig(name, { kind: 'x', cap, owner }, 3_600_000), persist, (conn, m) => { out.push({ conn, m }); return JSON.stringify(m).length; },
    (conn, code) => closed.push({ conn, code }), () => t);
  let n = 0;
  const join = (id: string, conn = `c-${id}-${++n}`) => ({ conn, r: core.join(id, conn, `jti-${++n}`, t + 30_000) });
  return { core, out, closed, bans, join, adv: (ms: number) => { t += ms; }, now: () => t };
}

describe('movement (server-validated, same speeds as the client)', () => {
  it('accepts a full-speed run at 5 Hz for 10 s and a walk; refuses teleport, out of bounds, NaN', () => {
    const h = harness(); h.join('a');
    let x = 2, z = 2; h.core.onMessage('a', { t: 'move', x: 7.2, z: 1.3 });  // spawn
    x = 7.2 - 0; z = 1.3;
    for (let i = 0; i < 50; i++) { h.adv(200); x = Math.min(15.9, x + CLIENT_RUN * 0.2 * (i % 2 ? 1 : -1) * 0.99); z = Math.min(10.9, z + 0.1); h.core.onMessage('a', { t: 'move', x, z }); }
    expect(h.core.stats.corrections).toBe(0);
    for (let i = 0; i < 10; i++) { h.adv(200); x -= CLIENT_WALK * 0.2; h.core.onMessage('a', { t: 'move', x, z }); }
    expect(h.core.stats.corrections).toBe(0);
    const before = h.core.positionOf('a')!;
    h.adv(200); h.core.onMessage('a', { t: 'move', x: before.x + 5, z: before.z });          // teleport
    expect(h.core.positionOf('a')).toEqual(before);
    h.adv(200); h.core.onMessage('a', { t: 'move', x: -3, z: 1 });                             // out of bounds
    h.adv(200); h.core.onMessage('a', { t: 'move', x: NaN, z: 1 });
    expect(h.core.positionOf('a')).toEqual(before);
    expect(h.out.filter((o) => o.m.t === 'correct').map((o) => (o.m as any).reason)).toEqual(['too_fast', 'not_walkable']);
    expect(h.out.some((o) => o.m.t === 'error' && (o.m as any).code === 'bad_move')).toBe(true);
  });
  it('speed hack at 2x run speed: effective speed stays capped at the client run speed (+tolerance)', () => {
    const h = harness(); h.join('a'); const start = h.core.positionOf('a')!; let p = start;
    for (let i = 0; i < 10; i++) { h.adv(200); h.core.onMessage('a', { t: 'move', x: Math.min(15.9, p.x + CLIENT_RUN * 2 * 0.2), z: p.z }); p = h.core.positionOf('a')!; }
    expect(h.core.stats.corrections).toBeGreaterThanOrEqual(3);
    expect(p.x - start.x).toBeLessThanOrEqual(CLIENT_RUN * TECH.speedTolerance * 2.4 + TECH.slackM);   // 2 s of cheating
    const h2 = harness(); h2.join('b'); const s = h2.core.positionOf('b')!;
    for (let i = 0; i < 20; i++) { h2.adv(10); h2.core.onMessage('b', { t: 'move', x: s.x + 0.9 * (i + 1), z: s.z }); }   // 20 msgs in 200 ms
    expect(h2.core.positionOf('b')!.x - s.x).toBeLessThan(CLIENT_RUN * TECH.speedTolerance * 0.6 + TECH.slackM + 0.01);
  });
  it('beach geometry mirrors the client (16 x 11, spawn 7.2,1.3)', () => {
    expect(LOCATIONS.beach.bounds).toEqual({ minX: 0, maxX: 16, minZ: 0, maxZ: 11 });
    expect(LOCATIONS.beach.spawn).toEqual({ x: 7.2, z: 1.3 });
    expect(TECH.maxSpeed).toBe(CLIENT_RUN);
  });
});

describe('ticks: nothing while idle, interest management', () => {
  it('idle room sends 0 snapshots; a mover is sent to near players every tick and to far ones every 5th', () => {
    const h = harness('local:event:e1', 20);   // 30 x 20 map
    h.join('a'); h.join('b'); h.join('far');
    // put 'far' 20 m away
    let fx = 15; for (let i = 0; i < 40; i++) { h.adv(200); fx = Math.min(29.5, fx + 0.5); h.core.onMessage('far', { t: 'move', x: fx, z: Math.min(19, 2 + i * 0.3) }); }
    expect(h.core.stats.corrections).toBe(0);
    for (let i = 0; i < 20; i++) h.core.tick();
    h.out.length = 0; const s0 = { ...h.core.stats };
    for (let i = 0; i < 100; i++) expect(h.core.tick()).toBe(false);
    expect(h.out.length).toBe(0);
    expect(h.core.stats.ticks).toBe(s0.ticks);
    for (let i = 0; i < 10; i++) { h.adv(200); const p = h.core.positionOf('a')!; h.core.onMessage('a', { t: 'move', x: p.x + 0.3, z: p.z }); h.core.tick(); h.core.tick(); }
    const toB = h.out.filter((o) => o.conn.startsWith('c-b') && o.m.t === 'snap').length;
    const toFar = h.out.filter((o) => o.conn.startsWith('c-far') && o.m.t === 'snap').length;
    expect(toB).toBe(10); expect(toFar).toBeLessThan(toB); expect(toFar).toBeGreaterThan(0);
  });
});

describe('chat (authoritative)', () => {
  it('broadcasts trimmed text with server time, dedupes client retries, rate-limits 5 per 10 s, caps length', () => {
    const h = harness(); h.join('a'); h.join('b'); h.out.length = 0;
    h.core.onMessage('a', { t: 'chat', text: '  salut \u0007 ', cid: 'm1' });
    h.core.onMessage('a', { t: 'chat', text: 'salut', cid: 'm1' });     // retry after reconnect -> dropped
    const chats = h.out.filter((o) => o.m.t === 'chat');
    expect(chats.length).toBe(2);   // to a and b, once
    expect((chats[0].m as any).text).toBe('salut');
    for (let i = 2; i <= 6; i++) { h.adv(100); h.core.onMessage('a', { t: 'chat', text: 'x'.repeat(500), cid: `m${i}` }); }
    expect(h.out.some((o) => o.m.t === 'error' && (o.m as any).code === 'chat_rate')).toBe(true);
    expect(Math.max(...h.out.filter((o) => o.m.t === 'chat').map((o) => (o.m as any).text.length))).toBe(TECH.chatMaxLen);
  });
  it('message flood: >20/s dropped with one warning, >60/s disconnect 4008', () => {
    const h = harness(); const { conn } = h.join('a'); h.join('b'); h.out.length = 0;
    for (let i = 0; i < 25; i++) h.core.onMessage('a', { t: 'ping' } as any);
    expect(h.out.filter((o) => o.conn === conn && o.m.t === 'error' && (o.m as any).code === 'rate_limited').length).toBe(1);
    for (let i = 0; i < MSG_RATE.hard; i++) h.core.onMessage('a', { t: 'ping' } as any);
    expect(h.closed).toContainEqual({ conn, code: 4008 });
    expect(h.core.has('a')).toBe(false);
  });
});

describe('join rules', () => {
  it('hard cap, single-use tickets, expired tickets, replacement without duplicate avatar', () => {
    const h = harness('local:beach:1', 3);
    expect(h.join('a').r.ok).toBe(true); h.join('b'); h.join('c');
    expect(h.join('d').r).toMatchObject({ ok: false, code: 'full' });
    const c1 = h.core.join('e', 'x', 'same-jti', h.now() + 1000);
    expect(c1.code).toBe('full');
    expect(h.core.join('a', 'y', 'same-jti', h.now() + 1000)).toMatchObject({ ok: false, code: 'ticket_used' });
    expect(h.core.join('a', 'y2', 'old', h.now() - 1)).toMatchObject({ ok: false, code: 'expired' });
    const old = h.core.positionOf('a');
    const re = h.join('a');                                  // reconnect while full: allowed (replacement)
    expect(re.r).toMatchObject({ ok: true }); expect(re.r.pos).toEqual(old);
    expect(h.closed.some((c) => c.code === 4001)).toBe(true);
    expect(h.core.count).toBe(3);
    expect(h.core.leave('a', 'stale-conn')).toBe(false);     // stale socket of the replaced session
  });
  it('kick: durable ban checked on every join until it expires', () => {
    const h = harness('local:event:e1', 20, 'owner'); h.join('owner'); h.join('t');
    const until = h.now() + 3_600_000;
    expect(h.core.kick('t', until, 'owner')).toMatchObject({ wasPresent: true });
    expect(h.closed.some((c) => c.code === 4003)).toBe(true);
    expect(h.join('t').r).toMatchObject({ ok: false, code: 'kicked', until });
    h.adv(3_600_001);
    expect(h.join('t').r.ok).toBe(true);
  });
  it('room names are strict', () => {
    expect(parseRoom('local:beach:1')).toMatchObject({ kind: 'public', shard: 1 });
    expect(parseRoom('local:farm:2')).toMatchObject({ kind: 'public', location: 'farm' });
    expect(parseRoom('prod:apt:abc')).toMatchObject({ kind: 'apartment' });
    for (const bad of ['local:beach:0', 'local:beach:x', 'dev:beach:1', 'local:moon:1', 'local:beach:1:2', 'local:event:../x']) expect(parseRoom(bad), bad).toBeNull();
    expect(() => roomConfig('local:beach:1', { kind: 'public' }, 0)).toThrow();
  });
});
