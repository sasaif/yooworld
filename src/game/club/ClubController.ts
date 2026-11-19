import { Store } from '../../core/store';
import { goTo, say, world } from '../world';
import { freeSeat } from '../apartment/worldSync';
import type { GameController } from '../GameController';
import { LocalLobbyService } from '../../minigames/lobby';
import { LocalGameHost } from '../../minigames/LocalGameHost';
import { newSeed } from '../../minigames/rng';
import { dominoes, type DominoMove, type DominoOptions, type DominoState, type DominoView } from '../../minigames/dominoes/rules';
import { dominoBot } from '../../minigames/dominoes/bot';
import { gameById } from '../../minigames/registry';
import type { GameResult, GameRoom } from '../../minigames/types';
import { CLUB_TABLES, chairsFor, clubItemPos, tableOf, type ClubTable } from './clubLayout';

/**
 * Yoo Games Club glue between the 3D place (avatars, chairs, sit/stand) and the mini-game framework.
 * Local mode only: one human + bots on this device. Nothing is persisted (no save, no stats), nothing pays Gold/XP.
 */
export type ClubPhase = 'seating' | 'playing' | 'results';
export interface ClubSession {
  table: ClubTable; room: GameRoom; seatChairs: string[];
  host: LocalGameHost<DominoState, DominoMove, DominoView>;
  phase: ClubPhase; startedAt: number;
}
export interface ClubState {
  /** table whose setup sheet is open */
  setup: string | null;
  setupOpts: { players: 2 | 3 | 4; mode: DominoOptions['mode'] };
  session: ClubSession | null;
  /** bumps on every game update so React re-renders */
  tick: number;
  /** results of this session only (memory; cleared on reload) */
  history: GameResult[];
}
const botDelay = () => { try { const v = Number(new URLSearchParams(location.search).get('botms')); return v >= 0 && v <= 3000 && new URLSearchParams(location.search).has('botms') ? v : 750; } catch { return 750; } };

export class ClubController {
  readonly store = new Store<ClubState>({ setup: null, setupOpts: { players: 4, mode: 'single' }, session: null, tick: 0, history: [] });
  readonly lobby = new LocalLobbyService();
  private seatTimer: ReturnType<typeof setInterval> | null = null;
  private unsub: (() => void) | null = null;
  constructor(readonly game: GameController) {
    // leaving the club (Lieux, reload…) closes the table: nothing survives outside the room
    game.store.subscribe(() => { if (this.s.session && game.s.location !== 'club') this.leave(true); });
  }
  get s() { return this.store.get(); }
  get me() { return world.chars[this.game.s.activeChar]; }

  // ---------- 3D interactions ----------
  /** Tap menu actions on club furniture (tables + chairs). */
  act(uid: string, action: 'play' | 'sit' | 'look') {
    this.game.store.set({ menuItem: null });
    const t = tableOf(uid); const me = this.me; if (!me) return;
    if (action === 'sit') {
      const seat = freeSeat(uid, me.pos, me.id, 'sit'); if (!seat) return this.game.toast('Plus de place !');
      if (!goTo(me.id, seat.front, { seat })) this.game.toast('Je ne peux pas y aller');
      return;
    }
    if (action === 'look' || !t) { say(me.id, t ? `${gameById(t.gameId)?.name ?? 'Ce jeu'} arrive bientôt au club !` : 'Joli club !', 3000); return; }
    if (gameById(t.gameId)?.status !== 'playable') { say(me.id, `${gameById(t.gameId)?.name} arrive bientôt au club !`, 3000); return; }
    this.openSetup(t.id, t.chairs.includes(uid) ? uid : undefined);
  }
  private prefChair: string | undefined;
  openSetup(tableId = 't_dominoes', chair?: string) {
    if (this.s.session) return; this.prefChair = chair;
    this.store.set({ setup: tableId }); this.game.store.set({ panel: null, menuItem: null });
  }
  closeSetup() { this.store.set({ setup: null }); }
  setOpts(p: Partial<ClubState['setupOpts']>) { this.store.set({ setupOpts: { ...this.s.setupOpts, ...p } }); }

  /** Create the local room, walk to the chair, sit, then deal. */
  start() {
    const t = CLUB_TABLES.find((x) => x.id === this.s.setup); const me = this.me; if (!t || !me) return;
    const { players, mode } = this.s.setupOpts;
    const others = new Set(Object.values(world.chars).filter((c) => c.id !== me.id).map((c) => (c.sitOn ?? c.pendingSeat)?.id.split(':')[0]));
    const order = [this.prefChair, ...t.chairs].filter((c): c is string => !!c && !others.has(c));
    const humanChair = order[0]; if (!humanChair) return this.game.toast('Plus de place à cette table');
    const seatChairs = chairsFor(t, humanChair, players);
    if (seatChairs.some((c, i) => i > 0 && others.has(c))) return this.game.toast('Une chaise est déjà prise');
    let room: GameRoom;
    try {
      room = this.lobby.create({ gameId: t.gameId, tableId: t.id, seatCount: players, host: { kind: 'human', id: me.id, name: me.name }, options: { mode } });
      room = this.lobby.fillWithBots(room.roomId);
    } catch { return this.game.toast('Table occupée'); }
    const bots = Object.fromEntries(room.seats.filter((s) => s.occupant?.kind === 'bot').map((s, k) => [s.index, dominoBot(k + 1)]));
    const host = new LocalGameHost<DominoState, DominoMove, DominoView>(dominoes, room, { seed: newSeed(), bots, botDelayMs: botDelay(), options: { mode, target: 100 } });
    const session: ClubSession = { table: t, room, seatChairs, host, phase: 'seating', startedAt: Date.now() };
    this.unsub = host.subscribe(() => this.onHost());
    this.store.set({ setup: null, session });
    // sit down on the chosen chair (existing sit system), then deal
    const seat = world.seats.find((s) => s.id === `${humanChair}:0`);
    const sitting = () => me.mode === 'sitting' && me.sitOn?.id === `${humanChair}:0`;
    if (!sitting()) { if (!seat || !goTo(me.id, seat.front, { seat })) { this.leave(); return this.game.toast('Je ne peux pas aller à la table'); } }
    const t0 = performance.now();
    this.seatTimer = setInterval(() => {
      if (!this.s.session || this.s.session.phase !== 'seating') return this.clearSeatTimer();
      if (sitting()) { this.clearSeatTimer(); this.store.set({ session: { ...this.s.session, phase: 'playing' } }); host.start(); say(me.id, 'Allez, une partie de dominos ! 🎲', 2500); return; }
      const lost = me.mode !== 'walk' && me.mode !== 'sitting' && !me.pendingSeat && performance.now() - t0 > 800;
      if (lost || performance.now() - t0 > 20000) { this.clearSeatTimer(); this.leave(); this.game.toast('Partie annulée : je n’ai pas pu m’asseoir'); }
    }, 150);
  }
  private clearSeatTimer() { if (this.seatTimer) { clearInterval(this.seatTimer); this.seatTimer = null; } }
  private onHost() {
    const ses = this.s.session; if (!ses) return;
    if (ses.host.result && ses.phase !== 'results') {
      this.store.set({ session: { ...ses, phase: 'results' }, history: [...this.s.history, ses.host.result].slice(-20) });
      const me = this.me; const won = ses.host.result.winners.includes(0) && ses.host.result.endedBy === 'normal';
      if (me && ses.host.result.endedBy === 'normal') say(me.id, won ? 'Domino ! 🎉' : 'Bien joué les bots !', 3000);
    }
    this.store.set({ tick: this.s.tick + 1 });
  }
  /** Human move from the table overlay. */
  play(move: DominoMove) { const ses = this.s.session; if (!ses || ses.phase !== 'playing') return false; return ses.host.submit(0, move).ok; }
  nextRound() { this.s.session?.host.advance(); }
  /** Same table, same options, new deal (avatar stays seated). */
  replay() {
    const ses = this.s.session; if (!ses) return;
    const me = this.me; const chair = ses.seatChairs[0];
    this.close(false);
    this.prefChair = chair; this.store.set({ setup: ses.table.id, setupOpts: { players: ses.room.seats.length as 2 | 3 | 4, mode: (ses.room.options?.mode as DominoOptions['mode']) ?? 'single' } });
    if (me) this.start();
  }
  /** Leave the table: abandon a running game, stand up. */
  leave(silent = false) {
    const ses = this.s.session; if (!ses) return;
    this.close(true);
    const me = this.me;
    if (!silent && me?.mode === 'sitting' && me.sitOn) goTo(me.id, me.sitOn.front.clone());
  }
  private close(abandon: boolean) {
    const ses = this.s.session; if (!ses) return;
    this.clearSeatTimer(); this.unsub?.(); this.unsub = null;
    if (!ses.host.result) ses.host.stop('abandon'); else ses.host.stop();
    if (abandon && ses.host.result?.endedBy === 'abandon' && ses.phase === 'playing') this.store.set({ history: [...this.s.history, ses.host.result].slice(-20) });
    this.lobby.leave(ses.room.roomId, ses.room.hostId);
    this.store.set({ session: null });
  }
  /** chair → occupant label (bots shown as "Bot n", never as players) */
  chairLabels(): { chair: string; name: string; seat: number; bot: boolean; pos: { x: number; z: number } }[] {
    const ses = this.s.session; if (!ses) return [];
    return ses.seatChairs.map((c, i) => { const p = clubItemPos(c); const o = ses.room.seats[i].occupant; return { chair: c, name: o?.name ?? '', seat: i, bot: o?.kind === 'bot', pos: { x: p.x, z: p.z } }; });
  }
}
