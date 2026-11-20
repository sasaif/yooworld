/**
 * Trade negotiation (portable, pure). Lives in a trade room (Durable Object); Postgres only sees the final
 * lock -> settle of the version BOTH players accepted (eco.trade_lock / eco.trade_settle, unchanged).
 * Rules: every offer/counter-offer replaces the whole line set and bumps `version` (optimistic: the caller must
 * send the version it saw, else stale_version); any new offer clears both acceptances; settlement starts only when
 * both players accepted the SAME version, and then the trade is frozen ('settling') until Postgres answers.
 */
export type Side = 'a' | 'b';
export type Line = { side: Side; item: string } | { side: Side; gold: number };
export type TradeStatus = 'open' | 'settling' | 'settled' | 'cancelled';
export interface Settlement { ecoId: string; settler: string; version: number; lines: Line[]; startedAt: number }
export interface TradeState {
  id: string; a: string; b: string; version: number; lines: Line[]; proposer: string | null;
  accepted: { a: number | null; b: number | null }; status: TradeStatus; lastError: string | null;
  settlement: Settlement | null; settledTx: number | null; updatedAt: number;
}
export type TradeErr = 'not_participant' | 'stale_version' | 'bad_state' | 'bad_lines' | 'self' | 'nothing_to_accept';
export const TRADE_MAX_LINES = 16;            // technical (same as eco.config trade.max_lines)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function newTrade(id: string, a: string, b: string, now: number): TradeState | TradeErr {
  if (a === b) return 'self';
  return { id, a, b, version: 0, lines: [], proposer: null, accepted: { a: null, b: null }, status: 'open', lastError: null, settlement: null, settledTx: null, updatedAt: now };
}
export const sideOf = (t: TradeState, p: string): Side | null => (p === t.a ? 'a' : p === t.b ? 'b' : null);
export function validLines(lines: unknown): Line[] | null {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > TRADE_MAX_LINES) return null;
  const seen = new Set<string>(); const out: Line[] = []; let items = 0;
  for (const l of lines as Record<string, unknown>[]) {
    if (!l || typeof l !== 'object' || (l.side !== 'a' && l.side !== 'b')) return null;
    const keys = Object.keys(l).sort().join(',');
    if (keys === 'item,side' && typeof l.item === 'string' && UUID.test(l.item) && !seen.has(l.item)) { seen.add(l.item); items++; out.push({ side: l.side, item: l.item }); }
    else if (keys === 'gold,side' && Number.isSafeInteger(l.gold) && (l.gold as number) > 0 && (l.gold as number) <= 1e9) out.push({ side: l.side, gold: l.gold as number });
    else return null;
  }
  return items > 0 ? out : null;                // a trade needs at least one item (otherwise it is a gift)
}
export function offer(t: TradeState, actor: string, baseVersion: number, lines: unknown, now: number): TradeState | TradeErr {
  if (!sideOf(t, actor)) return 'not_participant';
  if (t.status !== 'open') return 'bad_state';
  if (baseVersion !== t.version) return 'stale_version';
  const v = validLines(lines); if (!v) return 'bad_lines';
  return { ...t, version: t.version + 1, lines: v, proposer: actor, accepted: { a: null, b: null }, lastError: null, updatedAt: now };
}
/** Returns the new state and, when both accepted the same version, the settlement to execute. */
export function accept(t: TradeState, actor: string, version: number, ecoId: string, now: number): { state: TradeState; settle: Settlement | null } | TradeErr {
  const s = sideOf(t, actor); if (!s) return 'not_participant';
  if (t.status !== 'open') return 'bad_state';
  if (t.version === 0) return 'nothing_to_accept';
  if (version !== t.version) return 'stale_version';
  const accepted = { ...t.accepted, [s]: version };
  if (accepted.a === t.version && accepted.b === t.version) {
    const settlement: Settlement = { ecoId, settler: actor, version: t.version, lines: t.lines, startedAt: now };
    return { state: { ...t, accepted, status: 'settling', settlement, updatedAt: now }, settle: settlement };
  }
  return { state: { ...t, accepted, updatedAt: now }, settle: null };
}
export function settled(t: TradeState, ecoId: string, tx: number | null, now: number): TradeState | TradeErr {
  if (t.status === 'settled' && t.settlement?.ecoId === ecoId) return t;                      // idempotent
  if (t.status !== 'settling' || t.settlement?.ecoId !== ecoId) return 'bad_state';
  return { ...t, status: 'settled', settledTx: tx, updatedAt: now };
}
/** Postgres refused the lock (item moved, gold missing...): back to negotiation, both must accept again. */
export function failed(t: TradeState, ecoId: string, code: string, now: number): TradeState | TradeErr {
  if (t.status !== 'settling' || t.settlement?.ecoId !== ecoId) return 'bad_state';
  return { ...t, status: 'open', accepted: { a: null, b: null }, settlement: null, lastError: code, updatedAt: now };
}
export function cancel(t: TradeState, actor: string, now: number): TradeState | TradeErr {
  if (!sideOf(t, actor)) return 'not_participant';
  if (t.status !== 'open') return 'bad_state';
  return { ...t, status: 'cancelled', updatedAt: now };
}
/** Hash of exactly what both accepted (stored as eco.trades.offer_hash). */
export const canonicalOffer = (t: Pick<TradeState, 'id' | 'a' | 'b'>, s: Settlement) => JSON.stringify([t.id, t.a, t.b, s.version, s.lines]);
export const viewTrade = (t: TradeState) => ({ id: t.id, a: t.a, b: t.b, version: t.version, lines: t.lines, proposer: t.proposer, accepted: t.accepted, status: t.status, lastError: t.lastError, settledTx: t.settledTx });
