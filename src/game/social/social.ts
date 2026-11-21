import type { NetworkTransport } from '../../net/NetworkTransport';
/** Social layer interfaces (Phase 3+). Local implementations only act on the local player's data;
 *  no invented friends, messages or online players. */
import { CHAT_CONFIG } from './chatConfig';
/** `id` is unique per message (dedupe on reconnect); `at` orders the history (ms). */
export interface ChatMessage { id: string; from: string; text: string; at: number; local: boolean }
export interface ChatService { send(from: string, text: string): ChatMessage; history(): ChatMessage[]; onMessage(cb: (m: ChatMessage) => void): () => void }
export interface FriendsService { list(): string[]; add(id: string): void; remove(id: string): void }
export interface PresenceService { online(roomId: string): string[] }
export interface TradeOffer { id: string; from: string; to: string; give: Record<string, number>; take: Record<string, number>; coins?: number; status: 'open' | 'accepted' | 'declined' }
export interface TradeService { propose(o: Omit<TradeOffer, 'id' | 'status'>): TradeOffer; respond(id: string, accept: boolean): void }
export interface EventsService { upcoming(): { id: string; title: string; at: number; locationId: string }[] }

const BAD = /\b(con|merde|pute)\b/gi; // placeholder filter – replace with server-side moderation
export const sanitize = (t: string) => t.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80).replace(BAD, (w) => '*'.repeat(w.length));

/** Local chat: keeps history, shows bubbles, and forwards to the transport (no-op when offline).
 *  Network-ready: every message has an id (received duplicates are ignored, e.g. a replay after a reconnect) and the
 *  history is kept in `at` order (a late message is inserted at its place). History length: CHAT_CONFIG.historyMax. */
let localSeq = 0;
const sessionTag = Math.random().toString(36).slice(2, 8);
export const newChatId = (from: string) => `${from}:${sessionTag}:${++localSeq}`;
export class LocalChatService implements ChatService {
  private log: ChatMessage[] = []; private subs = new Set<(m: ChatMessage) => void>();
  private seen = new Set<string>(); private seenOrder: string[] = [];
  constructor(private net: NetworkTransport) {
    net.onMessage((m) => {
      if (m.t !== 'chat') return;
      const text = sanitize(m.text); if (!text) return;
      const id = m.id || `${m.playerId}:${m.at}:${text}`;
      this.push({ id, from: m.playerId, text, at: m.at, local: false });
    });
  }
  private remember(id: string) {
    if (this.seen.has(id)) return false;
    this.seen.add(id); this.seenOrder.push(id);
    if (this.seenOrder.length > CHAT_CONFIG.dedupeWindow) this.seen.delete(this.seenOrder.shift()!);
    return true;
  }
  private push(m: ChatMessage) {
    if (!this.remember(m.id)) return; // duplicate (reconnect / replay): already in history, no second bubble
    const log = this.log.slice();
    let i = log.length; while (i > 0 && log[i - 1].at > m.at) i--;
    log.splice(i, 0, m);
    this.log = log.length > CHAT_CONFIG.historyMax ? log.slice(-CHAT_CONFIG.historyMax) : log;
    this.subs.forEach((f) => f(m));
  }
  send(from: string, text: string) {
    const m: ChatMessage = { id: newChatId(from), from, text: sanitize(text), at: Date.now(), local: true };
    if (!m.text) return m; this.push(m); this.net.send({ t: 'chat', playerId: from, text: m.text, at: m.at, id: m.id }); return m;
  }
  history() { return this.log; }
  onMessage(cb: (m: ChatMessage) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
}
export class LocalFriendsService implements FriendsService {
  constructor(private ids: string[], private save: (ids: string[]) => void) {}
  list() { return this.ids; }
  add(id: string) { if (!this.ids.includes(id)) { this.ids = [...this.ids, id]; this.save(this.ids); } }
  remove(id: string) { this.ids = this.ids.filter((x) => x !== id); this.save(this.ids); }
}
