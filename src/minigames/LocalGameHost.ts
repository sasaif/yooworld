import { makeRng } from './rng';
import { advanceEngine, checkTimeout, createEngine, submitMove, type EngineState, type SubmitResult } from './turnEngine';
import type { BotPlayer, GameRoom, GameResult, GameRules, SeatIndex } from './types';

/**
 * Local mode host: runs a rules module on this device for one table. The human seat submits moves from the UI, bot seats
 * are played automatically after a short "thinking" delay. Results stay in memory (session only): nothing is saved,
 * no Gold / XP / reward / stake is involved. Online play would replace this class by a room server running the same
 * `GameRules` + `turnEngine` and sending each client only `viewFor(seat)`.
 */
export interface HostClock { now(): number; setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void }
export const realClock: HostClock = { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export interface LocalHostOptions<M, V> {
  seed: number;
  bots: Record<number, BotPlayer<M, V>>;
  botDelayMs?: number;
  /** null = no turn timer (Local mode default: a human is never rushed by bots) */
  turnTimeoutMs?: number | null;
  options?: unknown;
  clock?: HostClock;
}
export class LocalGameHost<S, M, V> {
  engine: EngineState<S, M>;
  private subs = new Set<() => void>();
  private timer: unknown = null;
  private readonly clock: HostClock;
  private readonly botRng: () => number;
  private stopped = false;
  result: GameResult | null = null;
  constructor(readonly rules: GameRules<S, M, V>, readonly room: GameRoom, readonly opts: LocalHostOptions<M, V>) {
    this.clock = opts.clock ?? realClock;
    this.botRng = makeRng(opts.seed ^ 0x5bd1e995);
    this.engine = createEngine(rules, room.seats.length, opts.seed, { options: opts.options, now: this.clock.now(), turnTimeoutMs: opts.turnTimeoutMs ?? null });
  }
  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit() { for (const f of this.subs) f(); }
  get state() { return this.engine.state; }
  view(seat: SeatIndex | 'spectator') { return this.rules.viewFor(this.engine.state, seat); }
  legal(seat: SeatIndex) { return this.rules.legalMoves(this.engine.state, seat); }
  isBot(seat: SeatIndex) { return !!this.opts.bots[seat]; }
  start() { this.schedule(); this.emit(); }
  /** Move from the human at `seat` (UI). A bot's seat can never be played from outside. */
  submit(seat: SeatIndex, move: M): SubmitResult<S, M> {
    if (this.opts.bots[seat]) return { ok: false, error: 'not_your_turn', engine: this.engine };
    return this.play(seat, move);
  }
  private play(seat: SeatIndex, move: M): SubmitResult<S, M> {
    if (this.stopped) return { ok: false, error: 'game_over', engine: this.engine };
    const r = submitMove(this.rules, this.engine, seat, move, { now: this.clock.now() });
    if (r.ok) this.commit(r.engine);
    return r;
  }
  /** Between rounds: deal the next one (UI button). */
  advance() { const r = advanceEngine(this.rules, this.engine, this.clock.now()); if (r.ok) this.commit(r.engine); return r; }
  /** Stop the table (leave / abandon). */
  stop(endedBy: GameResult['endedBy'] = 'abandon') {
    if (this.stopped) return; this.stopped = true; this.clearTimer();
    if (!this.result) this.result = this.makeResult(endedBy);
    this.emit();
  }
  private commit(e: EngineState<S, M>) {
    this.engine = e;
    if (this.rules.isOver(e.state) && !this.result) this.result = this.makeResult('normal');
    this.schedule(); this.emit();
  }
  private clearTimer() { if (this.timer !== null) { this.clock.clearTimeout(this.timer); this.timer = null; } }
  private schedule() {
    this.clearTimer(); if (this.stopped || this.rules.isOver(this.engine.state)) return;
    const seat = this.rules.currentSeat(this.engine.state); if (seat === null) return;
    const bot = this.opts.bots[seat];
    if (bot) {
      this.timer = this.clock.setTimeout(() => {
        this.timer = null; if (this.stopped) return;
        const legal = this.rules.legalMoves(this.engine.state, seat);
        const move = bot.pick(this.rules.viewFor(this.engine.state, seat), legal, this.botRng);
        const r = this.play(seat, move);
        if (!r.ok) throw new Error(`bot ${bot.id} illegal move: ${r.error}`);
      }, this.opts.botDelayMs ?? 700);
    } else if (this.engine.deadline !== null) {
      this.timer = this.clock.setTimeout(() => { this.timer = null; const r = checkTimeout(this.rules, this.engine, this.clock.now()); if (r?.ok) this.commit(r.engine); }, Math.max(0, this.engine.deadline - this.clock.now()));
    }
  }
  private makeResult(endedBy: GameResult['endedBy']): GameResult {
    const o = this.rules.result(this.engine.state);
    return {
      roomId: this.room.roomId, gameId: this.rules.id,
      seats: this.room.seats.map((s) => ({ kind: s.occupant?.kind ?? 'bot', id: s.occupant?.id ?? '', name: s.occupant?.name ?? '' })),
      scores: o.scores, ranking: o.ranking, winners: endedBy === 'normal' ? o.winners : [],
      durationMs: this.clock.now() - this.engine.startedAt, moves: this.engine.log.length, endedBy,
    };
  }
}
