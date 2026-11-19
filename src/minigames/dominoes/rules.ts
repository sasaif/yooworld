import { shuffle } from '../rng';
import { RulesError, type GameOutcome, type GameRules, type SeatIndex } from '../types';

/**
 * Dominoes — "Draw game" (block game with a boneyard) on a standard double-six set. Pure, deterministic, serializable.
 * Exact ruleset (also in docs/14-games-club-dominoes.md):
 *  1. Set: the 28 tiles 0-0 … 6-6. 2 players draw 7 tiles each, 3 or 4 players 5 tiles each; the rest is the boneyard.
 *  2. Opening: the player holding the highest double (6-6, else 5-5 …) starts and must lay that double. If nobody holds
 *     a double, the player holding the heaviest tile (most pips, then the higher end) starts with it. Same rule every round.
 *  3. Turn order: seat 0, 1, 2, 3 (clockwise around the table).
 *  4. On your turn you must lay a tile matching one of the two open ends of the line if you can.
 *     If you cannot, you draw one tile from the boneyard (repeat until you can play); when the boneyard is empty, you pass.
 *  5. Round ends when a player lays their last tile ("Domino!") or when the game is blocked (every player passes in a row
 *     with an empty boneyard).
 *  6. Round score: "Domino!" → that player scores the pips left in all opponents' hands. Blocked → the player with the
 *     fewest pips in hand wins the round and scores the pips of all the other hands; if the lowest count is tied, the
 *     round is drawn and nobody scores.
 *  7. Match: 'single' = one round; 'points' = rounds until a player reaches `target` (default 100) at the end of a round.
 *     Final ranking: score (high first), then pips left in the last round (low first), then seat order.
 * Points are table points only: no Gold, XP, reward or stake is attached to them.
 */
export type Tile = [number, number];
export interface PlacedTile { a: number; b: number; by: SeatIndex }
export type DominoMove = { type: 'play'; tile: Tile; end: 'L' | 'R' } | { type: 'draw' } | { type: 'pass' };
export interface DominoOptions { mode: 'single' | 'points'; target: number }
export interface RoundResult { round: number; winner: SeatIndex | null; reason: 'domino' | 'blocked'; points: number; pips: number[]; hands: Tile[][] }
export interface DominoState {
  v: 1; game: 'dominoes'; seats: number; options: DominoOptions;
  rng: number; round: number;
  hands: Tile[][]; boneyard: Tile[];
  /** the line, left to right; each tile oriented so that line[i].b === line[i+1].a */
  line: PlacedTile[];
  turn: SeatIndex;
  /** consecutive passes (blocked when it reaches `seats` with an empty boneyard) */
  passes: number;
  /** tile the opening move must use (null once the line has started) */
  opener: Tile | null;
  scores: number[];
  phase: 'playing' | 'roundOver' | 'matchOver';
  rounds: RoundResult[];
}
export interface DominoView {
  seat: SeatIndex | 'spectator'; seats: number; options: DominoOptions; round: number;
  hand: Tile[]; handCounts: number[]; boneyard: number;
  line: PlacedTile[]; ends: [number, number] | null;
  turn: SeatIndex | null; opener: Tile | null; scores: number[]; phase: DominoState['phase'];
  lastRound: RoundResult | null;
}

export const DEFAULT_OPTIONS: DominoOptions = { mode: 'points', target: 100 };
export const fullSet = (): Tile[] => { const s: Tile[] = []; for (let a = 0; a <= 6; a++) for (let b = a; b <= 6; b++) s.push([a, b]); return s; };
export const handSize = (seats: number) => (seats === 2 ? 7 : 5);
export const pips = (h: readonly Tile[]) => h.reduce((n, t) => n + t[0] + t[1], 0);
export const sameTile = (x: Tile, y: Tile) => (x[0] === y[0] && x[1] === y[1]) || (x[0] === y[1] && x[1] === y[0]);
export const isDouble = (t: Tile) => t[0] === t[1];
export function ends(line: readonly PlacedTile[]): [number, number] | null { return line.length ? [line[0].a, line[line.length - 1].b] : null; }

/** Opening seat + tile for freshly dealt hands (rule 2). */
export function findOpener(hands: Tile[][]): { seat: SeatIndex; tile: Tile } {
  for (let d = 6; d >= 0; d--) for (let s = 0; s < hands.length; s++) if (hands[s].some((t) => t[0] === d && t[1] === d)) return { seat: s, tile: [d, d] };
  let best: { seat: number; tile: Tile } | null = null; const w = (t: Tile) => (t[0] + t[1]) * 10 + Math.max(t[0], t[1]);
  hands.forEach((h, s) => h.forEach((t) => { if (!best || w(t) > w(best.tile)) best = { seat: s, tile: t }; }));
  if (!best) throw new RulesError('empty_hands'); return best;
}
function deal(seats: number, rng: number, round: number, scores: number[], options: DominoOptions, rounds: RoundResult[]): DominoState {
  const [set, r2] = shuffle(fullSet(), rng); const n = handSize(seats);
  const hands = Array.from({ length: seats }, (_, s) => set.slice(s * n, s * n + n).map((t) => [t[0], t[1]] as Tile));
  const boneyard = set.slice(seats * n);
  const o = findOpener(hands);
  return { v: 1, game: 'dominoes', seats, options, rng: r2, round, hands, boneyard, line: [], turn: o.seat, passes: 0, opener: o.tile, scores, phase: 'playing', rounds };
}
function legal(s: DominoState, seat: SeatIndex): DominoMove[] {
  if (s.phase !== 'playing' || s.turn !== seat) return [];
  const hand = s.hands[seat];
  if (!s.line.length) { const t = s.opener!; return [{ type: 'play', tile: [t[0], t[1]], end: 'R' }]; }
  const [L, R] = ends(s.line)!; const out: DominoMove[] = [];
  for (const t of hand) {
    if (t[0] === L || t[1] === L) out.push({ type: 'play', tile: [t[0], t[1]], end: 'L' });
    if (L !== R && (t[0] === R || t[1] === R)) out.push({ type: 'play', tile: [t[0], t[1]], end: 'R' });
  }
  if (out.length) return out;
  return [s.boneyard.length ? { type: 'draw' } : { type: 'pass' }];
}
function endRound(s: DominoState, winner: SeatIndex | null, reason: RoundResult['reason']): DominoState {
  const p = s.hands.map(pips);
  let w = winner;
  if (reason === 'blocked') { const min = Math.min(...p); const at = p.flatMap((v, i) => (v === min ? [i] : [])); w = at.length === 1 ? at[0] : null; }
  const points = w === null ? 0 : p.reduce((n, v, i) => (i === w ? n : n + v), 0);
  const scores = s.scores.map((v, i) => (i === w ? v + points : v));
  const rr: RoundResult = { round: s.round, winner: w, reason, points, pips: p, hands: s.hands.map((h) => h.map((t) => [t[0], t[1]] as Tile)) };
  const over = s.options.mode === 'single' || scores.some((v) => v >= s.options.target);
  return { ...s, scores, rounds: [...s.rounds, rr], phase: over ? 'matchOver' : 'roundOver', passes: 0 };
}
const sameMove = (a: DominoMove, b: DominoMove) => a.type === b.type && (a.type !== 'play' || (b.type === 'play' && a.end === b.end && sameTile(a.tile, b.tile)));

export const dominoes: GameRules<DominoState, DominoMove, DominoView, DominoOptions> = {
  id: 'dominoes',
  seats: { min: 2, max: 4 },
  setup(seatCount, seed, options) {
    if (seatCount < 2 || seatCount > 4) throw new RulesError('bad_seat_count');
    const o: DominoOptions = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    if (!(o.mode === 'single' || o.mode === 'points') || !(o.target > 0)) throw new RulesError('bad_options');
    return deal(seatCount, seed | 0, 1, Array(seatCount).fill(0), o, []);
  },
  currentSeat: (s) => (s.phase === 'playing' ? s.turn : null),
  legalMoves: legal,
  sameMove,
  apply(s, seat, move) {
    if (s.phase !== 'playing') throw new RulesError('not_playing');
    if (s.turn !== seat) throw new RulesError('not_your_turn');
    if (!legal(s, seat).some((m) => sameMove(m, move))) throw new RulesError('illegal_move', 'illegal_move: ' + JSON.stringify(move));
    const next = (t: SeatIndex) => (t + 1) % s.seats;
    if (move.type === 'draw') {
      const [top, ...rest] = s.boneyard;
      const hands = s.hands.map((h, i) => (i === seat ? [...h, [top[0], top[1]] as Tile] : h));
      return { ...s, hands, boneyard: rest };
    }
    if (move.type === 'pass') {
      const passes = s.passes + 1; const st = { ...s, passes, turn: next(seat) };
      return passes >= s.seats ? endRound(st, null, 'blocked') : st;
    }
    const t = move.tile; const hand = s.hands[seat]; const k = hand.findIndex((h) => sameTile(h, t));
    const hands = s.hands.map((h, i) => (i === seat ? h.filter((_, j) => j !== k) : h));
    let line: PlacedTile[];
    if (!s.line.length) line = [{ a: t[0], b: t[1], by: seat }];
    else {
      const [L, R] = ends(s.line)!;
      if (move.end === 'L') line = [{ a: t[0] === L ? t[1] : t[0], b: L, by: seat }, ...s.line];
      else line = [...s.line, { a: R, b: t[0] === R ? t[1] : t[0], by: seat }];
    }
    const st: DominoState = { ...s, hands, line, opener: null, passes: 0, turn: next(seat) };
    return hands[seat].length === 0 ? endRound({ ...st, turn: seat }, seat, 'domino') : st;
  },
  advance(s) {
    if (s.phase !== 'roundOver') throw new RulesError('not_between_rounds');
    return deal(s.seats, s.rng, s.round + 1, s.scores, s.options, s.rounds);
  },
  viewFor(s, seat) {
    return {
      seat, seats: s.seats, options: s.options, round: s.round,
      hand: seat === 'spectator' ? [] : s.hands[seat].map((t) => [t[0], t[1]] as Tile),
      handCounts: s.hands.map((h) => h.length), boneyard: s.boneyard.length,
      line: s.line.map((p) => ({ ...p })), ends: ends(s.line),
      turn: s.phase === 'playing' ? s.turn : null, opener: s.opener, scores: s.scores.slice(), phase: s.phase,
      lastRound: s.rounds.length ? s.rounds[s.rounds.length - 1] : null,
    };
  },
  isOver: (s) => s.phase === 'matchOver',
  result(s): GameOutcome {
    const last = s.rounds[s.rounds.length - 1]; const lp = last?.pips ?? Array(s.seats).fill(0);
    const ranking = [...Array(s.seats).keys()].sort((a, b) => s.scores[b] - s.scores[a] || lp[a] - lp[b] || a - b);
    const top = s.scores[ranking[0]];
    let winners: number[];
    if (s.options.mode === 'single') winners = last?.winner === null || last?.winner === undefined ? [] : [last.winner];
    else winners = top > 0 ? ranking.filter((i) => s.scores[i] === top) : [];
    return { ranking, scores: s.scores.slice(), winners };
  },
  timeoutMove(s, seat) { return legal(s, seat)[0]; },
};
