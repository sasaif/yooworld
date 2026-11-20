// M4 client (?net=1 only): server-driven reconnects (4401 revoked, 4402 lifetime), HUD player count, remote avatars.
import { describe, it, expect } from 'vitest';
import { Reconnector, FatalOpenError, type WsLike } from '../src/net/live/Reconnector';
import { remoteLookIndex, remoteTarget, onlinePlayers, REMOTE_SNAP_M } from '../src/net/live/remoteAvatar';
import { netBadge } from '../src/net/netStatus';

class FakeWs implements WsLike {
  readyState = 0; closed: number | null = null;
  onopen: WsLike['onopen'] = null; onmessage: WsLike['onmessage'] = null; onclose: WsLike['onclose'] = null; onerror: WsLike['onerror'] = null;
  send() {} close(code = 1000) { this.closed = code; }
  open() { this.readyState = 1; this.onopen?.(null); }
  drop(code: number) { this.readyState = 3; this.onclose?.({ code, reason: '' }); }
}
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Reconnector and server-side closes (M4)', () => {
  it('4402 lifetime: reconnects promptly with a FRESH open() (new ticket); 4401 revoked + signed out: stops', async () => {
    const timers: { fn: () => void; ms: number }[] = []; const sockets: FakeWs[] = []; let signedIn = true; let opens = 0;
    const rc = new Reconnector({
      open: async () => { opens++; if (!signedIn) throw new FatalOpenError('not_signed_in'); const w = new FakeWs(); sockets.push(w); return w; },
      onMessage: () => {}, random: () => 1, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {},
    });
    rc.start(); await flush(); sockets[0].open(); expect(rc.state).toBe('open');
    sockets[0].drop(4402);                                         // lifetime cap reached
    expect(rc.state).toBe('waiting'); expect(rc.why).toBe('closed_4402');
    expect(timers.at(-1)!.ms).toBe(500);                           // first retry: base delay, not a long backoff
    timers.at(-1)!.fn(); await flush(); sockets[1].open();
    expect(opens).toBe(2); expect(sockets).toHaveLength(2); expect(rc.state).toBe('open');
    signedIn = false; sockets[1].drop(4401);                       // session revoked: the next open() finds no session
    expect(rc.why).toBe('closed_4401');
    timers.at(-1)!.fn(); await flush();
    expect(rc.state).toBe('stopped'); expect(rc.why).toBe('not_signed_in'); expect(opens).toBe(3);
  });
});
describe('HUD count + remote avatars (pure helpers)', () => {
  it('online count = me + remotes, only once welcomed; badge pluralises', () => {
    expect(onlinePlayers({ you: null, remotes: { size: 3 } })).toBe(0);
    expect(onlinePlayers({ you: 'me', remotes: { size: 0 } })).toBe(1);
    expect(onlinePlayers({ you: 'me', remotes: { size: 24 } })).toBe(25);
    expect(netBadge('online', 1).label).toBe('En ligne · 1 joueur');
    expect(netBadge('online', 25).label).toBe('En ligne · 25 joueurs');
    expect(netBadge('offline')).toEqual(netBadge('offline', 0));  // flag off path unchanged
  });
  it('look index is stable and in range; target: walk / run / snap thresholds', () => {
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const idx = ids.map((id) => remoteLookIndex(id, 12));
    expect(idx.every((i) => i >= 0 && i < 12)).toBe(true);
    expect(new Set(idx).size).toBeGreaterThan(8);                  // spread over the looks
    expect(ids.map((id) => remoteLookIndex(id, 12))).toEqual(idx); // deterministic
    expect(remoteTarget(0, 0, 0.01, 0)).toMatchObject({ move: false, run: false, snap: false });
    expect(remoteTarget(0, 0, 1, 0)).toMatchObject({ move: true, run: false, snap: false });
    expect(remoteTarget(0, 0, 3, 0)).toMatchObject({ move: true, run: true, snap: false });
    expect(remoteTarget(0, 0, REMOTE_SNAP_M + 0.1, 0)).toMatchObject({ snap: true });
  });
});
