/** Protocol mapping between the server room (server/src/core/roomcore.ts, v1) and the client NetworkTransport.
 *  - movement: samples the LOCAL avatar position (read-only, never moves it) and sends at most 5 Hz; after a server
 *    correction it "chases" the local position in steps the server's speed budget accepts. Corrections are NOT
 *    applied to the local avatar: joystick/walk/run feel is untouched by design.
 *  - presence: welcome/joined/left/snap -> remote player table (rendered by render/net/RemotePlayers).
 *  - chat: outgoing with a client id (server dedupes retries), incoming deduped by message id (history replay). */
export interface Vec2 { x: number; z: number }
export interface Remote { id: string; label: string; x: number; z: number; at: number }
export type ServerMsg =
  | { t: 'welcome'; you: string; players: { id: string; pos: Vec2 }[]; seq: number; v: number }
  | { t: 'joined'; id: string; pos: Vec2 } | { t: 'left'; id: string; reason?: string }
  | { t: 'chat'; id: string; from: string; text: string; at: number } | { t: 'history'; msgs: { id: string; from: string; text: string; at: number }[] }
  | { t: 'snap'; seq: number; at: number; p: [string, number, number][] } | { t: 'correct'; pos: Vec2; reason: string }
  | { t: 'error'; code: string } | { t: 'kicked'; until: number };
export interface ChatOut { from: string; text: string; at: number }
export const SEND_MS = 200;          // server moveMinIntervalMs (5 Hz)
export const CHASE_STEP = 0.7;       // m per message < server budget (2.8 * 1.35 * 0.2 = 0.756 m)
export const MOVE_EPS = 0.03;
export const label = (id: string) => `Joueur ${id.replace(/-/g, '').slice(0, 4)}`;

export class NetSync {
  you: string | null = null;
  readonly remotes = new Map<string, Remote>();
  version = 0;                       // bumps when the remote set changes (React re-render)
  corrections = 0;
  private sent: Vec2 | null = null; private seenChat = new Set<string>(); private cid = 0;
  constructor(private emitChat: (m: ChatOut) => void, private now: () => number = Date.now) {}
  /** Position to send this tick (or null): chases `local` from the last position the server accepted. */
  nextMove(local: Vec2 | null): Vec2 | null {
    if (!local || !this.you) return null;
    if (!this.sent) { this.sent = { ...local }; return { ...local }; }
    const dx = local.x - this.sent.x, dz = local.z - this.sent.z, d = Math.hypot(dx, dz);
    if (d < MOVE_EPS) return null;
    const k = d > CHASE_STEP ? CHASE_STEP / d : 1;
    this.sent = { x: +(this.sent.x + dx * k).toFixed(3), z: +(this.sent.z + dz * k).toFixed(3) };
    return { ...this.sent };
  }
  chatPayload(text: string) { return { t: 'chat' as const, text, cid: `c${this.now().toString(36)}${(this.cid++).toString(36)}` }; }
  reset() { this.you = null; this.sent = null; this.remotes.clear(); this.version++; }
  handle(m: ServerMsg) {
    const at = this.now();
    switch (m.t) {
      case 'welcome':
        this.you = m.you; this.remotes.clear();
        for (const p of m.players) { if (p.id === m.you) this.sent = { ...p.pos }; else this.remotes.set(p.id, { id: p.id, label: label(p.id), x: p.pos.x, z: p.pos.z, at }); }
        this.version++; break;
      case 'joined': if (m.id !== this.you) { this.remotes.set(m.id, { id: m.id, label: label(m.id), x: m.pos.x, z: m.pos.z, at }); this.version++; } break;
      case 'left': if (this.remotes.delete(m.id)) this.version++; break;
      case 'snap':
        for (const [id, x, z] of m.p) { const r = this.remotes.get(id); if (r) { r.x = x; r.z = z; r.at = at; } else { this.remotes.set(id, { id, label: label(id), x, z, at }); this.version++; } }
        break;
      case 'correct': this.corrections++; this.sent = { ...m.pos }; break;
      case 'chat': this.chat(m); break;
      case 'history': for (const c of m.msgs) this.chat(c); break;
      default: break;
    }
  }
  private chat(c: { id: string; from: string; text: string; at: number }) {
    if (this.seenChat.has(c.id)) return; this.seenChat.add(c.id);
    if (this.seenChat.size > 500) this.seenChat.delete(this.seenChat.values().next().value!);
    if (c.from === this.you) return;                                   // our own echo: already in the local log
    this.emitChat({ from: label(c.from), text: c.text, at: c.at });
  }
}
