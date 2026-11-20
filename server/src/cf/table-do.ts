/** Durable Object for one mini-game table. State in DO storage; the result leaves the room HMAC-signed. */
import { DurableObject } from 'cloudflare:workers';
import { canonicalResult, joinTable, legalFor, moveTable, newTable, tableResult, viewTable, type TableState } from '../core/tableGame';
import { hmac } from '../core/ticket';
import type { Env } from './env';

const isErr = (x: unknown): x is string => typeof x === 'string';
export class TableDO extends DurableObject<Env> {
  private async load() { return (await this.ctx.storage.get<TableState>('t')) ?? null; }
  private async save(t: TableState) { await this.ctx.storage.put('t', t); }
  async create(id: string, owner: string) {
    if (await this.load()) return { error: 'exists' };
    const t = newTable(id, owner, 2, Date.now()); await this.save(t); return { ok: true, table: id };
  }
  async join(player: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_table' };
    const seed = crypto.getRandomValues(new Uint32Array(1))[0] | 0;            // server seed, never from the client
    const r = joinTable(t, player, seed, Date.now()); if (isErr(r)) return { error: r };
    await this.save(r); return { ok: true, started: !!r.engine };
  }
  async view(player: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_table' };
    const v = viewTable(t, player); if (isErr(v)) return { error: v };
    return { ok: true, ...v, legal: legalFor(t, player) };
  }
  async move(player: string, move: unknown, seq?: number) {
    const t = await this.load(); if (!t) return { error: 'unknown_table' };
    const r = moveTable(t, player, move as never, seq, Date.now()); if (isErr(r)) return { error: r };
    await this.save(r); return { ok: true, seq: r.engine!.seq };
  }
  async result(player: string) {
    const t = await this.load(); if (!t) return { error: 'unknown_table' };
    if (!t.players.includes(player)) return { error: 'not_seated' };
    const r = tableResult(t); if (isErr(r)) return { error: r };
    const canon = canonicalResult(r);
    return { ok: true, result: r, hash: await sha256(canon), sig: await hmac(this.env.RESULT_SECRET, canon) };
  }
}
async function sha256(s: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
