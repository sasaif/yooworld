import { Store } from '../../core/store';
import { goTo, makeChar, say, world, type Seat } from '../world';
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
import { botLooks } from './botAvatars';
import type { Look } from '../../fashion/types';

/**
 * Yoo Games Club glue between the 3D place (avatars, chairs, sit/stand) and the mini-game framework.
 * Local mode only: one human + bots on this device. Nothing is persisted (no save, no stats), nothing pays Gold/XP.
 * Bots are seated YooWorld avatars (ordinary looks from the catalogue, display only) registered in `world.chars` as
 * `bot_<seat>` while their table runs, so chairs, sit / stand transitions and speech bubbles are the existing ones.
 * Leaving is always clean: one `close()` path stops the host (no timer left), the bots stand up and go away, the player
 * stands up, and a new game can be started right after.
 */
export type ClubPhase = 'seating' | 'playing' | 'results';
export interface ClubSession {
  table: ClubTable; room: GameRoom; seatChairs: string[];
  host: LocalGameHost<DominoState, DominoMove, DominoView>;
  phase: ClubPhase; startedAt: number;
}
/** A seated bot avatar (render: src/render/club/ClubBots.tsx). */
export interface ClubBot { id: string; seat: number; chair: string; name: string; look: Look }
export interface ClubState {
  /** table whose setup sheet is open */
  setup: string | null;
  setupOpts: { players: 2 | 3 | 4; mode: DominoOptions['mode'] };
  session: ClubSession | null;
  /** bot avatars at the table (also while they stand up after the game) */
  bots: ClubBot[];
  /** "leave the table?" dialog open (the bots are paused meanwhile) */
  confirmLeave: boolean;
  /** bumps on every game update so React re-renders */
  tick: number;
  /** results of this session only (memory; cleared on reload) */
  history: GameResult[];
}
const param = (k: string) => { try { const q = new URLSearchParams(location.search); return q.has(k) ? Number(q.get(k)) : NaN; } catch { return NaN; } };
const botDelay = () => { const v = param('botms'); return v >= 0 && v <= 3000 ? v : 750; };
/** test-only fixed deal (?clubseed=N), like ?botms= */
const fixedSeed = () => { const v = param('clubseed'); return Number.isInteger(v) && v > 0 ? v >>> 0 : null; };
const BOT_LEAVE_MS = 1700;

export class ClubController {
  readonly store = new Store<ClubState>({ setup: null, setupOpts: { players: 4, mode: 'single' }, session: null, bots: [], confirmLeave: false, tick: 0, history: [] });
  readonly lobby = new LocalLobbyService();
  private seatTimer: ReturnType<typeof setInterval> | null = null;
  private guardTimer: ReturnType<typeof setInterval> | null = null;
  private botsTimer: ReturnType<typeof setTimeout> | null = null;
  private unsub: (() => void) | null = null;
  private lastThinking: number | null = null; private lastLog = 0;
  constructor(readonly game: GameController) {
    // leaving the club (Lieux, reload…) closes the table: nothing survives outside the room
    game.store.subscribe(() => { if ((this.s.session || this.s.bots.length || this.s.setup) && game.s.location !== 'club') this.leave(true); });
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

  /** Create the local room, walk to the chair, sit, then deal. `keepBots`: rematch with the same bots already seated. */
  start(keepBots = false) {
    const t = CLUB_TABLES.find((x) => x.id === this.s.setup); const me = this.me; if (!t || !me || this.s.session) return;
    if (!keepBots) this.removeBots();
    const { players, mode } = this.s.setupOpts;
    const botIds = new Set(this.s.bots.map((b) => b.id));
    const others = new Set(Object.values(world.chars).filter((c) => c.id !== me.id && !botIds.has(c.id)).map((c) => (c.sitOn ?? c.pendingSeat)?.id.split(':')[0]));
    const order = [this.prefChair, ...t.chairs].filter((c): c is string => !!c && !others.has(c));
    const humanChair = order[0]; if (!humanChair) return this.game.toast('Plus de place à cette table');
    const seatChairs = chairsFor(t, humanChair, players);
    if (seatChairs.some((c, i) => i > 0 && others.has(c))) return this.game.toast('Une chaise est déjà prise');
    let room: GameRoom;
    try {
      room = this.lobby.create({ gameId: t.gameId, tableId: t.id, seatCount: players, host: { kind: 'human', id: me.id, name: me.name }, options: { mode } });
      room = this.lobby.fillWithBots(room.roomId);
    } catch { return this.game.toast('Table occupée'); }
    const seed = fixedSeed() ?? newSeed();
    const bots = Object.fromEntries(room.seats.filter((s) => s.occupant?.kind === 'bot').map((s, k) => [s.index, dominoBot(k + 1)]));
    const host = new LocalGameHost<DominoState, DominoMove, DominoView>(dominoes, room, { seed, bots, botDelayMs: botDelay(), options: { mode, target: 100 } });
    const session: ClubSession = { table: t, room, seatChairs, host, phase: 'seating', startedAt: Date.now() };
    this.lastThinking = null; this.lastLog = 0;
    this.unsub = host.subscribe(() => this.onHost());
    this.store.set({ setup: null, session, confirmLeave: false });
    const same = keepBots && this.s.bots.length === players - 1 && this.s.bots.every((b) => seatChairs[b.seat] === b.chair && world.chars[b.id]);
    if (!same) { this.removeBots(); this.seatBots(room, seatChairs, seed); }
    // sit down on the chosen chair (existing sit system), then deal
    const seat = world.seats.find((s) => s.id === `${humanChair}:0`);
    const sitting = () => me.mode === 'sitting' && me.sitOn?.id === `${humanChair}:0`;
    if (!sitting()) { if (!seat || !goTo(me.id, seat.front, { seat })) { this.leave(); return this.game.toast('Je ne peux pas aller à la table'); } }
    const t0 = performance.now();
    this.seatTimer = setInterval(() => {
      if (!this.s.session || this.s.session.phase !== 'seating') return this.clearSeatTimer();
      if (sitting()) {
        this.clearSeatTimer(); this.store.set({ session: { ...this.s.session, phase: 'playing' } }); host.start(); this.armGuard();
        say(me.id, 'Allez, une partie de dominos ! 🎲', 2500); return;
      }
      const lost = me.mode !== 'walk' && me.mode !== 'sitting' && !me.pendingSeat && performance.now() - t0 > 800;
      if (lost || performance.now() - t0 > 20000) { this.clearSeatTimer(); this.leave(); this.game.toast('Partie annulée : je n’ai pas pu m’asseoir'); }
    }, 150);
  }
  private clearSeatTimer() { if (this.seatTimer) { clearInterval(this.seatTimer); this.seatTimer = null; } }
  /** Safety net: if the player's avatar stops being seated at the table (any path), the table closes cleanly. */
  private armGuard() {
    this.clearGuard();
    this.guardTimer = setInterval(() => {
      const ses = this.s.session; const me = this.me; if (!ses) return this.clearGuard();
      if (ses.phase === 'seating') return;
      const seated = !!me && (me.mode === 'sitting' || (me.mode === 'standing' && !me.path.length)) && me.sitOn?.id === `${ses.seatChairs[0]}:0`;
      if (!seated) { const playing = ses.phase === 'playing'; this.close(true); this.dismissBots(false); if (playing) this.game.toast('Tu as quitté la table : partie abandonnée'); }
    }, 400);
  }
  private clearGuard() { if (this.guardTimer) { clearInterval(this.guardTimer); this.guardTimer = null; } }

  // ---------- bot avatars ----------
  private seatBots(room: GameRoom, seatChairs: string[], seed: number) {
    const bots = room.seats.filter((s) => s.occupant?.kind === 'bot'); const looks = botLooks(bots.length, seed);
    const out: ClubBot[] = [];
    bots.forEach((s, k) => {
      const chair = seatChairs[s.index]; const seat = world.seats.find((x) => x.id === `${chair}:0`); if (!seat) return;
      const id = `bot_${s.index}`; const from = seat.front;
      const c = makeChar(id, s.occupant!.name, from.x, from.z, seat.yaw + Math.PI);
      c.pendingSeat = seat; world.chars[id] = c;
      out.push({ id, seat: s.index, chair, name: s.occupant!.name, look: looks[k] });
    });
    this.store.set({ bots: out });
  }
  /** bots get up and walk off their chair, then disappear (or at once: travel / new table) */
  private dismissBots(now: boolean) {
    if (this.botsTimer) { clearTimeout(this.botsTimer); this.botsTimer = null; }
    if (now) return this.removeBots();
    for (const b of this.s.bots) { const c = world.chars[b.id]; const seat = c?.sitOn ?? c?.pendingSeat as Seat | undefined; if (c && seat) { c.pendingSeat = undefined; if (c.mode === 'sitting' && !goTo(b.id, seat.front.clone())) { c.mode = 'standing'; c.path = []; } } }
    this.botsTimer = setTimeout(() => { this.botsTimer = null; this.removeBots(); }, BOT_LEAVE_MS);
  }
  private removeBots() {
    if (this.botsTimer) { clearTimeout(this.botsTimer); this.botsTimer = null; }
    for (const b of this.s.bots) delete world.chars[b.id];
    if (this.s.bots.length) this.store.set({ bots: [] });
  }
  botId(seat: number) { return this.s.bots.find((b) => b.seat === seat)?.id; }

  private onHost() {
    const ses = this.s.session; if (!ses) return;
    const h = ses.host;
    // speech bubbles on the bot avatars: thinking, draw, pass (existing bubble system, 0 draw call)
    const log = h.engine.log;
    for (let i = this.lastLog; i < log.length; i++) {
      const r = log[i]; const id = r.seat !== null && r.seat > 0 ? this.botId(r.seat) : undefined; if (!id || r.move === 'advance') continue;
      if (r.move.type === 'draw') say(id, 'Je pioche', 900); else if (r.move.type === 'pass') say(id, 'Je passe', 1100);
      else if (h.state.hands[r.seat!].length === 0) say(id, 'Domino ! 🎉', 2500);
    }
    this.lastLog = log.length;
    if (h.thinking !== this.lastThinking) {
      this.lastThinking = h.thinking;
      const id = h.thinking !== null ? this.botId(h.thinking) : undefined; const c = id ? world.chars[id] : undefined;
      if (id && c && !(c.say && c.say.until > performance.now())) say(id, '🤔 …', (h.opts.botDelayMs ?? 700) + 150);
    }
    if (h.result && ses.phase !== 'results') {
      this.store.set({ session: { ...ses, phase: 'results' }, history: [...this.s.history, h.result].slice(-20), confirmLeave: false });
      const me = this.me; const won = h.result.winners.includes(0) && h.result.endedBy === 'normal';
      if (me && h.result.endedBy === 'normal') say(me.id, won ? 'Domino ! 🎉' : 'Bien joué les bots !', 3000);
    }
    this.store.set({ tick: this.s.tick + 1 });
  }
  /** Human move from the table overlay. */
  play(move: DominoMove) { const ses = this.s.session; if (!ses || ses.phase !== 'playing' || this.s.confirmLeave) return false; return ses.host.submit(0, move).ok; }
  nextRound() { if (this.s.confirmLeave) return; this.s.session?.host.advance(); }
  /** Same table, same options, same bots (they stay seated), new deal (the avatar stays seated). */
  replay() {
    const ses = this.s.session; if (!ses) return;
    const chair = ses.seatChairs[0];
    this.close(false);
    this.prefChair = chair; this.store.set({ setup: ses.table.id, setupOpts: { players: ses.room.seats.length as 2 | 3 | 4, mode: (ses.room.options?.mode as DominoOptions['mode']) ?? 'single' } });
    if (this.me) this.start(true);
  }
  /** From the results: back to the setup sheet of the same table (player stays seated, bots get up). */
  changeGame() {
    const ses = this.s.session; if (!ses) return;
    const chair = ses.seatChairs[0]; const opts = { players: ses.room.seats.length as 2 | 3 | 4, mode: (ses.room.options?.mode as DominoOptions['mode']) ?? 'single' };
    this.close(true); this.dismissBots(false);
    this.prefChair = chair; this.store.set({ setup: ses.table.id, setupOpts: opts });
  }
  /** "Quitter" button: a running game asks first (bots paused meanwhile); otherwise leave at once. */
  requestLeave() {
    const ses = this.s.session; if (!ses) return;
    if (ses.phase === 'playing' && !ses.host.result) { ses.host.pause(); this.store.set({ confirmLeave: true }); return; }
    this.leave();
  }
  cancelLeave() { this.store.set({ confirmLeave: false }); this.s.session?.host.resume(); }
  /** Leave the table: abandon a running game, stand up. `silent` = travel / guard (no walk, bots removed at once). */
  leave(silent = false) {
    const ses = this.s.session;
    if (!ses) { this.dismissBots(true); if (silent) this.store.set({ setup: null }); return; }
    this.close(true);
    this.dismissBots(silent);
    const me = this.me;
    if (!silent && me?.mode === 'sitting' && me.sitOn) goTo(me.id, me.sitOn.front.clone());
  }
  private close(abandon: boolean) {
    const ses = this.s.session; if (!ses) return;
    this.clearSeatTimer(); this.clearGuard(); this.unsub?.(); this.unsub = null;
    if (!ses.host.result) ses.host.stop('abandon'); else ses.host.stop();
    if (abandon && ses.host.result?.endedBy === 'abandon' && ses.phase === 'playing') this.store.set({ history: [...this.s.history, ses.host.result].slice(-20) });
    this.lobby.leave(ses.room.roomId, ses.room.hostId);
    this.lastThinking = null;
    this.store.set({ session: null, confirmLeave: false });
  }
  /** chair → occupant (seat order) */
  chairLabels(): { chair: string; name: string; seat: number; bot: boolean; pos: { x: number; z: number } }[] {
    const ses = this.s.session; if (!ses) return [];
    return ses.seatChairs.map((c, i) => { const p = clubItemPos(c); const o = ses.room.seats[i].occupant; return { chair: c, name: o?.name ?? '', seat: i, bot: o?.kind === 'bot', pos: { x: p.x, z: p.z } }; });
  }
  /** e2e / debug: no timer of the table left behind */
  debugTimers() { return { seat: !!this.seatTimer, guard: !!this.guardTimer, bots: !!this.botsTimer, host: !!this.s.session?.host.hasTimer, unsub: !!this.unsub }; }
}
