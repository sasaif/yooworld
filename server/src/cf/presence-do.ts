/** Per-player index of the realtime rooms a session was given a ticket for (one DO per player:
 *  `${env}:presence:${playerId}`). Written by the API Worker when it signs a room ticket; read on session revocation
 *  to close exactly those WebSockets (close 4401). Rows older than the WebSocket lifetime cap are pruned (a socket
 *  cannot outlive the cap, so an older row can no longer point to an open socket). */
import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export class PresenceDO extends DurableObject<Env> {
  private sql: SqlStorage;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('create table if not exists tickets(sid text not null, room text not null, at integer not null, primary key (sid, room))');
    // revoked sessions (tombstones) + "every session revoked before <at>": a ticket signed just before a revocation
    // (valid 30 s) must not open a socket afterwards
    this.sql.exec('create table if not exists revoked(sid text primary key, at integer not null)');
    this.sql.exec('create table if not exists revoked_all(id integer primary key check (id = 1), at integer not null)');
  }
  /** Called by the WebSocket upgrade: refuses tickets of a revoked session, else (re)records the room. */
  async admit(sid: string, room: string, issuedAt: number, maxAgeMs: number) {
    if ([...this.sql.exec('select 1 from revoked where sid = ?', sid)].length) return false;
    const all = [...this.sql.exec('select at from revoked_all')][0];
    if (all && issuedAt <= Number(all.at)) return false;
    await this.record(sid, room, maxAgeMs);
    return true;
  }
  async record(sid: string, room: string, maxAgeMs: number) {
    const now = Date.now();
    this.sql.exec('delete from tickets where at < ?', now - maxAgeMs - 60_000);
    this.sql.exec('delete from revoked where at < ?', now - 10 * 60_000);       // tickets live 30 s: 10 min is ample
    this.sql.exec('insert into tickets values (?,?,?) on conflict(sid, room) do update set at = excluded.at', sid, room, now);
  }
  /** Rooms to disconnect for one session (sid) or for every session of the player (sid = null). Rows are removed. */
  async take(sid: string | null) {
    const rows = sid === null ? [...this.sql.exec('select distinct room from tickets')] : [...this.sql.exec('select distinct room from tickets where sid = ?', sid)];
    const now = Date.now();
    if (sid === null) { this.sql.exec('delete from tickets'); this.sql.exec('insert into revoked_all values (1, ?) on conflict(id) do update set at = excluded.at', now); }
    else { this.sql.exec('delete from tickets where sid = ?', sid); this.sql.exec('insert into revoked values (?, ?) on conflict(sid) do update set at = excluded.at', sid, now); }
    return rows.map((r) => String(r.room));
  }
  async size() { return Number([...this.sql.exec('select count(*) n from tickets')][0].n); }
}
