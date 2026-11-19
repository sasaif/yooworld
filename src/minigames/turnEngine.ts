import { RulesError, type GameRules, type SeatIndex } from './types';

/**
 * Generic, pure turn engine shared by every mini-game. It wraps a rules module's state with a monotonically increasing
 * `seq`, validates each submitted move against `legalMoves` (whose turn, stale seq, game over), keeps an append-only
 * move log and the current turn deadline. JSON-serializable: an online room server can hold the same object.
 */
export interface MoveRecord<M> { seq: number; seat: SeatIndex | null; move: M | 'advance'; at: number }
export interface EngineState<S, M> {
  gameId: string;
  seq: number;
  state: S;
  log: MoveRecord<M>[];
  /** absolute time (ms) when the current seat's turn times out; null = no timer (Local mode default) */
  deadline: number | null;
  turnTimeoutMs: number | null;
  startedAt: number;
}
export type SubmitError = 'not_your_turn' | 'illegal_move' | 'game_over' | 'stale_seq' | 'not_advanceable';
export type SubmitResult<S, M> = { ok: true; engine: EngineState<S, M> } | { ok: false; error: SubmitError; engine: EngineState<S, M> };

export function createEngine<S, M>(rules: GameRules<S, M>, seatCount: number, seed: number, opts: { options?: unknown; now?: number; turnTimeoutMs?: number | null } = {}): EngineState<S, M> {
  if (seatCount < rules.seats.min || seatCount > rules.seats.max) throw new RulesError('bad_seat_count', `${rules.id}: ${seatCount} seats (allowed ${rules.seats.min}–${rules.seats.max})`);
  const now = opts.now ?? 0; const t = opts.turnTimeoutMs ?? null;
  const state = rules.setup(seatCount, seed, opts.options as never);
  return { gameId: rules.id, seq: 0, state, log: [], turnTimeoutMs: t, deadline: t && rules.currentSeat(state) !== null ? now + t : null, startedAt: now };
}
/** Validate and apply one move. Never throws for a client mistake: returns `{ ok: false, error }` and the unchanged engine. */
export function submitMove<S, M>(rules: GameRules<S, M>, e: EngineState<S, M>, seat: SeatIndex, move: M, opts: { expectSeq?: number; now?: number } = {}): SubmitResult<S, M> {
  if (opts.expectSeq !== undefined && opts.expectSeq !== e.seq) return { ok: false, error: 'stale_seq', engine: e };
  if (rules.isOver(e.state)) return { ok: false, error: 'game_over', engine: e };
  if (rules.currentSeat(e.state) !== seat) return { ok: false, error: 'not_your_turn', engine: e };
  if (!rules.legalMoves(e.state, seat).some((m) => rules.sameMove(m, move))) return { ok: false, error: 'illegal_move', engine: e };
  const now = opts.now ?? 0;
  const state = rules.apply(e.state, seat, move);
  return { ok: true, engine: nextEngine(rules, e, state, { seq: e.seq + 1, seat, move, at: now }, now) };
}
/** Non-seat step (e.g. deal the next round), allowed only when nobody has to act and the game is not over. */
export function advanceEngine<S, M>(rules: GameRules<S, M>, e: EngineState<S, M>, now = 0): SubmitResult<S, M> {
  if (rules.isOver(e.state)) return { ok: false, error: 'game_over', engine: e };
  if (rules.currentSeat(e.state) !== null || !rules.advance) return { ok: false, error: 'not_advanceable', engine: e };
  const state = rules.advance(e.state);
  return { ok: true, engine: nextEngine(rules, e, state, { seq: e.seq + 1, seat: null, move: 'advance', at: now }, now) };
}
/** Turn timer: if the deadline has passed, play the rules' timeout move for the current seat. */
export function checkTimeout<S, M>(rules: GameRules<S, M>, e: EngineState<S, M>, now: number): SubmitResult<S, M> | null {
  if (e.deadline === null || now < e.deadline || !rules.timeoutMove) return null;
  const seat = rules.currentSeat(e.state); if (seat === null) return null;
  return submitMove(rules, e, seat, rules.timeoutMove(e.state, seat), { now });
}
function nextEngine<S, M>(rules: GameRules<S, M>, e: EngineState<S, M>, state: S, rec: MoveRecord<M>, now: number): EngineState<S, M> {
  const deadline = e.turnTimeoutMs && !rules.isOver(state) && rules.currentSeat(state) !== null ? now + e.turnTimeoutMs : null;
  return { ...e, seq: rec.seq, state, log: [...e.log, rec], deadline };
}
