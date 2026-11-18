import * as THREE from 'three';
import { Store } from '../core/store';
import { FURNITURE, type FurnitureDef } from '../data/furniture';
import { FLOORS, WALLS } from '../data/finishes';
import { defaultApartment, STARTER_INVENTORY } from '../data/defaultApartment';
import { canPlace, findSpot, footprintSize, itemTransform, moveItem, placeItem, removeItem, rotateItem, toggleItem, type ApartmentLayout, type PlaceResult, type Rot } from './apartment/ApartmentModel';
import { syncWorld, freeSeat } from './apartment/worldSync';
import { addItem, buy, emptyInventory, spend, takeItem, type Inventory } from './inventory/Inventory';
import type { GameRepository, Profile } from '../persistence/types';
import type { NetworkTransport } from '../net/NetworkTransport';
import { LocalChatService } from './social/social';
import { goTo, say, world } from './world';

export type Panel = null | 'catalog' | 'finishes' | 'chat' | 'profile' | 'places' | 'emotes';
export interface Placing { defId: string; x: number; z: number; rot: Rot; moving?: string; valid: PlaceResult }
export interface GameState {
  ready: boolean; profile: Profile | null; apartment: ApartmentLayout | null; inventory: Inventory | null;
  mode: 'play' | 'edit'; panel: Panel; selItem: string | null; placing: Placing | null; menuItem: string | null;
  activeChar: string; toast: { text: string; at: number } | null;
}
const REASON: Record<string, string> = { bounds: 'Hors de la pièce', collision: 'Place occupée', door: 'Laisse la porte libre', noSurface: 'À poser sur une table ou un meuble', unknown: 'Objet inconnu', funds: 'Pas assez de pièces' };

/** Game logic façade: owns state, applies pure-model edits, persists through the repository,
 *  and forwards shareable events to the network transport (offline today). UI calls only these methods. */
export class GameController {
  readonly store = new Store<GameState>({ ready: false, profile: null, apartment: null, inventory: null, mode: 'play', panel: null, selItem: null, placing: null, menuItem: null, activeChar: 'f', toast: null });
  readonly chat: LocalChatService;
  readonly cat = FURNITURE;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly repo: GameRepository, readonly net: NetworkTransport) {
    this.chat = new LocalChatService(net);
    this.chat.onMessage((m) => { if (m.local) say(this.store.get().activeChar, m.text); });
  }
  get s() { return this.store.get(); }

  async init() {
    let profile = await this.repo.loadProfile();
    if (!profile) { profile = { version: 1, id: 'p_' + Math.random().toString(36).slice(2, 9), name: 'Juanita', appearance: { body: 'f' }, homeId: '', friends: [], createdAt: Date.now() }; profile.homeId = `home_${profile.id}`; await this.repo.saveProfile(profile); }
    let apt = await this.repo.loadApartment(profile.homeId);
    if (!apt) { apt = { ...defaultApartment(profile.id), id: profile.homeId }; await this.repo.saveApartment(apt); }
    let inv = await this.repo.loadInventory(profile.id);
    if (!inv) { inv = emptyInventory(profile.id); for (const [k, n] of Object.entries(STARTER_INVENTORY)) inv = addItem(inv, k, n); await this.repo.saveInventory(inv); }
    syncWorld(apt, this.cat);
    this.store.set({ ready: true, profile, apartment: apt, inventory: inv, activeChar: profile.appearance.body === 'm' ? 'm' : 'f' });
    await this.net.connect(apt.id, profile.id);
  }
  private persist() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { const { apartment, inventory, profile } = this.s; if (apartment) this.repo.saveApartment(apartment); if (inventory) this.repo.saveInventory(inventory); if (profile) this.repo.saveProfile(profile); }, 250);
  }
  private setLayout(apartment: ApartmentLayout, op: 'place' | 'move' | 'remove' | 'toggle', payload: unknown) {
    this.store.set({ apartment }); syncWorld(apartment, this.cat); this.persist();
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
  interact(uid: string, action: 'sit' | 'toggle' | 'look' | 'snack' | 'edit') {
    const apt = this.s.apartment!; const it = apt.items.find((i) => i.uid === uid); if (!it) return;
    const def = this.cat[it.defId]; const me = world.chars[this.s.activeChar]; this.store.set({ menuItem: null });
    if (action === 'sit') { const seat = freeSeat(uid, me.pos, me.id); if (!seat) return this.toast('Plus de place !'); goTo(me.id, seat.front, { seat }); }
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
    const r = buy(this.s.inventory!, def); if (!r.ok) return this.toast(REASON.funds);
    this.store.set({ inventory: r.inv }); this.persist(); this.startPlace(def.id);
  }
  setFinish(kind: 'floor' | 'wall', id: string) {
    const list = kind === 'floor' ? FLOORS : WALLS; const f = list.find((x) => x.id === id)!; const key = `${kind}:${id}`;
    let inv = this.s.inventory!;
    if (f.price > 0 && !inv.items[key]) { const paid = spend(inv, f.price); if (!paid) return this.toast(REASON.funds); inv = addItem(paid, key); this.store.set({ inventory: inv }); }
    const apt = { ...this.s.apartment!, [kind]: id }; this.store.set({ apartment: apt }); this.persist();
  }
  ownsFinish(kind: 'floor' | 'wall', id: string, price: number) { return price === 0 || !!this.s.inventory?.items[`${kind}:${id}`]; }
  rename(name: string) { const p = { ...this.s.profile!, name: name.trim().slice(0, 16) || 'Moi' }; this.store.set({ profile: p }); world.chars[this.s.activeChar].name = p.name; this.persist(); }
  setBody(body: 'f' | 'm') { const p = { ...this.s.profile!, appearance: { ...this.s.profile!.appearance, body } }; this.store.set({ profile: p, activeChar: body }); this.persist(); }
  async resetSave() { const p = this.s.profile!; const apt = { ...defaultApartment(p.id), id: p.homeId }; let inv = emptyInventory(p.id); for (const [k, n] of Object.entries(STARTER_INVENTORY)) inv = addItem(inv, k, n); this.store.set({ apartment: apt, inventory: inv, selItem: null, placing: null }); syncWorld(apt, this.cat); this.persist(); }
}
