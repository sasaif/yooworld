/**
 * EconomyGate — the ONLY economy surface the API Worker has. Each method = exactly one call to one
 * SECURITY DEFINER function eco.* (the transaction lives inside the function). Portable: no Cloudflare,
 * no driver import. The SQL client is injected (pg locally, Neon HTTP driver on Workers).
 */
import type { Currency, GateResult, TradeSnapshot } from '../../../shared/economy';
export type { Currency, GateResult, TradeSnapshot };

export interface SqlClient { query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> }

export interface EconomyGate {
  ensurePlayer(player: string): Promise<GateResult>;
  testGrantGold(player: string, amount: number, key: string): Promise<GateResult>;
  claimDaily(player: string, key: string): Promise<GateResult>;
  shopBuy(player: string, itemDef: string, currency: Currency, key: string): Promise<GateResult>;
  activityStart(player: string, defId: string, roomId: string, key: string): Promise<GateResult>;
  completeActivityTask(player: string, sessionId: string, key: string): Promise<GateResult>;
  giftGold(from: string, to: string, amount: number, key: string): Promise<GateResult>;
  giftItem(from: string, to: string, itemId: string, key: string): Promise<GateResult>;
  tradeLock(tradeId: string, actor: string, snapshot: TradeSnapshot, key: string): Promise<GateResult>;
  tradeSettle(tradeId: string, actor: string, key: string): Promise<GateResult>;
  tradeCancel(tradeId: string, actor: string | null, key: string): Promise<GateResult>;
  balances(player: string): Promise<GateResult>;
  reconciliation(): Promise<GateResult>;
}

/** Postgres SQLSTATEs that are safe to retry with the SAME idempotency key. */
const RETRYABLE_SQLSTATE = new Set(['40001', '40P01', '55P03', '57P01', '08000', '08003', '08006', '08001', '53300']);
const NETWORK = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE']);

/** Map a driver error to a GateResult. Business errors carry HINT = code (see db/migrations/0003_eco.sql). */
export function toGateError(e: unknown): GateResult {
  const err = e as { code?: string; hint?: string; message?: string };
  if (err?.code === 'P0001' && err.hint) return { ok: false, code: err.hint, retryable: false, message: err.message };
  if (err?.code === '23514' && err.hint) return { ok: false, code: err.hint, retryable: false, message: err.message };
  if (err?.code && RETRYABLE_SQLSTATE.has(err.code)) return { ok: false, code: 'busy', retryable: true, message: err.message };
  if (err?.code && NETWORK.has(err.code)) return { ok: false, code: 'unavailable', retryable: true, message: err.message };
  if (err?.code === '42501') return { ok: false, code: 'forbidden', retryable: false, message: err.message };
  return { ok: false, code: 'internal', retryable: false, message: err?.message };
}

export function createEconomyGate(db: SqlClient): EconomyGate {
  const call = async (fn: string, args: unknown[]): Promise<GateResult> => {
    const ph = args.map((_, i) => `$${i + 1}`).join(', ');
    try {
      const r = await db.query(`select ${fn}(${ph}) as r`, args);
      return r.rows[0].r as GateResult;
    } catch (e) { return toGateError(e); }
  };
  return {
    ensurePlayer: (p) => call('eco.ensure_player', [p]),
    testGrantGold: (p, amount, key) => call('eco.test_grant_gold', [key, p, amount]),
    claimDaily: (p, key) => call('eco.claim_daily', [key, p]),
    shopBuy: (p, def, cur, key) => call('eco.shop_buy', [key, p, def, cur]),
    activityStart: (p, def, room, key) => call('eco.activity_start', [key, p, def, room]),
    completeActivityTask: (p, s, key) => call('eco.activity_complete_task', [key, p, s]),
    giftGold: (f, t, amount, key) => call('eco.gift_gold', [key, f, t, amount]),
    giftItem: (f, t, item, key) => call('eco.gift_item', [key, f, t, item]),
    tradeLock: (id, actor, s, key) => call('eco.trade_lock', [key, id, actor, s.a, s.b, s.version, s.hash, JSON.stringify(s.lines)]),
    tradeSettle: (id, actor, key) => call('eco.trade_settle', [key, id, actor]),
    tradeCancel: (id, actor, key) => call('eco.trade_cancel', [key, id, actor]),
    balances: (p) => call('eco.get_balances', [p]),
    reconciliation: async () => {
      const r = await call('eco.recon_summary', []);
      if ('code' in r) return r;
      const counts = Object.entries(r as Record<string, unknown>).filter(([, v]) => typeof v === 'number') as [string, number][];
      return { ...Object.fromEntries(counts), ok: counts.every(([, v]) => v === 0) } as GateResult;
    },
  };
}
