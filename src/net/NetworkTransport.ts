/** Networking boundary for future multiplayer. Nothing in the game fakes remote players:
 *  with OfflineTransport the world contains only local characters, and the UI says so. */
export type NetStatus = 'offline' | 'connecting' | 'online';
export type NetMessage =
  | { t: 'presence'; playerId: string; name: string; appearance: unknown; x: number; z: number; yaw: number }
  | { t: 'move'; playerId: string; path: [number, number][]; run: boolean }
  | { t: 'sit'; playerId: string; itemUid: string; slot: number }
  | { t: 'chat'; playerId: string; text: string; at: number }
  | { t: 'emote'; playerId: string; emote: string }
  | { t: 'furniture'; roomId: string; op: 'place' | 'move' | 'remove' | 'toggle'; payload: unknown }
  | { t: 'leave'; playerId: string };
export interface NetworkTransport {
  readonly status: NetStatus;
  connect(roomId: string, playerId: string): Promise<void>;
  disconnect(): void;
  send(msg: NetMessage): void;
  onMessage(cb: (msg: NetMessage) => void): () => void;
}
/** Default transport: offline. send() is a no-op, no messages are ever received. */
export class OfflineTransport implements NetworkTransport {
  readonly status: NetStatus = 'offline';
  async connect() { /* no server yet – see docs/05-technique.md §Multijoueur */ }
  disconnect() {}
  send(_msg: NetMessage) {}
  onMessage() { return () => {}; }
}
