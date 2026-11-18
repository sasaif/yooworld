import type { NetworkTransport } from '../../net/NetworkTransport';
/** Social layer interfaces (Phase 3+). Local implementations only act on the local player's data;
 *  no invented friends, messages or online players. */
export interface ChatMessage { from: string; text: string; at: number; local: boolean }
export interface ChatService { send(from: string, text: string): ChatMessage; history(): ChatMessage[]; onMessage(cb: (m: ChatMessage) => void): () => void }
export interface FriendsService { list(): string[]; add(id: string): void; remove(id: string): void }
export interface PresenceService { online(roomId: string): string[] }
export interface TradeOffer { id: string; from: string; to: string; give: Record<string, number>; take: Record<string, number>; coins?: number; status: 'open' | 'accepted' | 'declined' }
export interface TradeService { propose(o: Omit<TradeOffer, 'id' | 'status'>): TradeOffer; respond(id: string, accept: boolean): void }
export interface EventsService { upcoming(): { id: string; title: string; at: number; locationId: string }[] }

const BAD = /\b(con|merde|pute)\b/gi; // placeholder filter – replace with server-side moderation
export const sanitize = (t: string) => t.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80).replace(BAD, (w) => '*'.repeat(w.length));

/** Local chat: keeps history, shows bubbles, and forwards to the transport (no-op when offline). */
export class LocalChatService implements ChatService {
  private log: ChatMessage[] = []; private subs = new Set<(m: ChatMessage) => void>();
  constructor(private net: NetworkTransport) {
    net.onMessage((m) => { if (m.t === 'chat') this.push({ from: m.playerId, text: sanitize(m.text), at: m.at, local: false }); });
  }
  private push(m: ChatMessage) { this.log = [...this.log.slice(-49), m]; this.subs.forEach((f) => f(m)); }
  send(from: string, text: string) {
    const m = { from, text: sanitize(text), at: Date.now(), local: true };
    if (!m.text) return m; this.push(m); this.net.send({ t: 'chat', playerId: from, text: m.text, at: m.at }); return m;
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
