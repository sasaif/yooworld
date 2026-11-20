import { describe, expect, it } from 'vitest';
import { BubbleDirector, type SayTarget } from '../src/game/social/bubbleDirector';
import { ChatStore } from '../src/game/social/ChatStore';
import { LocalChatService } from '../src/game/social/social';
import { SimTransport } from '../src/net/SimTransport';
import { say, setSayGate, world, makeChar } from '../src/game/world';

function rig(n: number, cap = 6) {
  let t = 1000; const now = () => t;
  const chars: Record<string, SayTarget & { x: number; z: number }> = { me: { x: 0, z: 0 } };
  for (let i = 1; i <= n; i++) chars['p' + i] = { x: i, z: 0 };
  const d = new BubbleDirector({ now, target: (id) => chars[id], locate: (id) => chars[id], selfId: () => 'me', config: { maxVisibleBubbles: cap, queueTtlMs: 5000, proximityBandM: 2 } });
  const showing = () => Object.entries(chars).filter(([, c]) => c.say && c.say.until > t).map(([id]) => id);
  return { d, chars, showing, tick: (ms: number) => { t += ms; d.update(); }, now };
}

describe('BubbleDirector: the cap is enforced in the rendering slots (say path)', () => {
  it('20 speakers at once: never more than the cap on screen, the rest wait, nothing is lost', () => {
    const r = rig(20, 6);
    for (let i = 1; i <= 20; i++) r.d.request('p' + i, 'hello ' + i, 4000);
    expect(r.showing()).toHaveLength(6);
    expect(r.d.snapshot().queued).toHaveLength(14);
    // nearest first (p1..p6 are within 0..6 m, bands of 2 m, then arrival order)
    expect(r.showing().sort()).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'p6'].sort());
    r.tick(4100); // first wave expires: the waiting messages get the freed slots
    expect(r.showing()).toHaveLength(6);
    expect(r.showing()).not.toContain('p1');
  });

  it('own message always shows, even when the screen is full', () => {
    const r = rig(8, 3);
    for (let i = 1; i <= 8; i++) r.d.request('p' + i, 'x', 5000);
    expect(r.d.request('me', 'moi', 5000)).toBe('shown');
    expect(r.showing()).toContain('me'); expect(r.showing()).toHaveLength(3);
  });

  it('a waiting message expires after queueTtlMs (history-only), same speaker replaces its own text', () => {
    const r = rig(3, 1);
    r.d.request('p1', 'a', 9000); r.d.request('p2', 'b', 9000);
    expect(r.showing()).toEqual(['p1']);
    r.d.request('p1', 'a2', 9000);
    expect(r.chars.p1.say?.text).toBe('a2');
    r.tick(5100);
    expect(r.d.snapshot().expiredUnshown).toBe(1);
    expect(r.d.snapshot().queued).toEqual([]);
  });

  it('world.say() goes through the gate when installed (gameplay lines count toward the cap too)', () => {
    world.chars.zz1 = makeChar('zz1', 'A', 0, 0); world.chars.zz2 = makeChar('zz2', 'B', 1, 0);
    const d = new BubbleDirector({ target: (id) => world.chars[id], locate: (id) => world.chars[id]?.pos, selfId: () => 'zz1', config: { maxVisibleBubbles: 1, queueTtlMs: 5000, proximityBandM: 2 } });
    setSayGate((id, t, ms) => { d.request(id, t, ms); });
    try {
      say('zz2', 'premier', 5000); say('zz1', 'moi', 5000);
      expect(world.chars.zz1.say?.text).toBe('moi');
      expect(world.chars.zz2.say).toBeUndefined(); // bumped by the own message, waits (its text is in history)
    } finally { setSayGate(null); delete world.chars.zz1; delete world.chars.zz2; }
  });

  it('LOCAL SIMULATION: 20 simulated senders x 120 messages -> history keeps all, visible <= cap, no duplicate on replay', () => {
    const net = new SimTransport();
    const chat = new ChatStore(new LocalChatService(net));
    const r = rig(20, 6);
    chat.onMessage((m) => r.d.request(m.from, m.text, 4000));
    let maxShown = 0;
    for (let i = 0; i < 120; i++) {
      net.receive({ t: 'chat', playerId: 'p' + ((i % 20) + 1), text: 'm' + i, at: 10_000 + i, id: 'net-' + i });
      maxShown = Math.max(maxShown, r.showing().length);
    }
    expect(maxShown).toBeLessThanOrEqual(6);
    expect(chat.history()).toHaveLength(120);
    // reconnect: the server replays the last 30 with the same ids
    for (let i = 90; i < 120; i++) net.receive({ t: 'chat', playerId: 'p' + ((i % 20) + 1), text: 'm' + i, at: 10_000 + i, id: 'net-' + i });
    expect(chat.history()).toHaveLength(120);
    expect(new Set(chat.history().map((m) => m.id)).size).toBe(120);
    expect(net.status).toBe('offline'); // a simulation never claims to be online
  });
});
