import { EXPRESSIONS, TIMING, type Expression } from './presets';
/** Tiny event bus: who shows which expression, since when, until when. No React, no three: the mood menu and the chat
 *  bridge write, each avatar's ExpressionLayer reads (polled per frame, so no re-render). Times in ms (performance.now). */
export type ExpressionSource = 'menu' | 'chat' | 'api';
export interface ExpressionEvent { charId: string; expr: Expression; source: ExpressionSource; at: number; until: number; seq: number }
export interface ExpressionBus {
  trigger(charId: string, expr: Expression, opts?: { source?: ExpressionSource; durationMs?: number }): ExpressionEvent | null;
  /** latest event of a character (also once expired; the layer decides the fade) */ get(charId: string): ExpressionEvent | undefined;
  clear(charId: string): void; now(): number;
  subscribe(cb: (e: ExpressionEvent) => void): () => void;
}
export function createExpressionBus(now: () => number = () => performance.now()): ExpressionBus {
  const last = new Map<string, ExpressionEvent>(); const subs = new Set<(e: ExpressionEvent) => void>(); let seq = 0;
  return {
    trigger(charId, expr, opts = {}) {
      if (!charId || !EXPRESSIONS.includes(expr)) return null;
      const at = now(); const e: ExpressionEvent = { charId, expr, source: opts.source ?? 'api', at, until: at + (opts.durationMs ?? TIMING.duration * 1000), seq: ++seq };
      last.set(charId, e); subs.forEach((f) => f(e)); return e;
    },
    get: (id) => last.get(id), clear: (id) => { last.delete(id); }, now,
    subscribe(cb) { subs.add(cb); return () => { subs.delete(cb); }; },
  };
}
/** The game-wide bus. */
export const expressionBus = createExpressionBus();
