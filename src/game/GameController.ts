import * as THREE from 'three';
import { Store } from '../core/store';
import { FURNITURE, type FurnitureDef } from '../data/furniture';
import { FLOORS, WALLS } from '../data/finishes';
import { defaultApartment, STARTER_INVENTORY } from '../data/defaultApartment';
import { canPlace, findSpot, footprintSize, itemTransform, moveItem, placeItem, removeItem, rotateItem, toggleItem, type ApartmentLayout, type PlaceResult, type Rot } from './apartment/ApartmentModel';
import { syncWorld, freeSeat, seatFacing, resolveApproaches } from './apartment/worldSync';
import { addItem, buy, emptyInventory, spend, takeItem, type Inventory } from './inventory/Inventory';
import type { GameRepository, Profile } from '../persistence/types';
import { MemoryRepository, SaveLoadError, type SaveProblem } from '../persistence/LocalStorageRepository';
import type { PlacedItem } from './apartment/ApartmentModel';
import type { NetworkTransport } from '../net/NetworkTransport';
import { LocalChatService } from './social/social';
import { goTo, placeChar, say, world } from './world';
import { BEACH_SPAWN, DANCE_SPOTS, beachWorld, propById } from './beach/beachLayout';
import { isPlayable, locationById, remembered } from '../data/locations';
import { isPlayerChar, syncAmbientNpcs } from './npc/ambientNpcs';
import { CLUB, CLUB_SPAWN } from './club/clubLayout';

export type Panel = null | 'catalog' | 'finishes' | 'chat' | 'profile' | 'places' | 'emotes' | 'settings';
export interface Placing { defId: string; x: number; z: number; rot: Rot; moving?: string; valid: PlaceResult }
export interface GameState {
  ready: boolean; profile: Profile | null; apartment: ApartmentLayout | null; inventory: Inventory | null;
  mode: 'play' | 'edit'; panel: Panel; selItem: string | null; placing: Placing | null; menuItem: string | null;
  activeChar: string; toast: { text: string; at: number } | null;
  /** current location id ('home' | 'beach'); persisted in the profile */
  location: string;
  /** travel fade in progress (UI only) */
  transition: { to: string; at: number } | null;
  /** Yoo Plage ambience: day, sunset, or a slow automatic day→sunset cycle; DJ music on/off */
  mood: 'day' | 'sunset' | 'cycle'; beachMusic: boolean;
  /** P0.B: records that could not be loaded safely. While non-empty the game is not started and nothing is
   *  written; the recovery panel (ui/SaveRecovery) asks the player what to do. */
  saveProblems: SaveProblem[];
  /** P0.B: running on an in-memory copy (recovery "temporary session"): nothing is persisted. */
  temporary: boolean;
}
export interface ControllerHooks { /** called before an explicit reset overwrites the save (backup snapshot) */ beforeReset?(reason: string): void }
/** Where characters appear when they arrive in a location (home = just inside the front door). */
const HOME_SPAWN = { player: new THREE.Vector3(5.25, 0, 0.95), buddy: new THREE.Vector3(5.75, 0, 1.25), yaw: 0.2 };
const REASON: Record<string, string> = { bounds: 'Hors de la pièce', collision: 'Place occupée', door: 'Laisse la porte libre', noSurface: 'À poser sur une table ou un meuble', unknown: 'Objet inconnu', funds: 'Pas assez de pièces' };

/** Game logic façade: owns state, applies pure-model edits, persists through the repository,
 *  and forwards shareable events to the network transport (offline today). UI calls only these methods. */
export class GameController {
  readonly store = new Store<GameState>({ ready: false, profile: null, apartment: null, inventory: null, mode: 'play', panel: null, selItem: null, placing: null, menuItem: null, activeChar: 'f', toast: null, location: 'home', transition: null, mood: 'day', beachMusic: false, saveProblems: [], temporary: false });
  readonly chat: LocalChatService;
  readonly cat = FURNITURE;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  /** P0.B quarantine: placed furniture whose defId this build does not know. Hidden from the room, but always
   *  written back with the layout (never dropped), so a build that knows them shows them again. */
  quarantine: PlacedItem[] = [];
  /** Optional shared Gold wallet (fashion economy). When set, furniture & finishes are paid in Gold from it
   *  instead of the legacy furniture `inventory.coins` counter. */
  constructor(public repo: GameRepository, readonly net: NetworkTransport, readonly wallet?: { balance(): number; spend(amount: number, memo: string): boolean }, readonly hooks: ControllerHooks = {}) {
    this.chat = new LocalChatService(net);
    this.chat.onMessage((m) => { if (m.local) say(this.store.get().activeChar, m.text); });
  }
  get s() { return this.store.get(); }

  /** `startAt` (deep link ?lieu= / build default) overrides the saved location when playable. */
  async init(opts: { startAt?: string | null } = {}) {
    // P0.B safe load: read everything first; a record that exists but cannot be used stops here, before ANY write
    // (no starter overwrite, no silent reset). A starter is only created for a record that does not exist.
    const problems: SaveProblem[] = [];
    const tryLoad = async <T,>(f: () => Promise<T | null>): Promise<T | null | undefined> => {
      try { return await f(); } catch (e) { if (e instanceof SaveLoadError) { problems.push(e.problem); return undefined; } throw e; }
    };
    let profile = await tryLoad(() => this.repo.loadProfile());
    let apt = profile ? await tryLoad(() => this.repo.loadApartment(profile!.homeId)) : null;
    let inv = profile ? await tryLoad(() => this.repo.loadInventory(profile!.id)) : null;
    if (problems.length) { this.store.set({ saveProblems: problems }); return; }
    if (!profile) { profile = { version: 1, id: 'p_' + Math.random().toString(36).slice(2, 9), name: 'Juanita', appearance: { body: 'f' }, homeId: '', friends: [], createdAt: Date.now() }; profile.homeId = `home_${profile.id}`; await this.repo.saveProfile(profile); }
    if (!apt) { apt = { ...defaultApartment(profile.id), id: profile.homeId }; await this.repo.saveApartment(apt); }
    if (!inv) { inv = emptyInventory(profile.id); for (const [k, n] of Object.entries(STARTER_INVENTORY)) inv = addItem(inv, k, n); await this.repo.saveInventory(inv); }
    // saves are shared by every build of the same env: furniture this build doesn't know is quarantined (hidden,
    // kept in the save), never dropped. Inventory counts for unknown defIds stay in the map untouched.
    this.quarantine = apt.items.filter((i) => !this.cat[i.defId]);
    if (this.quarantine.length) apt = { ...apt, items: apt.items.filter((i) => !!this.cat[i.defId]) };
    const wanted = opts.startAt ?? profile.location;
    const location = wanted && isPlayable(wanted) ? wanted : 'home';
    if (opts.startAt && location !== profile.location) { profile = { ...profile, location }; await this.repo.saveProfile(profile); }
    this.store.set({ profile, apartment: apt, inventory: inv, activeChar: profile.appearance.body === 'm' ? 'm' : 'f', location, saveProblems: [] });
    this.enterWorld(location, location !== 'home');
    this.store.set({ ready: true });
    await this.net.connect(apt.id, profile.id);
  }
  /** Recovery "temporary session": play on an in-memory starter; the stored (unreadable) save is not touched. */
  async startTemporary(opts: { startAt?: string | null } = {}) {
    this.repo = new MemoryRepository(); this.quarantine = []; this.store.set({ saveProblems: [], temporary: true }); await this.init(opts);
  }
  /** Layout as it must be stored: what the room shows + the quarantined items. */
  storedLayout(a: ApartmentLayout): ApartmentLayout { return this.quarantine.length ? { ...a, items: [...a.items, ...this.quarantine] } : a; }
  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { const { apartment, inventory, profile } = this.s; if (apartment) this.repo.saveApartment(this.storedLayout(apartment)); if (inventory) this.repo.saveInventory(inventory); if (profile) this.repo.saveProfile(profile); }, 250);
  }
  private setLayout(apartment: ApartmentLayout, op: 'place' | 'move' | 'remove' | 'toggle', payload: unknown) {
    this.store.set({ apartment }); if (this.s.location === 'home') syncWorld(apartment, this.cat); this.persist();
    this.net.send({ t: 'furniture', roomId: apartment.id, op, payload });
  }
  toast(text: string) { this.store.set({ toast: { text, at: Date.now() } }); }

  // ---------- UI navigation ----------
  setPanel(panel: Panel) { this.store.set({ panel: this.s.panel === panel ? null : panel }); }
  setMode(mode: 'play' | 'edit') { this.store.set({ mode, panel: null, selItem: null, placing: null, menuItem: null }); }
  setActive(id: string) { this.store.set({ activeChar: id }); }

  // ---------- play mode ----------
  walkTo(p: THREE.Vector3, run = false) { this.store.set({ menuItem: null }); return goTo(this.s.activeChar, p, { run }); }
  tapItem(uid: string) {
    if (this.s.mode === 'edit') { if (!this.s.placing) this.store.set({ selItem: uid }); return; }
    this.store.set({ menuItem: this.s.menuItem === uid ? null : uid });
  }
  interact(uid: string, action: 'sit' | 'lie' | 'watch' | 'toggle' | 'look' | 'snack' | 'edit') {
    const apt = this.s.apartment!; const it = apt.items.find((i) => i.uid === uid); if (!it) return;
    const def = this.cat[it.defId]; const me = world.chars[this.s.activeChar]; this.store.set({ menuItem: null });
    if (action === 'sit' || action === 'lie') {
      const seat = freeSeat(uid, me.pos, me.id, action === 'lie' ? 'lie' : 'sit'); if (!seat) return this.toast('Plus de place !');
      if (!goTo(me.id, seat.front, { seat })) return this.toast('Je ne peux pas y aller');
      if (action === 'lie') say(me.id, 'Petite sieste… 😴', 2500);
    }
    if (action === 'watch') {
      // switch the TV on, then sit on the nearest free seat that faces it (sofa, armchair, chair…)
      if (!it.on) this.setLayout(toggleItem(apt, uid), 'toggle', { uid });
      const tv = itemTransform(it, this.cat); const seat = seatFacing(new THREE.Vector3(tv.x, 0, tv.z), me.pos, me.id);
      if (seat && goTo(me.id, seat.front, { seat })) say(me.id, '📺 C’est l’heure de ma série !', 3000);
      else { const f = new THREE.Vector3(Math.sin(tv.yaw), 0, Math.cos(tv.yaw)); goTo(me.id, new THREE.Vector3(tv.x, 0, tv.z).addScaledVector(f, 1.4)); this.toast('Aucun siège face à la télé : place un canapé devant !'); }
    }
    if (action === 'toggle') {
      const next = toggleItem(apt, uid); this.setLayout(next, 'toggle', { uid });
      const on = next.items.find((i) => i.uid === uid)!.on;
      if (def.interaction === 'music') { me.emote = !!on; say(me.id, on ? '♪ J’adore ce son !' : 'Silence…', 2500); }
    }
    if (action === 'look' || action === 'snack') {
      const t = itemTransform(it, this.cat); const fwd = new THREE.Vector3(Math.sin(t.yaw), 0, Math.cos(t.yaw));
      goTo(me.id, new THREE.Vector3(t.x, 0, t.z).addScaledVector(fwd, (it.rot % 2 ? def.size.w : def.size.d) / 2 + 0.3));
      say(me.id, action === 'snack' ? 'Un petit jus de fraise 🍓' : `Joli, ce ${def.name.toLowerCase()} !`, 3500);
    }
    if (action === 'edit') { this.setMode('edit'); this.store.set({ selItem: uid }); }
  }
  toggleEmote() { const c = world.chars[this.s.activeChar]; c.emote = !c.emote; this.store.set({}); this.net.send({ t: 'emote', playerId: this.s.profile!.id, emote: c.emote ? 'victory' : 'none' }); }
  sendChat(text: string) { this.chat.send(this.s.activeChar, text); }

  // ---------- edit mode ----------
  private validate(p: Omit<Placing, 'valid'>): Placing { return { ...p, valid: canPlace(this.s.apartment!, this.cat, p, p.moving) }; }
  startMove(uid: string) { const it = this.s.apartment!.items.find((i) => i.uid === uid)!; this.store.set({ placing: this.validate({ defId: it.defId, x: it.x, z: it.z, rot: it.rot, moving: uid }), panel: null }); }
  startPlace(defId: string) {
    const apt = this.s.apartment!; const spot = findSpot(apt, this.cat, defId, Math.floor(apt.cols / 2), Math.floor(apt.rows / 2));
    const p = spot ?? { defId, x: Math.floor(apt.cols / 2), z: Math.floor(apt.rows / 2), rot: 0 as Rot };
    this.store.set({ placing: this.validate(p), panel: null, selItem: null });
  }
  /** Ghost follows a floor point (metres): centre the footprint on it. */
  ghostAt(x: number, z: number) {
    const p = this.s.placing; if (!p) return; const s = footprintSize(this.cat[p.defId], p.rot);
    const cx = Math.round(x / 0.3 - s.w / 2), cz = Math.round(z / 0.3 - s.d / 2);
    if (cx !== p.x || cz !== p.z) this.store.set({ placing: this.validate({ ...p, x: cx, z: cz }) });
  }
  ghostRotate() { const p = this.s.placing; if (p) this.store.set({ placing: this.validate({ ...p, rot: ((p.rot + 1) % 4) as Rot }) }); }
  confirmPlace() {
    const p = this.s.placing; if (!p) return; const apt = this.s.apartment!;
    if (!p.valid.ok) return this.toast(REASON[p.valid.reason]);
    if (p.moving) {
      const r = moveItem(apt, this.cat, p.moving, p.x, p.z, p.rot); if (!r.ok) return this.toast(REASON[r.reason] ?? r.reason);
      this.setLayout(r.layout, 'move', { uid: p.moving, x: p.x, z: p.z, rot: p.rot }); this.store.set({ placing: null, selItem: p.moving });
    } else {
      const inv = takeItem(this.s.inventory!, p.defId); if (!inv) return this.toast('Plus en stock');
      const r = placeItem(apt, this.cat, p); if (!r.ok) return this.toast(REASON[r.reason] ?? r.reason);
      this.store.set({ inventory: inv, placing: null }); this.setLayout(r.layout, 'place', p);
      this.store.set({ selItem: r.layout.items[r.layout.items.length - 1].uid });
    }
  }
  cancelPlace() { this.store.set({ placing: null }); }
  rotateSelected() { const uid = this.s.selItem; if (!uid) return; const r = rotateItem(this.s.apartment!, this.cat, uid); if (!r.ok) return this.toast(REASON[r.reason] ?? 'Impossible de tourner ici'); this.setLayout(r.layout, 'move', { uid }); }
  storeSelected() {
    const uid = this.s.selItem; if (!uid) return; const r = removeItem(this.s.apartment!, this.cat, uid); if (!r.ok) return;
    let inv = this.s.inventory!; for (const d of r.stored ?? []) inv = addItem(inv, d);
    this.store.set({ inventory: inv, selItem: null }); this.setLayout(r.layout, 'remove', { uid });
    this.toast(`${(r.stored ?? []).length} objet(s) rangé(s) dans le sac`);
  }
  buyItem(def: FurnitureDef) {
    if (this.wallet) { if (!this.wallet.spend(def.price, def.name)) return this.toast('Pas assez d’or'); this.store.set({ inventory: addItem(this.s.inventory!, def.id) }); this.persist(); this.startPlace(def.id); return; }
    const r = buy(this.s.inventory!, def); if (!r.ok) return this.toast(REASON.funds);
    this.store.set({ inventory: r.inv }); this.persist(); this.startPlace(def.id);
  }
  setFinish(kind: 'floor' | 'wall', id: string) {
    const list = kind === 'floor' ? FLOORS : WALLS; const f = list.find((x) => x.id === id)!; const key = `${kind}:${id}`;
    let inv = this.s.inventory!;
    if (f.price > 0 && !inv.items[key] && this.wallet) { if (!this.wallet.spend(f.price, f.name)) return this.toast('Pas assez d’or'); inv = addItem(inv, key); this.store.set({ inventory: inv }); }
    else if (f.price > 0 && !inv.items[key]) { const paid = spend(inv, f.price); if (!paid) return this.toast(REASON.funds); inv = addItem(paid, key); this.store.set({ inventory: inv }); }
    const apt = { ...this.s.apartment!, [kind]: id }; this.store.set({ apartment: apt }); this.persist();
  }
  ownsFinish(kind: 'floor' | 'wall', id: string, price: number) { return price === 0 || !!this.s.inventory?.items[`${kind}:${id}`]; }
  rename(name: string) { const p = { ...this.s.profile!, name: name.trim().slice(0, 16) || 'Moi' }; this.store.set({ profile: p }); world.chars[this.s.activeChar].name = p.name; this.persist(); }
  setBody(body: 'f' | 'm') { const p = { ...this.s.profile!, appearance: { ...this.s.profile!.appearance, body } }; this.store.set({ profile: p, activeChar: body }); this.persist(); }
  async resetSave() { this.hooks.beforeReset?.('reset apartment+bag'); const p = this.s.profile!; const apt = { ...defaultApartment(p.id), id: p.homeId }; let inv = emptyInventory(p.id); for (const [k, n] of Object.entries(STARTER_INVENTORY)) inv = addItem(inv, k, n); this.store.set({ apartment: apt, inventory: inv, selItem: null, placing: null }); if (this.s.location === 'home') syncWorld(apt, this.cat); this.persist(); }

  // ---------- locations ----------
  /** Build the navigation + seat registry of a location and (optionally) put both local avatars at its entrance. */
  private enterWorld(id: string, spawn: boolean) {
    world.location = id;
    if (id === 'beach') { const b = beachWorld(); world.nav = b.nav; world.seats = b.seats; resolveApproaches(world.seats, b.nav); }
    else if (id === 'club') syncWorld(CLUB, this.cat); // fixed Games Club room (not saved), same nav + seat system
    else syncWorld(this.s.apartment!, this.cat);
    if (!spawn) return;
    const sp = id === 'beach' ? BEACH_SPAWN : id === 'club' ? CLUB_SPAWN : HOME_SPAWN; const me = this.s.activeChar;
    for (const c of Object.values(world.chars)) {
      if (!isPlayerChar(c.id)) continue; // ambient NPCs are respawned for the new scene, never teleported to the buddy pad
      placeChar(c.id, c.id === me ? sp.player : sp.buddy, sp.yaw);
    }
    syncAmbientNpcs(id);
  }
  /** Instant switch to another playable location (the companion avatar comes along). Returns false if not possible. */
  travel(id: string) {
    if (!this.s.ready || id === this.s.location || !isPlayable(id)) return false;
    this.store.set({ location: id, mode: 'play', panel: null, selItem: null, placing: null, menuItem: null });
    this.enterWorld(id, true);
    // the Games Club is not remembered as the current location (save isolation is handled on another branch): no save write
    const p = remembered(id) ? { ...this.s.profile!, location: id } : this.s.profile!;
    if (remembered(id)) { this.store.set({ profile: p }); this.persist(); }
    this.net.connect(id === 'home' ? this.s.apartment!.id : `public:${id}`, p.id);
    say(this.s.activeChar, id === 'beach' ? 'Direction la plage ! 🌴' : id === 'club' ? 'Bienvenue au Yoo Games Club ! 🎲' : 'De retour à la maison 🏠', 3500);
    return true;
  }
  /** Travel with the short fade used by the UI: fade out, switch, fade back in. */
  travelWithFade(id: string, outMs = 450, holdMs = 550) {
    if (this.s.transition || id === this.s.location || !isPlayable(id)) return false;
    this.store.set({ transition: { to: id, at: performance.now() }, panel: null });
    setTimeout(() => { this.travel(id); setTimeout(() => this.store.set({ transition: null }), holdMs); }, outMs);
    return true;
  }
  locationName() { return locationById(this.s.location)?.name ?? ''; }
  setMood(mood: GameState['mood']) { this.store.set({ mood }); }
  cycleMood() { const order: GameState['mood'][] = ['day', 'sunset', 'cycle']; this.setMood(order[(order.indexOf(this.s.mood) + 1) % order.length]); }
  /** Tap on a Yoo Plage prop: same flow as furniture (menu), keyed by prop id. */
  tapProp(id: string) { this.store.set({ menuItem: this.s.menuItem === id ? null : id }); }
  interactProp(id: string, action: 'sit' | 'dance' | 'music' | 'order' | 'look') {
    const p = propById(id); if (!p || this.s.location !== 'beach') return;
    const me = world.chars[this.s.activeChar]; this.store.set({ menuItem: null });
    if (action === 'sit') {
      const seatProp = p.kind === 'towel' ? propById(id.replace('towel', 'lounger')) ?? p : p;
      const seat = freeSeat(seatProp.id, me.pos, me.id, seatProp.kind === 'lounger' ? 'lie' : 'sit'); if (!seat) return this.toast('Plus de place !'); goTo(me.id, seat.front, { seat });
    }
    if (action === 'music') {
      const on = !this.s.beachMusic; this.store.set({ beachMusic: on });
      say(me.id, on ? '♪ DJ, monte le son !' : 'Petite pause musique…', 2500);
    }
    if (action === 'dance') {
      if (!this.s.beachMusic) this.store.set({ beachMusic: true });
      const taken = Object.values(world.chars).filter((c) => c.id !== me.id).map((c) => c.path[c.path.length - 1] ?? c.pos);
      const spot = DANCE_SPOTS.slice().sort((a, b) => Math.min(...taken.map((t) => t.distanceTo(b))) - Math.min(...taken.map((t) => t.distanceTo(a))))[0];
      if (!goTo(me.id, spot, { emote: true })) { me.emote = true; }
      this.net.send({ t: 'emote', playerId: this.s.profile!.id, emote: 'victory' });
    }
    if (action === 'order') {
      goTo(me.id, new THREE.Vector3(p.x, 0, 1.15));
      say(me.id, ['Un smoothie mangue, svp 🥭', 'Une glace à la fraise ! 🍦', 'Un café glacé ☕'][Math.floor(Math.random() * 3)], 3500);
    }
    if (action === 'look') {
      const f = new THREE.Vector3(Math.sin(p.yaw), 0, Math.cos(p.yaw));
      goTo(me.id, new THREE.Vector3(p.x, 0, p.z).addScaledVector(f, p.kind === 'kiosk' ? 1.4 : 0.7));
      say(me.id, p.kind === 'sign' ? 'Bienvenue à Yoo Plage ! 🏖️' : `Trop joli, ${p.name.toLowerCase()} !`, 3000);
    }
  }
}
