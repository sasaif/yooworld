/**
 * RoomCore — portable, deterministic room logic. NO Cloudflare / Node imports: the host (adapter) supplies time,
 * durable persistence and send/close functions. Runs unchanged in a Durable Object, a Node ws server or Colyseus.
 * Handles: capacity (soft/hard), bans, single-use tickets, session replacement (no duplicate avatar), server-side
 * movement validation (speed, bounds, blocked areas, teleport refused), authoritative chat (rate, length, dedupe),
 * owner kick, and a tick with interest management that sends NOTHING while nobody moves.
 */
export type PlayerId = string;
export interface Vec { x: number; z: number }
export interface Rect { minX: number; maxX: number; minZ: number; maxZ: number }
export type RoomKind = 'public' | 'event' | 'apartment' | 'table' | 'trade';
export interface RoomConfig {
  kind: RoomKind;
  location: string;
  hardCap: number;                 // nobody beyond this (incl. reconnects of new players)
  ownerId?: PlayerId;              // events / apartments
  kickBanMs: number;               // events: 3,600,000 (owner rule, approved)
  maxSpeed: number;                // m/s: client run speed (2.8) — the client joystick/walk/run are NOT changed
  speedTolerance: number;          // multiplicative slack for jitter
  slackM: number;                  // additive slack (m)
  bounds: Rect;
  blocked: Rect[];                 // non-walkable rectangles (server walk grid, coarse)
  spawn: Vec;
  interestRadius: number;          // m: near players every tick, far players every `farEvery` ticks
  farEvery: number;
  chatMaxLen: number; chatPerWindow: number; chatWindowMs: number;
  moveMinIntervalMs: number;       // 5 Hz input → 200 ms; faster inputs are coalesced (last wins), not trusted more
}
export interface Persist {
  getBan(p: PlayerId): number | null;
  putBan(p: PlayerId, until: number, by: PlayerId): void;
  useTicket(jti: string, exp: number): boolean;     // false if already used
  /** Optional durable chat history (DO SQLite): the last CHAT_HISTORY messages survive hibernation/eviction. */
  appendChat?(m: ChatMsg): void;
  recentChat?(limit: number): ChatMsg[];
}
export interface ChatMsg { id: string; from: PlayerId; text: string; at: number }
/** Messages replayed to a joining player (newest last). Technical value. */
export const CHAT_HISTORY = 50;
export type Out =
  | { t: 'welcome'; you: PlayerId; players: { id: PlayerId; pos: Vec }[]; seq: number; v: 1 }
  | { t: 'joined'; id: PlayerId; pos: Vec }
  | { t: 'left'; id: PlayerId; reason?: string }
  | { t: 'chat'; id: string; from: PlayerId; text: string; at: number }
  | { t: 'history'; msgs: ChatMsg[] }
  | { t: 'snap'; seq: number; at: number; p: [PlayerId, number, number][] }
  | { t: 'correct'; pos: Vec; reason: string }
  | { t: 'error'; code: string; detail?: string }
  | { t: 'kicked'; until: number };
export type In =
  | { t: 'move'; x: number; z: number; seq?: number; run?: boolean }
  | { t: 'chat'; text: string; cid: string }
  | { t: 'ping' };
export interface JoinResult { ok: boolean; code?: 'full' | 'kicked' | 'ticket_used' | 'expired'; until?: number; replaced?: string; pos?: Vec }
export interface RoomStats { members: number; msgsIn: number; msgsOut: number; bytesOut: number; ticks: number; idleTicksSkipped: number; corrections: number }

interface Member { id: PlayerId; conn: string; pos: Vec; lastMoveAt: number; movedTick: number; chat: number[]; seen: Set<string>; winStart: number; winN: number; warned: boolean; budget: number; budgetAt: number }
/** Per-connection message rate limits (all message types): soft = drop + one warning, hard = disconnect 4008. */
export const MSG_RATE = { windowMs: 1000, soft: 20, hard: 60 } as const;

export class RoomCore {
  private members = new Map<PlayerId, Member>();
  private seq = 0;
  readonly stats: RoomStats = { members: 0, msgsIn: 0, msgsOut: 0, bytesOut: 0, ticks: 0, idleTicksSkipped: 0, corrections: 0 };
  constructor(readonly cfg: RoomConfig, private persist: Persist, private sendRaw: (conn: string, m: Out) => number | void,
              private close: (conn: string, code: number, reason: string) => void, private now: () => number) {}

  get count() { return this.members.size; }
  ids() { return [...this.members.keys()]; }
  has(id: PlayerId) { return this.members.has(id); }
  positionOf(id: PlayerId) { return this.members.get(id)?.pos; }

  /** Re-attach a connection after hibernation / eviction (state rebuilt from socket attachments). */
  restore(id: PlayerId, conn: string, pos: Vec) {
    this.members.set(id, { id, conn, pos, lastMoveAt: this.now(), movedTick: -1e9, chat: [], seen: new Set(), winStart: 0, winN: 0, warned: false, budget: this.budgetCap(), budgetAt: this.now() });
  }

  /** All refusal checks of join() (the ticket jti is consumed here, so a refused ticket cannot be retried). */
  precheck(id: PlayerId, jti: string, exp: number): JoinResult | null {
    if (exp < this.now()) return { ok: false, code: 'expired' };
    if (!this.persist.useTicket(jti, exp)) return { ok: false, code: 'ticket_used' };
    const until = this.persist.getBan(id);
    if (until && until > this.now()) return { ok: false, code: 'kicked', until };
    if (!this.members.has(id) && this.members.size >= this.cfg.hardCap) return { ok: false, code: 'full' };
    this.prechecked = jti;
    return null;
  }
  private prechecked: string | null = null;
  join(id: PlayerId, conn: string, jti: string, exp: number, spawn: Vec = this.cfg.spawn): JoinResult {
    if (this.prechecked !== jti) { const r = this.precheck(id, jti, exp); if (r) return r; }
    this.prechecked = null;
    const existing = this.members.get(id);
    let replaced: string | undefined;
    if (existing) {                                   // reconnection = session replacement, never a 2nd avatar
      replaced = existing.conn; this.close(existing.conn, 4001, 'replaced'); this.members.delete(id);
    }
    const pos = existing?.pos ?? this.clampSpawn(spawn);
    this.members.set(id, { id, conn, pos, lastMoveAt: this.now(), movedTick: -1e9, chat: [], seen: existing?.seen ?? new Set(), winStart: 0, winN: 0, warned: false, budget: this.budgetCap(), budgetAt: this.now() });
    this.send(conn, { t: 'welcome', you: id, players: [...this.members.values()].map((m) => ({ id: m.id, pos: m.pos })), seq: this.seq, v: 1 });
    const hist = this.persist.recentChat?.(CHAT_HISTORY) ?? [];
    if (hist.length) this.send(conn, { t: 'history', msgs: hist });
    if (!existing) this.broadcast({ t: 'joined', id, pos }, id);
    return { ok: true, replaced, pos };
  }
  leave(id: PlayerId, conn: string, reason = 'left') {
    const m = this.members.get(id); if (!m || m.conn !== conn) return false;   // stale socket of a replaced session
    this.members.delete(id); this.broadcast({ t: 'left', id, reason }); return true;
  }
  onMessage(id: PlayerId, msg: In) {
    const m = this.members.get(id); if (!m || !msg || typeof msg !== 'object') return;
    this.stats.msgsIn++;
    const now = this.now();
    if (now - m.winStart >= MSG_RATE.windowMs) { m.winStart = now; m.winN = 0; m.warned = false; }
    if (++m.winN > MSG_RATE.hard) { this.close(m.conn, 4008, 'rate'); this.members.delete(id); this.broadcast({ t: 'left', id, reason: 'rate' }); return; }
    if (m.winN > MSG_RATE.soft) { if (!m.warned) { m.warned = true; this.send(m.conn, { t: 'error', code: 'rate_limited' }); } return; }
    if (msg.t === 'move') return this.move(m, msg);
    if (msg.t === 'chat') return this.chat(m, msg);
  }
  private walkable(x: number, z: number) {
    const b = this.cfg.bounds;
    if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) return false;
    return !this.cfg.blocked.some((r) => x > r.minX && x < r.maxX && z > r.minZ && z < r.maxZ);
  }
  private budgetCap() { return this.cfg.maxSpeed * this.cfg.speedTolerance * 2 * this.cfg.moveMinIntervalMs / 1000 + this.cfg.slackM; }
  private clampSpawn(p: Vec): Vec { return this.walkable(p.x, p.z) ? p : this.cfg.spawn; }
  private move(m: Member, msg: { x: number; z: number }) {
    const now = this.now();
    if (typeof msg.x !== 'number' || typeof msg.z !== 'number' || !Number.isFinite(msg.x) || !Number.isFinite(msg.z))
      return this.send(m.conn, { t: 'error', code: 'bad_move' });
    if (!this.walkable(msg.x, msg.z)) { this.stats.corrections++; return this.send(m.conn, { t: 'correct', pos: m.pos, reason: 'not_walkable' }); }
    // Distance budget (token bucket): refills at maxSpeed x tolerance per second, capped at 0.4 s of travel + slack.
    // Normal 5 Hz input at full run speed never empties it; bursts / speed hacks cannot exceed the run speed.
    const rate = this.cfg.maxSpeed * this.cfg.speedTolerance;
    m.budget = Math.min(this.budgetCap(), m.budget + rate * Math.max(0, now - m.budgetAt) / 1000); m.budgetAt = now;
    const dist = Math.hypot(msg.x - m.pos.x, msg.z - m.pos.z);
    if (dist > m.budget) {
      this.stats.corrections++; return this.send(m.conn, { t: 'correct', pos: m.pos, reason: 'too_fast' });
    }
    m.budget -= dist;
    m.pos = { x: msg.x, z: msg.z }; m.lastMoveAt = now; m.movedTick = this.seq + 1;
  }
  private chat(m: Member, msg: { text: string; cid: string }) {
    const now = this.now();
    if (typeof msg.cid !== 'string' || msg.cid.length > 64) return this.send(m.conn, { t: 'error', code: 'bad_chat' });
    m.chat = m.chat.filter((t) => now - t < this.cfg.chatWindowMs);
    if (m.seen.has(msg.cid)) return;                   // client retry after reconnect: drop duplicate
    if (m.chat.length >= this.cfg.chatPerWindow) return this.send(m.conn, { t: 'error', code: 'chat_rate' });
    const text = String(msg.text ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, this.cfg.chatMaxLen);
    if (!text) return;
    m.chat.push(now); m.seen.add(msg.cid); if (m.seen.size > 200) m.seen.delete(m.seen.values().next().value!);
    const c: ChatMsg = { id: `${m.id}:${msg.cid}`, from: m.id, text, at: now };
    this.persist.appendChat?.(c);                                                         // durable BEFORE broadcast
    this.broadcast({ t: 'chat', ...c });   // server timestamp orders history
  }
  /** Owner kick (authorised by the API: owner check + Postgres record happen there). Ban is durable BEFORE close. */
  kick(target: PlayerId, until: number, by: PlayerId) {
    this.persist.putBan(target, until, by);
    const m = this.members.get(target);
    if (m) { this.send(m.conn, { t: 'kicked', until }); this.close(m.conn, 4003, 'kicked'); this.members.delete(target); this.broadcast({ t: 'left', id: target, reason: 'kicked' }); }
    return { until, wasPresent: !!m };
  }
  /** Host calls this at 10 Hz ONLY while it returns true. Near movers every tick, far movers every `farEvery`
   *  ticks; idle avatars are never sent. Returns false when nobody moved recently (host stops the timer). */
  tick(): boolean {
    const t = this.seq + 1; const fe = this.cfg.farEvery;
    const recent = [...this.members.values()].filter((m) => m.movedTick > t - fe);
    if (!recent.length) { this.stats.idleTicksSkipped++; return false; }
    this.seq = t; this.stats.ticks++; const at = this.now(); const farTick = t % fe === 0;
    for (const r of this.members.values()) {
      const p: [PlayerId, number, number][] = [];
      for (const d of recent) {
        if (d.id === r.id) continue;
        const near = Math.hypot(d.pos.x - r.pos.x, d.pos.z - r.pos.z) <= this.cfg.interestRadius;
        if ((near && d.movedTick === t) || (!near && farTick)) p.push([d.id, +d.pos.x.toFixed(2), +d.pos.z.toFixed(2)]);
      }
      if (p.length) this.send(r.conn, { t: 'snap', seq: t, at, p });
    }
    return true;
  }
  private send(conn: string, m: Out) { this.stats.msgsOut++; const n = this.sendRaw(conn, m); if (typeof n === 'number') this.stats.bytesOut += n; }
  private broadcast(m: Out, except?: PlayerId) { for (const x of this.members.values()) if (x.id !== except) this.send(x.conn, m); }
}
