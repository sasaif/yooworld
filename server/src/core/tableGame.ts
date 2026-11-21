/**
 * Server-authoritative Dominoes table (portable). Uses the CLIENT's own pure rules (src/minigames) unchanged:
 * the server deals with its own seed, validates every move with the same engine, and alone computes the result.
 * Clients only ever send moves; there is no way to submit a result.
 */
import { dominoes, type DominoMove, type DominoState, type DominoView } from '../../../src/minigames/dominoes/rules';
import { createEngine, submitMove, type EngineState } from '../../../src/minigames/turnEngine';

export interface TableState { id: string; players: string[]; seats: number; engine: EngineState<DominoState, DominoMove> | null; createdAt: number }
export type TableErr = 'full' | 'not_seated' | 'not_started' | 'already_seated' | 'not_over' | 'not_your_turn' | 'illegal_move' | 'game_over' | 'stale_seq' | 'not_advanceable';
export interface TableResult { table: string; game: 'dominoes'; players: string[]; winners: string[]; scores: number[]; moves: number }

export function newTable(id: string, owner: string, seats = 2, now = 0): TableState { return { id, players: [owner], seats, engine: null, createdAt: now }; }
export function joinTable(t: TableState, player: string, seed: number, now = 0): TableState | TableErr {
  if (t.players.includes(player)) return 'already_seated';
  if (t.players.length >= t.seats) return 'full';
  const players = [...t.players, player];
  const engine = players.length === t.seats ? createEngine(dominoes, t.seats, seed, { options: { mode: 'single', target: 1 }, now }) : null;
  return { ...t, players, engine };
}
export function viewTable(t: TableState, player: string): { players: string[]; seq: number; view: DominoView | null; over: boolean } | TableErr {
  const seat = t.players.indexOf(player); if (seat < 0) return 'not_seated';
  if (!t.engine) return { players: t.players, seq: 0, view: null, over: false };
  return { players: t.players, seq: t.engine.seq, view: dominoes.viewFor(t.engine.state, seat), over: dominoes.isOver(t.engine.state) };
}
export function legalFor(t: TableState, player: string): DominoMove[] {
  const seat = t.players.indexOf(player); if (seat < 0 || !t.engine) return [];
  return dominoes.legalMoves(t.engine.state, seat);
}
export function moveTable(t: TableState, player: string, move: DominoMove, seq?: number, now = 0): TableState | TableErr {
  const seat = t.players.indexOf(player); if (seat < 0) return 'not_seated';
  if (!t.engine) return 'not_started';
  const r = submitMove(dominoes, t.engine, seat, move, { expectSeq: seq, now });
  if (!r.ok) return r.error;
  return { ...t, engine: r.engine };
}
export function tableResult(t: TableState): TableResult | TableErr {
  if (!t.engine) return 'not_started';
  if (!dominoes.isOver(t.engine.state)) return 'not_over';
  const o = dominoes.result(t.engine.state);
  return { table: t.id, game: 'dominoes', players: t.players, winners: o.winners.map((s) => t.players[s]), scores: o.scores, moves: t.engine.seq };
}
export const canonicalResult = (r: TableResult) => JSON.stringify([r.table, r.game, r.players, r.winners, r.scores, r.moves]);
