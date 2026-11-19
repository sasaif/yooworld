import { describe, expect, it } from 'vitest';
import { dominoes, findOpener, fullSet, handSize, pips, ends, type DominoMove, type DominoState, type Tile } from '../src/minigames/dominoes/rules';
import { dominoBot } from '../src/minigames/dominoes/bot';
import { makeRng } from '../src/minigames/rng';
import { RulesError } from '../src/minigames/types';

const R = dominoes;
/** hand-built state for precise rule checks */
function st(p: Partial<DominoState>): DominoState {
  return { v: 1, game: 'dominoes', seats: 2, options: { mode: 'single', target: 100 }, rng: 1, round: 1, hands: [[], []], boneyard: [], line: [], turn: 0, passes: 0, opener: null, scores: [0, 0], phase: 'playing', rounds: [], ...p };
}
const play = (tile: Tile, end: 'L' | 'R'): DominoMove => ({ type: 'play', tile, end });
const line = (...t: [number, number][]) => t.map(([a, b]) => ({ a, b, by: 0 }));

describe('dominoes: set and deal', () => {
  it('double-six set has 28 distinct tiles, 168 pips', () => {
    const s = fullSet(); expect(s).toHaveLength(28); expect(new Set(s.map((t) => t.join())).size).toBe(28); expect(pips(s)).toBe(168);
  });
  it.each([2, 3, 4])('%i players: hand sizes, boneyard, every tile dealt exactly once', (n) => {
    const s = R.setup(n, 42);
    expect(s.hands.every((h) => h.length === handSize(n))).toBe(true);
    expect(s.boneyard).toHaveLength(28 - n * handSize(n));
    const all = [...s.hands.flat(), ...s.boneyard].map((t) => [...t].sort().join());
    expect(new Set(all).size).toBe(28);
  });
  it('deterministic: same seed → same deal; different seed → different deal', () => {
    expect(R.setup(4, 7)).toEqual(R.setup(4, 7));
    expect(R.setup(4, 7).hands).not.toEqual(R.setup(4, 8).hands);
  });
  it('rejects 1 or 5 seats and bad options', () => {
    expect(() => R.setup(1, 1)).toThrow(RulesError); expect(() => R.setup(5, 1)).toThrow(RulesError);
    expect(() => R.setup(2, 1, { target: 0 })).toThrow(RulesError);
  });
});

describe('dominoes: opening', () => {
  it('highest double opens', () => {
    expect(findOpener([[[1, 2], [5, 5]], [[3, 3], [6, 4]]])).toEqual({ seat: 0, tile: [5, 5] });
  });
  it('no double anywhere: heaviest tile opens (pips, then higher end)', () => {
    expect(findOpener([[[1, 2], [6, 3]], [[4, 5], [0, 1]]])).toEqual({ seat: 0, tile: [6, 3] });
  });
  it('first move is forced to the opener tile', () => {
    const s = R.setup(4, 3); const seat = R.currentSeat(s)!;
    expect(R.legalMoves(s, seat)).toEqual([{ type: 'play', tile: s.opener, end: 'R' }]);
    for (let o = 0; o < 4; o++) if (o !== seat) expect(R.legalMoves(s, o)).toEqual([]);
  });
});

describe('dominoes: legal moves', () => {
  it('matches either open end, both ends listed when different', () => {
    const s = st({ line: line([6, 6], [6, 3]), hands: [[[3, 1], [6, 2], [0, 0]], [[1, 1]]] });
    const m = R.legalMoves(s, 0);
    expect(m).toContainEqual(play([3, 1], 'R')); expect(m).toContainEqual(play([6, 2], 'L')); expect(m).toHaveLength(2);
  });
  it('equal ends: one move per tile (no duplicate L/R)', () => {
    const s = st({ line: line([4, 4]), hands: [[[4, 2]], []] });
    expect(R.legalMoves(s, 0)).toEqual([play([4, 2], 'L')]);
  });
  it('cannot play → must draw while the boneyard has tiles', () => {
    const s = st({ line: line([6, 6]), hands: [[[1, 2]], [[0, 0]]], boneyard: [[5, 6], [0, 1]] });
    expect(R.legalMoves(s, 0)).toEqual([{ type: 'draw' }]);
    const d = R.apply(s, 0, { type: 'draw' });
    expect(d.hands[0]).toEqual([[1, 2], [5, 6]]); expect(d.boneyard).toEqual([[0, 1]]); expect(d.turn).toBe(0);
    expect(R.legalMoves(d, 0)).toEqual([play([5, 6], 'L')]);
  });
  it('cannot play, empty boneyard → pass', () => {
    const s = st({ line: line([6, 6]), hands: [[[1, 2]], [[6, 0]]] });
    expect(R.legalMoves(s, 0)).toEqual([{ type: 'pass' }]);
    const p = R.apply(s, 0, { type: 'pass' }); expect(p.turn).toBe(1); expect(p.passes).toBe(1);
  });
  it('drawing or passing is illegal when a tile can be played', () => {
    const s = st({ line: line([6, 6]), hands: [[[6, 1]], []], boneyard: [[0, 0]] });
    expect(() => R.apply(s, 0, { type: 'draw' })).toThrow(RulesError);
    expect(() => R.apply(s, 0, { type: 'pass' })).toThrow(RulesError);
  });
  it('wrong seat, unknown tile, wrong end are rejected; state is never mutated', () => {
    const s = st({ line: line([6, 3]), hands: [[[3, 2], [5, 5]], [[6, 6]]] }); const snap = JSON.stringify(s);
    expect(() => R.apply(s, 1, play([6, 6], 'L'))).toThrow('not_your_turn');
    expect(() => R.apply(s, 0, play([5, 5], 'L'))).toThrow('illegal_move');
    expect(() => R.apply(s, 0, play([3, 2], 'L'))).toThrow('illegal_move');
    expect(() => R.apply(s, 0, play([4, 4], 'R'))).toThrow('illegal_move');
    R.apply(s, 0, play([3, 2], 'R')); expect(JSON.stringify(s)).toBe(snap);
  });
  it('tiles are oriented so neighbours match; ends update', () => {
    const s = st({ line: line([6, 3]), hands: [[[2, 3], [6, 1]], [[0, 0], [1, 1]]] });
    const a = R.apply(s, 0, play([2, 3], 'R')); expect(a.line[1]).toMatchObject({ a: 3, b: 2 }); expect(ends(a.line)).toEqual([6, 2]);
    const b = R.apply({ ...a, turn: 0 }, 0, play([6, 1], 'L')); expect(b.line[0]).toMatchObject({ a: 1, b: 6 }); expect(ends(b.line)).toEqual([1, 2]);
  });
});

describe('dominoes: end of round and scoring', () => {
  it('"Domino!": last tile wins the round, scores the opponents\' pips', () => {
    const s = st({ seats: 3, scores: [0, 0, 0], line: line([6, 6]), hands: [[[6, 2]], [[5, 4], [1, 0]], [[3, 3]]] });
    const e = R.apply(s, 0, play([6, 2], 'L'));
    expect(e.phase).toBe('matchOver'); expect(e.rounds[0]).toMatchObject({ winner: 0, reason: 'domino', points: 16, pips: [0, 10, 6] });
    expect(e.scores).toEqual([16, 0, 0]); expect(R.isOver(e)).toBe(true); expect(R.currentSeat(e)).toBeNull();
    expect(R.result(e)).toEqual({ ranking: [0, 2, 1], scores: [16, 0, 0], winners: [0] });
  });
  it('blocked game: everyone passes with an empty boneyard → fewest pips wins and scores the others', () => {
    let s = st({ seats: 2, line: line([6, 6]), hands: [[[1, 2]], [[3, 4], [0, 1]]] });
    s = R.apply(s, 0, { type: 'pass' }); expect(s.phase).toBe('playing');
    s = R.apply(s, 1, { type: 'pass' });
    expect(s.phase).toBe('matchOver'); expect(s.rounds[0]).toMatchObject({ winner: 0, reason: 'blocked', points: 8, pips: [3, 8] });
    expect(R.result(s).winners).toEqual([0]);
  });
  it('blocked game with a tie on the lowest count: drawn round, nobody scores', () => {
    let s = st({ seats: 2, line: line([6, 6]), hands: [[[1, 2]], [[0, 3]]] });
    s = R.apply(R.apply(s, 0, { type: 'pass' }), 1, { type: 'pass' });
    expect(s.rounds[0]).toMatchObject({ winner: null, points: 0 }); expect(s.scores).toEqual([0, 0]); expect(R.result(s).winners).toEqual([]);
  });
  it('a play resets the pass counter', () => {
    let s = st({ seats: 3, scores: [0, 0, 0], line: line([6, 6]), hands: [[[1, 2]], [[6, 0], [2, 2]], [[4, 4]]] });
    s = R.apply(s, 0, { type: 'pass' }); s = R.apply(s, 1, play([6, 0], 'L')); expect(s.passes).toBe(0);
  });
  it('points mode: rounds continue until the target, then the match is over', () => {
    let s = st({ options: { mode: 'points', target: 20 }, line: line([6, 6]), hands: [[[6, 2]], [[5, 4], [1, 0]]] });
    s = R.apply(s, 0, play([6, 2], 'L'));
    expect(s.phase).toBe('roundOver'); expect(s.scores).toEqual([10, 0]); expect(R.currentSeat(s)).toBeNull(); expect(R.isOver(s)).toBe(false);
    const n = R.advance!(s); expect(n.round).toBe(2); expect(n.phase).toBe('playing'); expect(n.scores).toEqual([10, 0]); expect(n.line).toEqual([]);
    expect(n.hands.flat().length + n.boneyard.length).toBe(28);
    expect(() => R.advance!(n)).toThrow(RulesError);
    const fin = R.apply(st({ options: { mode: 'points', target: 20 }, scores: [10, 0], line: line([6, 6]), hands: [[[6, 2]], [[5, 6]]] }), 0, play([6, 2], 'L'));
    expect(fin.phase).toBe('matchOver'); expect(fin.scores).toEqual([21, 0]);
  });
  it('view hides opponents\' hands and the boneyard order', () => {
    const s = R.setup(4, 5); const v = R.viewFor(s, 2);
    expect(v.hand).toEqual(s.hands[2]); expect(v.handCounts).toEqual([5, 5, 5, 5]); expect(v.boneyard).toBe(8);
    expect(JSON.stringify(v)).not.toContain('"hands"');
    expect(R.viewFor(s, 'spectator').hand).toEqual([]);
  });
  it('state is JSON-serializable (round trip keeps the game identical)', () => {
    const s = R.setup(3, 99); const t = JSON.parse(JSON.stringify(s)) as DominoState;
    expect(t).toEqual(s); const seat = R.currentSeat(t)!; expect(R.apply(t, seat, R.legalMoves(t, seat)[0])).toEqual(R.apply(s, seat, R.legalMoves(s, seat)[0]));
  });
});

describe('dominoes: bots and full games (fuzz)', () => {
  it('bot prefers the heaviest tile, doubles on a tie, and only returns given moves', () => {
    const b = dominoBot(1); const rng = makeRng(1);
    const legal: DominoMove[] = [play([1, 2], 'L'), play([3, 3], 'R'), play([6, 0], 'L')];
    expect(b.pick({} as never, legal, rng)).toEqual(play([3, 3], 'R'));
    expect(b.pick({} as never, [{ type: 'draw' }], rng)).toEqual({ type: 'draw' });
  });
  it('300 seeded bot-only games (2–4 seats, both modes) always end, bots always play legal moves, tiles are conserved', () => {
    let blocked = 0, domino = 0;
    for (let g = 0; g < 300; g++) {
      const seats = 2 + (g % 3); const mode = g % 2 ? 'single' : 'points';
      let s = R.setup(seats, g * 7919 + 1, { mode, target: 60 }); const rng = makeRng(g);
      const bots = Array.from({ length: seats }, (_, i) => dominoBot(i + 1));
      for (let step = 0; !R.isOver(s); step++) {
        expect(step).toBeLessThan(5000);
        const seat = R.currentSeat(s);
        if (seat === null) { s = R.advance!(s); continue; }
        const legal = R.legalMoves(s, seat); expect(legal.length).toBeGreaterThan(0);
        const m = bots[seat].pick(R.viewFor(s, seat), legal, rng);
        expect(legal.some((x) => R.sameMove(x, m))).toBe(true);
        s = R.apply(s, seat, m);
        if (s.phase === 'playing') {
          expect(s.hands.flat().length + s.boneyard.length + s.line.length).toBe(28);
          for (let i = 1; i < s.line.length; i++) expect(s.line[i].a).toBe(s.line[i - 1].b);
        }
      }
      for (const r of s.rounds) r.reason === 'blocked' ? blocked++ : domino++;
      const res = R.result(s); expect([...res.ranking].sort()).toEqual([...Array(seats).keys()]);
      if (mode === 'points') expect(Math.max(...s.scores)).toBeGreaterThanOrEqual(60);
    }
    expect(domino).toBeGreaterThan(0); expect(blocked).toBeGreaterThan(0);
  });
});
