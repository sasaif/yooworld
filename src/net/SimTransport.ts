import type { NetMessage, NetStatus, NetworkTransport } from './NetworkTransport';
/** LOCAL SIMULATION transport (?chatSim=1 | ?chatSim=bc). NOT multiplayer: there is no server and status stays
 *  'offline', so the HUD keeps saying « Mode local ». It lets tests inject "received" messages through the real
 *  LocalChatService path (sanitize, dedupe, ordering, bubbles), and with ?chatSim=bc it relays chat between tabs of
 *  the SAME browser profile (BroadcastChannel) — a same-browser simulation, never network play. */
export class SimTransport implements NetworkTransport {
  readonly status: NetStatus = 'offline';
  readonly simulated = true;
  private subs = new Set<(m: NetMessage) => void>();
  private bc: { postMessage(m: unknown): void; close(): void; onmessage: ((e: { data: unknown }) => void) | null } | null = null;
  readonly tabId = Math.random().toString(36).slice(2, 7);
  constructor(opts: { broadcast?: boolean } = {}) {
    const BC = (globalThis as unknown as { BroadcastChannel?: new (n: string) => NonNullable<SimTransport['bc']> }).BroadcastChannel;
    if (opts.broadcast && BC) {
      this.bc = new BC('yoland-chat-sim');
      this.bc.onmessage = (e) => { const m = e.data as NetMessage; if (m && (m as { t?: string }).t === 'chat') this.receive(m); };
    }
  }
  get broadcasting() { return !!this.bc; }
  async connect() { /* nothing to connect to: simulation */ }
  disconnect() { this.bc?.close(); this.bc = null; }
  send(msg: NetMessage) {
    // other tabs see this tab as its own sender id (else both tabs' 'f' would be the same avatar)
    if (this.bc && msg.t === 'chat') this.bc.postMessage({ ...msg, playerId: `tab-${this.tabId}-${msg.playerId}` });
  }
  /** deliver a message as if it came from the network */
  receive(msg: NetMessage) { this.subs.forEach((f) => f(msg)); }
  onMessage(cb: (msg: NetMessage) => void) { this.subs.add(cb); return () => { this.subs.delete(cb); }; }
}
export function simTransportFromSearch(search: string): SimTransport | null {
  try {
    const v = new URLSearchParams(search.startsWith('?') ? search : '?' + search).get('chatSim');
    if (v == null) return null;
    return new SimTransport({ broadcast: v === 'bc' });
  } catch { return null; }
}
