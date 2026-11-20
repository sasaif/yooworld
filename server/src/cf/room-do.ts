/** Thin Cloudflare adapter for RoomCore: hibernatable WebSockets, SQLite (bans, used tickets), 10 Hz alarm only
 *  while someone moves, directory reporting. All rules live in RoomCore (core/roomcore.ts). */
import { DurableObject } from 'cloudflare:workers';
import { RoomCore, type In, type Out, type Persist } from '../core/roomcore';
import { parseRoom, roomConfig, TECH } from '../core/rooms';
import type { Env } from './env';

interface Attach { id: string; conn: string; x: number; z: number; at: number }
const enc = new TextEncoder();

export class RoomDO extends DurableObject<Env> {
  private core?: RoomCore; private sql: SqlStorage; private ticking = false;
  private counters = { constructs: 0, wsMessages: 0, alarms: 0, joins: 0, rejects: 0 };
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`create table if not exists bans(player text primary key, until integer not null, by text not null);
                   create table if not exists used_tickets(jti text primary key, exp integer not null);
                   create table if not exists meta(k text primary key, v text not null);`);
    this.sql.exec(`insert into meta values ('constructs','1') on conflict(k) do update set v = cast(v as integer) + 1`);
    this.counters.constructs = Number(this.meta('constructs'));
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('{"t":"ping"}', '{"t":"pong"}'));   // pings never wake the DO
  }
  private meta(k: string) { return [...this.sql.exec('select v from meta where k = ?', k)][0]?.v as string | undefined; }
  private setMeta(k: string, v: string) { this.sql.exec('insert into meta values (?,?) on conflict(k) do update set v = excluded.v', k, v); }

  private ensureCore(): RoomCore | undefined {
    if (this.core) return this.core;
    const name = this.meta('name'); const claims = this.meta('claims'); if (!name || !claims) return undefined;
    const sql = this.sql;
    const persist: Persist = {
      getBan: (p) => { const r = [...sql.exec('select until from bans where player = ?', p)][0]; return r ? Number(r.until) : null; },
      putBan: (p, until, by) => { sql.exec('insert into bans values (?,?,?) on conflict(player) do update set until = max(until, excluded.until), by = excluded.by', p, until, by); },
      useTicket: (jti, exp) => {
        sql.exec('delete from used_tickets where exp < ?', Date.now() - 60_000);
        if ([...sql.exec('select 1 from used_tickets where jti = ?', jti)].length) return false;
        sql.exec('insert into used_tickets values (?,?)', jti, exp); return true;
      },
    };
    const ws = (conn: string) => this.ctx.getWebSockets(conn)[0];
    this.core = new RoomCore(roomConfig(name, JSON.parse(claims), 0), persist,
      (conn, m: Out) => { const s = JSON.stringify(m); try { ws(conn)?.send(s); } catch { /* closed */ } return enc.encode(s).length; },
      (conn, code, reason) => { try { ws(conn)?.close(code, reason); } catch { /* */ } }, () => Date.now());
    for (const w of this.ctx.getWebSockets()) {          // rebuild after hibernation / eviction
      const a = w.deserializeAttachment() as Attach | null;
      if (a) this.core.restore(a.id, a.conn, { x: a.x, z: a.z });
    }
    return this.core;
  }

  async fetch(req: Request) {
    const name = req.headers.get('x-room')!; const r = parseRoom(name);
    if (!r) return new Response('bad room', { status: 400 });
    if (!this.meta('name')) this.setMeta('name', name);
    this.setMeta('claims', JSON.stringify({ kind: r.kind, cap: Number(req.headers.get('x-cap')), owner: req.headers.get('x-owner') || undefined }));
    if (this.core) (this.core.cfg as { hardCap: number }).hardCap = Number(req.headers.get('x-cap'));
    const core = this.ensureCore()!;
    const sub = req.headers.get('x-sub')!, jti = req.headers.get('x-jti')!, exp = Number(req.headers.get('x-exp'));
    const [client, server] = Object.values(new WebSocketPair());
    const conn = crypto.randomUUID();
    // Pre-check refusals on a plain (non-hibernatable) socket: send the reason, close with a 44xx/40xx code.
    const pre = core.precheck(sub, jti, exp);
    if (pre) {
      this.counters.rejects++;
      server.accept();
      server.send(JSON.stringify({ t: 'error', code: pre.code, until: pre.until }));
      server.close(pre.code === 'full' ? 4009 : pre.code === 'kicked' ? 4003 : 4401, pre.code!);
      return new Response(null, { status: 101, webSocket: client });
    }
    this.ctx.acceptWebSocket(server, [conn]);
    const j = core.join(sub, conn, jti, exp);
    if (!j.ok) {                       // race between precheck and join (cannot happen in a single-threaded DO)
      this.counters.rejects++;
      server.close(4401, j.code!);
    } else {
      this.counters.joins++;
      server.serializeAttachment({ id: sub, conn, x: j.pos!.x, z: j.pos!.z, at: Date.now() } satisfies Attach);
      await this.membershipChanged();
    }
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer) {
    const a = ws.deserializeAttachment() as Attach | null; if (!a) return;
    const core = this.ensureCore(); if (!core) return;
    this.counters.wsMessages++;
    if ((typeof data === 'string' ? data.length : data.byteLength) > 2048) return;
    let m: In; try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    const before = core.count;
    core.onMessage(a.id, m);
    if (core.count !== before) { await this.membershipChanged(); return; }       // rate-limit disconnect
    if (m?.t === 'move') { const p = core.positionOf(a.id); if (p && (p.x !== a.x || p.z !== a.z)) { ws.serializeAttachment({ ...a, x: p.x, z: p.z }); this.startTick(); } }
  }
  private startTick() { if (!this.ticking) { this.ticking = true; this.ctx.storage.setAlarm(Date.now() + TECH.tickMs); } }
  async alarm() {
    this.counters.alarms++;
    const core = this.ensureCore();
    if (core?.tick()) await this.ctx.storage.setAlarm(Date.now() + TECH.tickMs); else this.ticking = false;
  }
  async webSocketClose(ws: WebSocket, code: number, reason?: string) {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason ?? ''); } catch { /* already closed */ }   // complete the close handshake
    const a = ws.deserializeAttachment() as Attach | null;
    const core = this.ensureCore();
    if (a && core && core.leave(a.id, a.conn, code === 1006 ? 'dropped' : 'left')) await this.membershipChanged();
  }
  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws, 1006); }

  /** Report membership to the location directory; an apartment owner left alone loses the realtime room. */
  private async membershipChanged() {
    const core = this.core!; const r = parseRoom(this.meta('name')!)!;
    if (r.kind === 'public') {
      const dir = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(`${r.env}:dir:${r.location}`));
      await dir.report(r.shard!, core.ids());
    }
    if (r.kind === 'apartment' && core.count === 1 && core.ids()[0] === core.cfg.ownerId) {
      const conn = (this.ctx.getWebSockets().map((w) => w.deserializeAttachment() as Attach).find((x) => x?.id === core.cfg.ownerId))?.conn;
      if (conn) { core.leave(core.cfg.ownerId!, conn, 'alone'); try { const w = this.ctx.getWebSockets(conn)[0]; w?.send(JSON.stringify({ t: 'error', code: 'alone' })); w?.close(4010, 'alone'); } catch { /* already closed */ } }
    }
  }

  // ---- RPC (called by the API Worker only; a room never touches Postgres) ----
  async kick(target: string, until: number, by: string) { const core = this.ensureCore(); if (!core) { this.sql.exec('insert into bans values (?,?,?) on conflict(player) do update set until = max(until, excluded.until)', target, until, by); return { wasPresent: false }; } const r = core.kick(target, until, by); await this.membershipChanged(); return r; }
  async banUntil(player: string) { const r = [...this.sql.exec('select until from bans where player = ?', player)][0]; return r ? Number(r.until) : null; }
  async isPresent(player: string) { return this.ensureCore()?.has(player) ?? false; }
  async members() { return this.ensureCore()?.ids() ?? []; }
  async stats() {
    const core = this.ensureCore();
    return { name: this.meta('name'), members: core?.count ?? 0, sockets: this.ctx.getWebSockets().length,
      ...this.counters, core: core?.stats ?? null, ticking: this.ticking };
  }
}
