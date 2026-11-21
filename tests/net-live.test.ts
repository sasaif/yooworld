// ?net=1 dev transport (OFF by default): flag parsing, reconnect/backoff, protocol mapping, movement chase.
import { describe, it, expect } from 'vitest';
import { liveNetConfig } from '../src/net/live/netFlag';
import { Reconnector, FatalOpenError, type WsLike } from '../src/net/live/Reconnector';
import { NetSync, CHASE_STEP, label } from '../src/net/live/NetSync';
import { LiveTransport } from '../src/net/live/LiveTransport';
import type { NetMessage } from '../src/net/NetworkTransport';

class FakeWs implements WsLike {
  readyState = 0; sent: string[] = []; closed: number | null = null;
  onopen: WsLike['onopen'] = null; onmessage: WsLike['onmessage'] = null; onclose: WsLike['onclose'] = null; onerror: WsLike['onerror'] = null;
  constructor(public url = '') {}
  send(d: string) { this.sent.push(d); }
  close(code = 1000) { this.closed = code; }
  open() { this.readyState = 1; this.onopen?.(null); }
  recv(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('flag', () => {
  it('off unless ?net=1; server override restricted to loopback', () => {
    expect(liveNetConfig('')).toBeNull(); expect(liveNetConfig('?lieu=beach')).toBeNull(); expect(liveNetConfig('?net=0')).toBeNull(); expect(liveNetConfig('?net=true')).toBeNull();
    expect(liveNetConfig('?net=1')).toEqual({ server: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' });
    expect(liveNetConfig('?net=1&server=http://localhost:9999')).toEqual({ server: 'http://localhost:9999', ws: 'ws://localhost:9999' });
    expect(liveNetConfig('?net=1&server=https://evil.example')).toBeNull();
    expect(liveNetConfig('?net=1&server=javascript:alert(1)')).toBeNull();
  });
});

describe('Reconnector', () => {
  it('reconnects with jittered exponential backoff and a fresh open() each time; stops on kicked / replaced / fatal', async () => {
    const timers: { fn: () => void; ms: number }[] = []; const states: string[] = []; const sockets: FakeWs[] = [];
    let fail = 0;
    const rc = new Reconnector({
      open: async () => { if (fail-- > 0) throw new Error('join_503'); const w = new FakeWs(); sockets.push(w); return w; },
      onMessage: () => {}, onState: (s, why) => states.push(why ? `${s}:${why}` : s), random: () => 1,
      setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    });
    expect([0, 1, 2, 3, 4, 5, 6].map((a) => rc.delay(a))).toEqual([500, 1000, 2000, 4000, 8000, 15000, 15000]);
    rc.start(); await flush(); sockets[0].open(); expect(rc.state).toBe('open');
    expect(rc.send('x')).toBe(true); expect(sockets[0].sent).toEqual(['x']);
    sockets[0].drop(1006); expect(rc.state).toBe('waiting'); expect(timers.at(-1)!.ms).toBe(500);
    fail = 2; timers.at(-1)!.fn(); await flush(); expect(timers.at(-1)!.ms).toBe(1000);
    timers.at(-1)!.fn(); await flush(); expect(timers.at(-1)!.ms).toBe(2000);
    timers.at(-1)!.fn(); await flush(); expect(sockets).toHaveLength(2); sockets[1].open(); expect(rc.attempt).toBe(0);
    expect(rc.send('y')).toBe(true);
    sockets[1].drop(4003); expect(rc.state).toBe('stopped'); expect(rc.why).toBe('kicked');
    expect(rc.send('z')).toBe(false);
    rc.start(); await flush(); sockets[2].open(); sockets[2].drop(4001); expect(rc.why).toBe('replaced');
    const r2 = new Reconnector({ open: async () => { throw new FatalOpenError('not_signed_in'); }, onMessage: () => {}, setTimer: () => { throw new Error('must not retry'); } });
    r2.start(); await flush(); expect(r2.state).toBe('stopped'); expect(r2.why).toBe('not_signed_in');
    expect(states).toContain('waiting:closed_1006'); expect(states).toContain('waiting:join_503');
  });
  it('stop() during a pending open discards the late socket', async () => {
    let resolve!: (w: WsLike) => void; const w = new FakeWs();
    const rc = new Reconnector({ open: () => new Promise((r) => { resolve = r; }), onMessage: () => {} });
    rc.start(); rc.stop('disconnect'); resolve(w); await flush();
    expect(w.closed).toBe(1000); expect(rc.state).toBe('stopped');
  });
});

describe('NetSync', () => {
  it('presence from welcome/joined/snap/left; own echo and replayed history deduped', () => {
    const chats: unknown[] = []; const s = new NetSync((m) => chats.push(m), () => 42);
    s.handle({ t: 'welcome', you: 'me', players: [{ id: 'me', pos: { x: 7, z: 1 } }, { id: 'aaaa-bbbb', pos: { x: 3, z: 4 } }], seq: 0, v: 1 });
    expect([...s.remotes.keys()]).toEqual(['aaaa-bbbb']); expect(s.remotes.get('aaaa-bbbb')!.label).toBe('Joueur aaaa');
    s.handle({ t: 'joined', id: 'c1', pos: { x: 1, z: 1 } }); s.handle({ t: 'snap', seq: 1, at: 0, p: [['c1', 2, 2]] });
    expect(s.remotes.get('c1')).toMatchObject({ x: 2, z: 2 });
    s.handle({ t: 'left', id: 'c1' }); expect(s.remotes.has('c1')).toBe(false);
    s.handle({ t: 'history', msgs: [{ id: 'h1', from: 'aaaa-bbbb', text: 'salut', at: 1 }, { id: 'h2', from: 'me', text: 'moi', at: 2 }] });
    s.handle({ t: 'chat', id: 'h1', from: 'aaaa-bbbb', text: 'salut', at: 1 });
    expect(chats).toEqual([{ from: label('aaaa-bbbb'), text: 'salut', at: 1 }]);
    expect(s.chatPayload('yo')).toMatchObject({ t: 'chat', text: 'yo' }); expect(s.chatPayload('yo').cid).not.toBe(s.chatPayload('yo').cid);
  });
  it('movement: nothing before welcome, nothing when still, chases in steps the server budget accepts, re-bases on correction', () => {
    const s = new NetSync(() => {});
    expect(s.nextMove({ x: 1, z: 1 })).toBeNull();
    s.handle({ t: 'welcome', you: 'me', players: [{ id: 'me', pos: { x: 7.2, z: 1.3 } }], seq: 0, v: 1 });
    expect(s.nextMove({ x: 7.2, z: 1.3 })).toBeNull();
    const m = s.nextMove({ x: 10.2, z: 1.3 })!; expect(m.x).toBeCloseTo(7.2 + CHASE_STEP, 3);
    let n = 1; while (s.nextMove({ x: 10.2, z: 1.3 })) n++;
    expect(n).toBe(Math.ceil(3 / CHASE_STEP));
    s.handle({ t: 'correct', pos: { x: 9, z: 1.3 }, reason: 'too_fast' }); expect(s.corrections).toBe(1);
    expect(s.nextMove({ x: 10.2, z: 1.3 })!.x).toBeCloseTo(9 + CHASE_STEP, 3);
    expect(CHASE_STEP).toBeLessThan(2.8 * 1.35 * 0.2);
  });
});

describe('LiveTransport', () => {
  const cfg = { server: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' };
  it('session -> ticket -> websocket; chat out/in mapped to NetMessage; queued while offline; beach only', async () => {
    const calls: string[] = []; const socks: FakeWs[] = [];
    const fetchFn = (async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url} ${init?.credentials}`);
      if (url.endsWith('/get-session')) return new Response(JSON.stringify({ user: { id: 'u1' } }));
      return new Response(JSON.stringify({ room: 'local:beach:1', ticket: 't.k' }));
    }) as unknown as typeof fetch;
    let loc = 'home'; let changed = 0;
    const t = new LiveTransport(cfg, fetchFn, (u) => { const w = new FakeWs(u); socks.push(w); return w; });
    t.attach({ location: () => loc, local: () => ({ x: 7.2, z: 1.3 }), changed: () => { changed++; } });
    await t.connect('apt', 'p'); await flush(); expect(socks).toHaveLength(0); expect(t.status).toBe('offline');
    const got: NetMessage[] = []; t.onMessage((m) => got.push(m));
    t.send({ t: 'chat', playerId: 'f', text: 'avant', at: 1 });                       // queued
    t.send({ t: 'emote', playerId: 'f', emote: 'x' });                               // not synced
    loc = 'beach'; await t.connect('public:beach', 'p'); await flush(); await flush();
    expect(calls).toEqual(['GET http://127.0.0.1:8787/api/auth/get-session include', 'POST http://127.0.0.1:8787/api/rooms/beach/join include']);
    expect(socks[0].url).toBe('ws://127.0.0.1:8787/ws/local%3Abeach%3A1?ticket=t.k');
    socks[0].open(); expect(t.status).toBe('online');
    socks[0].recv({ t: 'welcome', you: 'u1', players: [{ id: 'u1', pos: { x: 7.2, z: 1.3 } }], seq: 0, v: 1 });
    expect(JSON.parse(socks[0].sent[0])).toMatchObject({ t: 'chat', text: 'avant' });
    t.send({ t: 'chat', playerId: 'f', text: 'salut', at: 2 }); expect(JSON.parse(socks[0].sent[1])).toMatchObject({ t: 'chat', text: 'salut' });
    socks[0].recv({ t: 'chat', id: 'x1', from: 'u2u2-0000', text: 'coucou', at: 3 });
    expect(got).toEqual([{ t: 'chat', playerId: 'Joueur u2u2', text: 'coucou', at: 3 }]);
    expect(changed).toBeGreaterThan(0);
    t.disconnect(); expect(t.status).toBe('offline');
  });
  it('not signed in -> stops (no retry loop), status offline', async () => {
    const fetchFn = (async () => new Response(JSON.stringify(null))) as unknown as typeof fetch;
    const t = new LiveTransport(cfg, fetchFn, () => { throw new Error('no socket expected'); });
    t.attach({ location: () => 'beach', local: () => null, changed: () => {} });
    await t.connect('public:beach', 'p'); await flush(); await flush();
    expect(t.status).toBe('offline'); expect(t.lastError).toBe('not_signed_in'); t.disconnect();
  });
});
