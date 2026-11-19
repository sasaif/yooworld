/**
 * Yoo Games Club — reusable mini-game framework (pure types, no React / three.js / storage).
 *
 * A game = one `GameRules` module: pure, deterministic functions over a JSON-serializable state, so the very same module
 * can run in the browser today (LocalGameHost, Local mode against bots) and inside an authoritative room server later.
 * Nothing here touches Gold, XP, rewards, stakes, saves or statistics.
 */
export type SeatIndex = number;
/** Seat configuration of a game: allowed player counts and (team games such as Belote) the seat teams. */
export interface SeatSpec { min: number; max: number; teams?: SeatIndex[][] }

export interface GameRules<S, M, V = unknown, O = unknown> {
  /** stable id: 'dominoes' | 'belote' | 'checkers' | … */
  id: string;
  seats: SeatSpec;
  /** New game for `seatCount` players. All randomness comes from `seed` and is kept inside the state. */
  setup(seatCount: number, seed: number, options?: Partial<O>): S;
  /** Seat that must act now; null when nobody does (between rounds, or game over). */
  currentSeat(s: S): SeatIndex | null;
  /** Every legal move for `seat` right now ([] when it is not that seat's turn). */
  legalMoves(s: S, seat: SeatIndex): M[];
  /** Pure transition. Throws `RulesError` on an illegal move; never mutates `s`. */
  apply(s: S, seat: SeatIndex, move: M): S;
  /** Optional non-seat step (e.g. deal the next round). Only valid when `currentSeat` is null and the game is not over. */
  advance?(s: S): S;
  /** What `seat` may see (hidden information stripped). 'spectator' sees no hand. */
  viewFor(s: S, seat: SeatIndex | 'spectator'): V;
  isOver(s: S): boolean;
  result(s: S): GameOutcome;
  /** Move played for a seat whose turn timer ran out (online later; unused in Local mode). */
  timeoutMove?(s: S, seat: SeatIndex): M;
  /** Two moves are the same move (used to validate a submitted move against `legalMoves`). */
  sameMove(a: M, b: M): boolean;
}
export interface GameOutcome {
  /** seats, best first */
  ranking: SeatIndex[];
  /** final score per seat (game-specific points, never Gold) */
  scores: number[];
  /** seats that won (several on a tie, none on a fully drawn game) */
  winners: SeatIndex[];
  teams?: SeatIndex[][];
}
/** Bot opponent: chooses among the legal moves it is given. Bots never see hidden information beyond `view` and never
 *  touch the economy. */
export interface BotPlayer<M, V = unknown> { id: string; label: string; pick(view: V, legal: M[], rng: () => number): M }

export class RulesError extends Error { constructor(readonly code: string, msg?: string) { super(msg ?? code); this.name = 'RulesError'; } }

// ---------- rooms / tables / seats ----------
export type Occupant = { kind: 'human'; id: string; name: string } | { kind: 'bot'; id: string; name: string };
export interface SeatSlot { index: SeatIndex; occupant: Occupant | null; team?: number; ready: boolean }
export type RoomStatus = 'lobby' | 'playing' | 'finished';
export interface GameRoom {
  roomId: string; gameId: string; tableId: string;
  visibility: 'public' | 'private';
  status: RoomStatus;
  seats: SeatSlot[];
  hostId: string;
  inviteCode?: string;
  /** 'local' = this device only, opponents are bots. 'online' only ever comes from a real server (none yet). */
  mode: 'local' | 'online';
  options?: Record<string, unknown>;
  createdAt: number;
}
/** End-of-game record. Local mode keeps it in memory for the session only (never saved, never rewarded). */
export interface GameResult {
  roomId: string; gameId: string;
  seats: { kind: 'human' | 'bot'; id: string; name: string }[];
  scores: number[]; ranking: SeatIndex[]; winners: SeatIndex[];
  durationMs: number; moves: number;
  endedBy: 'normal' | 'forfeit' | 'abandon';
}
