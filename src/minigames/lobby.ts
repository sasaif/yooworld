import type { GameRoom, Occupant, SeatIndex } from './types';
import { RulesError } from './types';

/**
 * Rooms / tables. `LobbyService` is the boundary (like EconomyService): `LocalLobbyService` today (in memory, this device,
 * opponents are bots), a remote implementation once a backend is approved (public/private rooms, invites, presence).
 */
export interface LobbyService {
  list(): GameRoom[];
  create(p: { gameId: string; tableId: string; seatCount: number; host: Occupant; visibility?: 'public' | 'private'; options?: Record<string, unknown> }): GameRoom;
  join(roomId: string, who: Occupant, seat?: SeatIndex): GameRoom;
  leave(roomId: string, whoId: string): GameRoom | null;
  fillWithBots(roomId: string, names?: (n: number) => string): GameRoom;
  setStatus(roomId: string, status: GameRoom['status']): GameRoom;
  get(roomId: string): GameRoom | undefined;
}
let n = 0;
export class LocalLobbyService implements LobbyService {
  private rooms = new Map<string, GameRoom>();
  constructor(private readonly now: () => number = () => Date.now()) {}
  list() { return [...this.rooms.values()]; }
  get(id: string) { return this.rooms.get(id); }
  private need(id: string) { const r = this.rooms.get(id); if (!r) throw new RulesError('no_room'); return r; }
  private put(r: GameRoom) { this.rooms.set(r.roomId, r); return r; }
  create({ gameId, tableId, seatCount, host, visibility = 'public', options }: Parameters<LobbyService['create']>[0]) {
    if (seatCount < 1 || seatCount > 8) throw new RulesError('bad_seat_count');
    if (this.list().some((r) => r.tableId === tableId && r.status !== 'finished')) throw new RulesError('table_busy');
    const seats = Array.from({ length: seatCount }, (_, i) => ({ index: i, occupant: i === 0 ? host : null, ready: i === 0 }));
    return this.put({ roomId: `local_${tableId}_${++n}`, gameId, tableId, visibility, status: 'lobby', seats, hostId: host.id, mode: 'local', options, createdAt: this.now() });
  }
  join(roomId: string, who: Occupant, seat?: SeatIndex) {
    const r = this.need(roomId); if (r.status !== 'lobby') throw new RulesError('room_not_open');
    if (r.seats.some((s) => s.occupant?.id === who.id)) throw new RulesError('already_seated');
    const free = seat !== undefined ? r.seats[seat] : r.seats.find((s) => !s.occupant);
    if (!free || free.occupant) throw new RulesError('seat_taken');
    return this.put({ ...r, seats: r.seats.map((s) => (s.index === free.index ? { ...s, occupant: who, ready: true } : s)) });
  }
  leave(roomId: string, whoId: string) {
    const r = this.need(roomId);
    const seats = r.seats.map((s) => (s.occupant?.id === whoId ? { ...s, occupant: null, ready: false } : s));
    if (!seats.some((s) => s.occupant?.kind === 'human')) { this.rooms.delete(roomId); return null; } // last human gone: table closes
    return this.put({ ...r, seats });
  }
  fillWithBots(roomId: string, names = (k: number) => `Bot ${k}`) {
    const r = this.need(roomId); let k = 0;
    return this.put({ ...r, seats: r.seats.map((s) => (s.occupant ? s : { ...s, occupant: { kind: 'bot', id: `bot${++k}`, name: names(k) }, ready: true })) });
  }
  setStatus(roomId: string, status: GameRoom['status']) { return this.put({ ...this.need(roomId), status }); }
}
