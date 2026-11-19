import { describe, expect, it } from 'vitest';
import { LocalGameHost, type HostClock } from '../src/minigames/LocalGameHost';
import { LocalLobbyService } from '../src/minigames/lobby';
import { dominoes, fullSet, type DominoMove, type DominoState, type DominoView } from '../src/minigames/dominoes/rules';
import { dominoBot } from '../src/minigames/dominoes/bot';
import { chainLayout } from '../src/ui/club/chainLayout';
import { BOT_LOOKS, botLooks } from '../src/game/club/botAvatars';
import { ITEMS } from '../src/fashion/catalogue';
import { REQUIRED_SLOTS } from '../src/fashion/look';

function fakeClock() {
  let t = 0; let q: { at: number; fn: () => void; id: number }[] = []; let id = 0;
  const c: HostClock & { tick(ms: number): void; pending(): number } = {
    now: () => t, setTimeout: (fn, ms) => { q.push({ at: t + ms, fn, id: ++id }); return id; }, clearTimeout: (h) => { q = q.filter((x) => x.id !== h); },
    tick(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); } t = end; },
    pending: () => q.length,
  };
  return c;
}
function table(seats: number, seed: number) {
  const clock = fakeClock(); const L = new LocalLobbyService(clock.now);
  const room = L.fillWithBots(L.create({ gameId: 'dominoes', tableId: 't', seatCount: seats, host: { kind: 'human', id: 'me', name: 'Moi' }, options: { mode: 'points' } }).roomId);
  const bots = Object.fromEntries(room.seats.filter((s) => s.occupant?.kind === 'bot').map((s, k) => [s.index, dominoBot(k + 1)]));
  const host = new LocalGameHost<DominoState, DominoMove, DominoView>(dominoes, room, { seed, bots, botDelayMs: 300, clock, options: { mode: 'points', target: 100 } });
  return { clock, host };
}
/** play the human seat until a bot is about to move */
function untilBotTurn(h: LocalGameHost<DominoState, DominoMove, DominoView>) {
  for (let i = 0; i < 50 && h.thinking === null && !h.result; i++) { const s = h.state; if (s.phase === 'roundOver') h.advance(); else h.submit(0, h.legal(0)[0]); }
}

describe('LocalGameHost pause / resume / stop (leaving the table safely)', () => {
  it('pause during a bot turn: no timer, no move, human moves refused; resume plays on', () => {
    const { clock, host } = table(4, 77); host.start(); untilBotTurn(host);
    expect(host.thinking).not.toBeNull(); const seq = host.engine.seq;
    host.pause(); expect(host.isPaused).toBe(true); expect(host.hasTimer).toBe(false); expect(host.thinking).toBeNull(); expect(clock.pending()).toBe(0);
    clock.tick(5000); expect(host.engine.seq).toBe(seq);
    expect(host.submit(0, { type: 'pass' }).ok).toBe(false); expect(host.advance().ok).toBe(false);
    host.resume(); expect(host.hasTimer).toBe(true); clock.tick(300); expect(host.engine.seq).toBeGreaterThan(seq);
  });
  it('stop while paused / between rounds leaves no timer and refuses everything after', () => {
    for (const seed of [3, 11, 29]) {
      const { clock, host } = table(3, seed); host.start();
      // play to the end of the first round
      for (let i = 0; i < 400 && host.state.phase === 'playing'; i++) { if (host.thinking !== null) clock.tick(300); else host.submit(0, host.legal(0)[0]); }
      if (host.state.phase === 'roundOver') { host.pause(); host.stop(); expect(host.result?.endedBy).toBe('abandon'); }
      else { host.stop(); }
      expect(clock.pending()).toBe(0); expect(host.hasTimer).toBe(false); expect(host.isStopped).toBe(true);
      host.resume(); expect(host.hasTimer).toBe(false); expect(host.advance().ok).toBe(false); expect(host.submit(0, { type: 'pass' }).ok).toBe(false);
    }
  });
});

describe('domino line layout (readable on phones)', () => {
  const longLine = () => { // a legal-looking 28-tile line (values only matter for the doubles count)
    return fullSet().map(([a, b]) => ({ a, b }));
  };
  for (const [dev, w] of [['iPhone SE', 667], ['iPhone 15', 852]] as const) {
    const strip = w - 16 - 16 - 2 * 62; // same arithmetic as ClubOverlay's Line
    it(`${dev}: every line length 1..28 fits at ≥ 16 px per half-tile in ≤ 3 rows, never wider than the strip`, () => {
      const all = longLine();
      for (let n = 1; n <= 28; n++) {
        const L = chainLayout(all.slice(0, n), strip, { max: 22, pref: 18, min: 16, maxRows: 3 });
        expect(L.fits).toBe(true); expect(L.size).toBeGreaterThanOrEqual(16); expect(L.rows.length).toBeLessThanOrEqual(3);
        expect(L.width).toBeLessThanOrEqual(strip); expect(L.rows.flatMap((r) => r.cells).map((c) => c.idx)).toEqual([...Array(n).keys()]);
      }
    });
    it(`${dev}: 20+ tiles snake with large tiles (no shrinking to a thin strip)`, () => {
      const L = chainLayout(longLine().slice(0, 24), strip, { max: 22, pref: 18, min: 16, maxRows: 3 });
      expect(L.size).toBeGreaterThanOrEqual(18); expect(L.rows.length).toBeGreaterThanOrEqual(2); expect(L.height).toBeLessThanOrEqual(3 * 44 + 8);
    });
  }
  it('snake rows: odd rows run right-to-left with flipped tiles so touching halves still match', () => {
    const line = [{ a: 6, b: 6 }, { a: 6, b: 3 }, { a: 3, b: 1 }, { a: 1, b: 5 }, { a: 5, b: 2 }, { a: 2, b: 2 }, { a: 2, b: 4 }];
    const L = chainLayout(line, 120, { max: 20, pref: 16, min: 16, maxRows: 4 });
    expect(L.rows.length).toBeGreaterThan(1);
    const r1 = L.rows[1]; expect(r1.reverse).toBe(true);
    for (const c of r1.cells) { const t = line[c.idx]; expect([c.a, c.b]).toEqual([t.b, t.a]); }
    expect(L.rows[0].cells.every((c) => c.a === line[c.idx].a)).toBe(true);
  });
  it('iPhone SE preset (short screens: max 19 px) still fits 28 tiles at ≥ 16 px in ≤ 3 rows', () => {
    const L = chainLayout(fullSet().map(([a, b]) => ({ a, b })), 667 - 16 - 16 - 124, { max: 19, pref: 17, min: 16, maxRows: 3 });
    expect(L.fits).toBe(true); expect(L.size).toBeGreaterThanOrEqual(16); expect(L.rows.length).toBeLessThanOrEqual(3);
  });
  it('empty line', () => { expect(chainLayout([], 400)).toMatchObject({ rows: [], fits: true }); });
});

describe('bot avatars: catalogue looks, display only', () => {
  it('every preset uses existing catalogue items on the right body and fills the required slots', () => {
    for (const l of BOT_LOOKS) {
      for (const s of REQUIRED_SLOTS) expect(l.slots[s], s).toBeTruthy();
      for (const [slot, id] of Object.entries(l.slots)) { const it = ITEMS[id!]; expect(it, id).toBeTruthy(); expect(it.slot).toBe(slot); if (it.body) expect(it.body).toBe(l.body); }
      expect(['hair_buns', 'hair_pony', 'hair_pigtails', 'hair_manbun']).not.toContain(l.slots.hair); // no extra hair-tie meshes (draw calls)
      expect(Object.keys(l.slots).some((k) => k.startsWith('acc.'))).toBe(false);
    }
  });
  it('a table gets different looks, varied by seed', () => {
    for (let seed = 0; seed < 20; seed++) { const ls = botLooks(3, seed); expect(new Set(ls).size).toBe(3); }
    expect(botLooks(3, 1)[0]).not.toBe(botLooks(3, 2)[0]);
  });
});
