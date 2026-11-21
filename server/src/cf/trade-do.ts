/** Trade room: one Durable Object per negotiation. Pure rules in core/tradeNegotiation.ts; this adapter only
 *  persists the state (DO storage, single-threaded => no race between two accepts). Money moves only in Postgres,
 *  driven by the API Worker (a room never holds database credentials). */
import { DurableObject } from 'cloudflare:workers';
import * as T from '../core/tradeNegotiation';
import type { Env } from './env';

const isErr = (x: unknown): x is string => typeof x === 'string';
export class TradeDO extends DurableObject<Env> {
  private async load() { return (await this.ctx.storage.get<T.TradeState>('t')) ?? null; }
  private async save(t: T.TradeState) { await this.ctx.storage.put('t', t); return t; }
  async create(id: string, a: string, b: string) {
    if (await this.load()) return { error: 'exists' };
    const t = T.newTrade(id, a, b, Date.now()); if (isErr(t)) return { error: t };
    return { ok: true, state: T.viewTrade(await this.save(t)) };
  }
  async view(actor: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    if (!T.sideOf(t, actor)) return { error: 'not_participant' };
    return { ok: true, state: T.viewTrade(t), pending: t.status === 'settling' ? this.pending(t) : null };
  }
  async offer(actor: string, version: number, lines: unknown) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    const r = T.offer(t, actor, version, lines, Date.now()); if (isErr(r)) return { error: r };
    return { ok: true, state: T.viewTrade(await this.save(r)) };
  }
  async accept(actor: string, version: number) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    const r = T.accept(t, actor, version, crypto.randomUUID(), Date.now()); if (isErr(r)) return { error: r };
    await this.save(r.state);
    return { ok: true, state: T.viewTrade(r.state), settle: r.settle ? this.pending(r.state) : null };
  }
  async settled(ecoId: string, tx: number | null) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    const r = T.settled(t, ecoId, tx, Date.now()); if (isErr(r)) return { error: r };
    return { ok: true, state: T.viewTrade(await this.save(r)) };
  }
  async failed(ecoId: string, code: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    const r = T.failed(t, ecoId, code, Date.now()); if (isErr(r)) return { error: r };
    return { ok: true, state: T.viewTrade(await this.save(r)) };
  }
  async cancel(actor: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_trade' };
    const r = T.cancel(t, actor, Date.now()); if (isErr(r)) return { error: r };
    return { ok: true, state: T.viewTrade(await this.save(r)) };
  }
  /** Everything the Worker needs to (re)drive the settlement idempotently (same eco id, actor and keys). */
  private pending(t: T.TradeState) {
    const s = t.settlement!;
    return { ecoId: s.ecoId, settler: s.settler, a: t.a, b: t.b, version: s.version, lines: s.lines, canonical: T.canonicalOffer(t, s) };
  }
}
