// U5 (client, ?net=1 only): act on the server's 'session_revoked' / 'ws_lifetime' message immediately (browsers fire
// onclose seconds after the 4401/4402 close frame): offline, remotes purged, no sending, socket closed, idempotent.
import { describe, it, expect } from 'vitest';
import { Reconnector, LIFETIME_MAX, type WsLike } from '../src/net/live/Reconnector';
import { LiveTransport } from '../src/net/live/LiveTransport';

class FakeWs implements WsLike {
  readyState = 0; closed: number | null = null; sent: string[] = [];
  onopen: WsLike['onopen'] = null; onmessage: WsLike['onmessage'] = null; onclose: WsLike['onclose'] = null; onerror: WsLike['onerror'] = null;
  send(d: string) { this.sent.push(d); } close(code = 1000) { this.closed = code; }
  open() { this.readyState = 1; this.onopen?.(null); }
  msg(m: unknown) { this.onmessage?.({ data: JSON.stringify(m) }); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const mkRc = (o: { now?: () => number } = {}) => {
  const timers: { fn: () => void; ms: number }[] = []; const sockets: FakeWs[] = []; const states: string[] = [];
  const rc = new Reconnector({ open: async () => { const w = new FakeWs(); sockets.push(w); return w; }, onMessage: () => {}, onState: (s, why) => states.push(`${s}:${why ?? ''}`),
    random: () => 1, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}, now: o.now });
  return { rc, timers, sockets, states };
};

describe('Reconnector.abort', () => {
  it("'revoked': stops at once, closes the socket client-side; the late onclose(4401) is ignored (no double handling)", async () => {
    const { rc, timers, sockets, states } = mkRc();
    rc.start(); await flush(); const w = sockets[0]; w.open();
    rc.abort('revoked');
    expect(rc.state).toBe('stopped'); expect(rc.why).toBe('revoked'); expect(w.closed).toBe(1000);
    const n = states.length;
    w.drop(4401); rc.abort('revoked'); await flush();                 // late close frame + duplicate message
    expect(states.length).toBe(n); expect(timers).toHaveLength(0); expect(sockets).toHaveLength(1);
    expect(rc.send('x')).toBe(false);
  });
  it("'lifetime': drops the socket and reconnects promptly with a fresh open(); the old onclose(4402) is ignored", async () => {
    const { rc, timers, sockets } = mkRc();
    rc.start(); await flush(); sockets[0].open();
    rc.abort('lifetime');
    expect(rc.state).toBe('waiting'); expect(sockets[0].closed).toBe(1000); expect(timers).toHaveLength(1); expect(timers[0].ms).toBe(500);
    sockets[0].drop(4402); expect(timers).toHaveLength(1);           // no second retry
    timers[0].fn(); await flush(); sockets[1].open(); expect(rc.state).toBe('open'); expect(sockets).toHaveLength(2);
  });
  it('lifetime loop guard: more than LIFETIME_MAX lifetime closes within a minute -> stop (no reconnect loop)', async () => {
    let t = 0; const { rc, timers, sockets } = mkRc({ now: () => t });
    rc.start(); await flush();
    for (let i = 0; i <= LIFETIME_MAX; i++) {
      sockets.at(-1)!.open(); t += 1000;
      if (i % 2) rc.abort('lifetime'); else sockets.at(-1)!.drop(4402);
      if (rc.state === 'stopped') break;
      timers.at(-1)!.fn(); await flush();
    }
    expect(rc.state).toBe('stopped'); expect(rc.why).toBe('lifetime_loop');
  });
  it('a lifetime close an hour later is normal (window): reconnects', async () => {
    let t = 0; const { rc, timers, sockets } = mkRc({ now: () => t });
    rc.start(); await flush();
    for (let i = 0; i < 6; i++) { sockets.at(-1)!.open(); t += 3_600_000; sockets.at(-1)!.drop(4402); expect(rc.state).toBe('waiting'); timers.at(-1)!.fn(); await flush(); }
  });
});

describe('LiveTransport on session_revoked (U5)', () => {
  const setup = async (signedInAfter: boolean) => {
    let session = true; const sockets: FakeWs[] = []; const calls: string[] = [];
    const fetchFn = (async (u: string) => {
      const path = new URL(u).pathname; calls.push(path);
      const body = path === '/api/auth/get-session' ? (session ? { user: { id: 'me' } } : null) : { ticket: 't', room: 'local:beach:0' };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as unknown as typeof fetch;
    const t = new LiveTransport({ server: 'http://127.0.0.1:8787', ws: 'ws://127.0.0.1:8787' }, fetchFn, () => { const w = new FakeWs(); sockets.push(w); return w; });
    let changed = 0; t.attach({ location: () => 'beach', local: () => ({ x: 1, z: 1 }), changed: () => { changed++; } });
    await t.connect('r', 'p'); await flush(); await flush();
    const w = sockets[0]; w.open();
    w.msg({ t: 'welcome', you: 'me', players: [{ id: 'me', pos: { x: 1, z: 1 } }, { id: 'other', pos: { x: 2, z: 2 } }], seq: 0, v: 1 });
    expect(t.status).toBe('online'); expect(t.sync.remotes.size).toBe(1);
    session = signedInAfter;
    return { t, w, sockets, calls, changed: () => changed };
  };
  it('offline + remotes purged + socket closed + presence sending stopped, synchronously on the message; no reconnect', async () => {
    const { t, w, sockets, calls } = await setup(false);
    const c0 = calls.length;
    w.msg({ t: 'error', code: 'session_revoked' });
    expect(t.status).toBe('offline'); expect(t.sync.remotes.size).toBe(0); expect(t.sync.you).toBeNull(); expect(w.closed).toBe(1000);
    expect((t as any).timer).toBeNull();                              // presence/movement tick stopped
    w.drop(4401); await flush(); await flush();
    expect(t.status).toBe('offline'); expect(sockets).toHaveLength(1);
    expect(calls.slice(c0)).toEqual(['/api/auth/get-session']);       // only the "signed out?" check, no new ticket
    t.disconnect();
  });
  it("'ws_lifetime' message: drop + prompt reconnect (not a revocation)", async () => {
    const { t, w } = await setup(true);
    w.msg({ t: 'error', code: 'ws_lifetime' });
    expect(t.status).toBe('connecting'); expect(t.sync.remotes.size).toBe(0); expect(w.closed).toBe(1000);
    t.disconnect();
  });
});
