import { describe, expect, it } from 'vitest';
import { advanceEngine, checkTimeout, createEngine, submitMove } from '../src/minigames/turnEngine';
import { LocalGameHost, type HostClock } from '../src/minigames/LocalGameHost';
import { LocalLobbyService } from '../src/minigames/lobby';
import { dominoes, type DominoMove, type DominoState, type DominoView } from '../src/minigames/dominoes/rules';
import { dominoBot } from '../src/minigames/dominoes/bot';
import { GAMES, LOCAL_BADGE } from '../src/minigames/registry';
import { RulesError, type GameRules } from '../src/minigames/types';

/** Manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let t = 0; let q: { at: number; fn: () => void; id: number }[] = []; let id = 0;
  const c: HostClock & { tick(ms: number): void; pending(): number } = {
    now: () => t, setTimeout: (fn, ms) => { q.push({ at: t + ms, fn, id: ++id }); return id; }, clearTimeout: (h) => { q = q.filter((x) => x.id !== h); },
    tick(ms) { const end = t + ms; for (;;) { q.sort((a, b) => a.at - b.at); const n = q[0]; if (!n || n.at > end) break; q.shift(); t = n.at; n.fn(); } t = end; },
    pending: () => q.length,
  };
  return c;
}
/** Tiny counting game to test the engine independently of dominoes. */
const count: GameRules<{ n: number; turn: number; seats: number }, number> = {
  id: 'count', seats: { min: 2, max: 3 },
  setup: (seats) => ({ n: 0, turn: 0, seats }),
  currentSeat: (s) => (s.n >= 5 ? null : s.turn), legalMoves: (s, seat) => (s.n < 5 && seat === s.turn ? [1, 2] : []),
  apply: (s, _seat, m) => ({ ...s, n: s.n + m, turn: (s.turn + 1) % s.seats }),
  viewFor: (s) => s, isOver: (s) => s.n >= 5, result: (s) => ({ ranking: [0, 1], scores: [s.n, 0], winners: [] }),
  timeoutMove: () => 1, sameMove: (a, b) => a === b,
};

describe('turn engine', () => {
  it('validates seat, legality, game over and seq; logs moves with an increasing seq', () => {
    let e = createEngine(count, 2, 1);
    expect(() => createEngine(count, 4, 1)).toThrow(RulesError);
    expect(submitMove(count, e, 1, 1)).toMatchObject({ ok: false, error: 'not_your_turn' });
    expect(submitMove(count, e, 0, 3)).toMatchObject({ ok: false, error: 'illegal_move' });
    expect(submitMove(count, e, 0, 1, { expectSeq: 4 })).toMatchObject({ ok: false, error: 'stale_seq' });
    for (const [seat, m] of [[0, 2], [1, 2], [0, 1]] as const) { const r = submitMove(count, e, seat, m, { expectSeq: e.seq }); expect(r.ok).toBe(true); e = r.engine; }
    expect(e.seq).toBe(3); expect(e.log.map((l) => l.seq)).toEqual([1, 2, 3]);
    expect(submitMove(count, e, 1, 1)).toMatchObject({ ok: false, error: 'game_over' });
    expect(advanceEngine(count, e)).toMatchObject({ ok: false, error: 'game_over' });
  });
  it('turn timer: deadline per turn, timeout plays the rules\' timeout move', () => {
    const e = createEngine(count, 2, 1, { now: 1000, turnTimeoutMs: 5000 });
    expect(e.deadline).toBe(6000); expect(checkTimeout(count, e, 5999)).toBeNull();
    const r = checkTimeout(count, e, 6000)!; expect(r.ok).toBe(true); expect(r.engine.state.n).toBe(1); expect(r.engine.deadline).toBe(11000);
    expect(createEngine(count, 2, 1).deadline).toBeNull();
  });
  it('advance only between rounds (dominoes points mode)', () => {
    const e = createEngine(dominoes, 2, 3, { options: { mode: 'points', target: 100 } });
    expect(advanceEngine(dominoes, e)).toMatchObject({ ok: false, error: 'not_advanceable' });
  });
});

describe('local host + lobby', () => {
  it('lobby: create, join, fill with bots, table busy, leave closes the table', () => {
    const L = new LocalLobbyService(() => 0);
    const r = L.create({ gameId: 'dominoes', tableId: 't1', seatCount: 4, host: { kind: 'human', id: 'me', name: 'Juanita' } });
    expect(r.mode).toBe('local'); expect(r.seats[0].occupant?.id).toBe('me');
    expect(() => L.create({ gameId: 'dominoes', tableId: 't1', seatCount: 2, host: { kind: 'human', id: 'x', name: 'x' } })).toThrow('table_busy');
    expect(() => L.join(r.roomId, { kind: 'human', id: 'me', name: 'J' })).toThrow('already_seated');
    const f = L.fillWithBots(r.roomId); expect(f.seats.map((s) => s.occupant?.name)).toEqual(['Juanita', 'Bot 1', 'Bot 2', 'Bot 3']);
    expect(f.seats.every((s) => s.ready)).toBe(true);
    expect(() => L.join(r.roomId, { kind: 'human', id: 'y', name: 'y' }, 1)).toThrow('seat_taken');
    expect(L.leave(r.roomId, 'me')).toBeNull(); expect(L.list()).toEqual([]);
  });
  it.each([2, 3, 4])('1 human + %i bots: bots play by themselves, the human plays legal moves, the game reaches a result', (seats) => {
    const clock = fakeClock(); const L = new LocalLobbyService(clock.now);
    let room = L.create({ gameId: 'dominoes', tableId: 't', seatCount: seats, host: { kind: 'human', id: 'me', name: 'Moi' } });
    room = L.fillWithBots(room.roomId);
    const bots = Object.fromEntries(room.seats.filter((s) => s.occupant?.kind === 'bot').map((s, k) => [s.index, dominoBot(k + 1)]));
    const host = new LocalGameHost<DominoState, DominoMove, DominoView>(dominoes, room, { seed: 1234 + seats, bots, botDelayMs: 300, clock, options: { mode: 'points', target: 50 } });
    let emits = 0; host.subscribe(() => emits++); host.start();
    for (let i = 0; i < 4000 && !host.result; i++) {
      const seat = dominoes.currentSeat(host.state);
      if (seat === 0) { const m = host.legal(0)[0]; expect(host.submit(0, m).ok).toBe(true); }
      else if (seat === null) expect(host.advance().ok).toBe(true);
      else { expect(host.submit(seat, host.legal(seat)[0])).toMatchObject({ ok: false }); clock.tick(300); } // humans cannot play for a bot
    }
    expect(host.result).toMatchObject({ gameId: 'dominoes', endedBy: 'normal' });
    expect(host.result!.seats[0]).toMatchObject({ kind: 'human' }); expect(host.result!.moves).toBe(host.engine.log.length);
    expect(Math.max(...host.result!.scores)).toBeGreaterThanOrEqual(50); expect(emits).toBeGreaterThan(3); expect(clock.pending()).toBe(0);
    // no Gold / XP fields anywhere in the result
    expect(JSON.stringify(host.result)).not.toMatch(/gold|xp|reward|stake/i);
  });
  it('stop() = abandon: no winners, timers cleared, later moves refused', () => {
    const clock = fakeClock(); const L = new LocalLobbyService(clock.now);
    const room = L.fillWithBots(L.create({ gameId: 'dominoes', tableId: 't', seatCount: 2, host: { kind: 'human', id: 'me', name: 'Moi' } }).roomId);
    const host = new LocalGameHost(dominoes, room, { seed: 9, bots: { 1: dominoBot(1) }, clock }); host.start();
    host.stop(); expect(host.result).toMatchObject({ endedBy: 'abandon', winners: [] }); expect(clock.pending()).toBe(0);
    expect(host.submit(0, { type: 'pass' }).ok).toBe(false);
  });
  it('registry: Dominoes playable, others announced; honest local label', () => {
    expect(GAMES.filter((g) => g.status === 'playable').map((g) => g.id)).toEqual(['dominoes']);
    expect(LOCAL_BADGE).toBe('Mode local · contre des bots'); expect(LOCAL_BADGE).not.toMatch(/multi|en ligne|online/i);
  });
});
