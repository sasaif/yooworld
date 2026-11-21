import { useState } from 'react';
import { useStore } from '../../core/store';
import { economy, fashion } from '../../app/services';
import { CATEGORIES, ITEMS, OPTIONAL_SLOTS, RARITY, SLOT_LABEL, isFree } from '../../fashion/catalogue';
import type { ItemDef, Slot } from '../../fashion/types';
import { CURRENCY_ICON, fmt, type Totals } from '../../economy/money';
import { StudioPreview } from './StudioPreview';
import { TradeLab } from './TradeLab';
import { WalletPanel } from './WalletPanel';
import { frameFor } from './ThumbStage';
import type { CamFrame } from './AvatarFigure';
import './fashion.css';

const BASE = import.meta.env.BASE_URL;
export const Price = ({ it }: { it: ItemDef }) => it.trial ? <span className="pr trial">Pas en vente</span> : it.price ? <span className={'pr ' + it.price.currency}>{CURRENCY_ICON[it.price.currency]} {fmt(it.price.amount)}</span> : <span className="pr free">Gratuit</span>;
export const TotalsView = ({ t }: { t: Totals }) => <>{t.gold > 0 && <span className="pr gold">🪙 {fmt(t.gold)}</span>}{t.diamond > 0 && <span className="pr diamond">💎 {fmt(t.diamond)}</span>}{!t.gold && !t.diamond && <span className="pr free">Gratuit</span>}</>;
export function Wallet({ compact = false }: { compact?: boolean }) {
  useStore(fashion.store, (s) => s.ecoRev); const a = economy.snapshot().account;
  return <div className={'st-wallet' + (compact ? ' compact' : '')} title="Soldes de TEST (développement) — aucune valeur réelle">
    <span className="wv gold">🪙 <b>{fmt(a.gold.balance)}</b></span><span className="wv diamond">💎 <b>{fmt(a.diamond.balance)}</b></span><span className="test-tag">TEST</span></div>;
}
function Thumb({ it }: { it: ItemDef }) {
  const [bad, setBad] = useState(false);
  if (it.swatch) { const c = it.render.color!, c2 = it.render.color2; return <span className="sw-dot" style={{ background: c2 ? `linear-gradient(160deg, ${c}, ${c2})` : c }} />; }
  return bad ? <span className="th-fallback">{fashion.catOf(it.category).icon}</span> : <img src={`${BASE}thumbs/fashion/${it.id}.webp`} alt="" loading="lazy" draggable={false} onError={() => setBad(true)} />;
}
function Card({ it }: { it: ItemDef }) {
  const st = useStore(fashion.store, (s) => s.studio)!; useStore(fashion.store, (s) => s.ecoRev);
  const worn = st.draft.slots[it.slot] === it.id; const owned = fashion.owns(it.id); const free = isFree(it);
  return (
    <button className={`it-card r-${it.rarity}${worn ? ' on' : ''}${st.selected === it.id ? ' sel' : ''}${it.swatch ? ' swatch' : ''}`} onClick={() => fashion.tap(it.id)} data-item={it.id}>
      <span className="it-thumb"><Thumb it={it} /></span>
      {it.rarity !== 'common' && <span className="it-rar" style={{ background: RARITY[it.rarity].color }}>{RARITY[it.rarity].label}</span>}
      {it.trial && <span className="it-trial">À l’essai</span>}
      <span className="it-name">{it.name}</span>
      <span className="it-foot">{owned && !free ? <span className="own">✓ Possédé</span> : <Price it={it} />}{worn && <span className="eq">{owned || free ? 'Équipé' : 'Essai'}</span>}</span>
    </button>
  );
}
function Grid({ items }: { items: ItemDef[] }) {
  const slots = [...new Set(items.map((i) => i.slot))];
  return <>{slots.map((sl) => { const list = items.filter((i) => i.slot === sl); const sw = list.every((i) => i.swatch);
    return <section key={sl} className="st-sec"><h4>{SLOT_LABEL[sl] ?? ''}{OPTIONAL_SLOTS.includes(sl) && <SlotOff slot={sl} />}</h4><div className={sw ? 'st-swatches' : 'st-grid'}>{list.map((i) => <Card key={i.id} it={i} />)}</div></section>; })}</>;
}
function SlotOff({ slot }: { slot: Slot }) { const st = useStore(fashion.store, (s) => s.studio)!; if (!st.draft.slots[slot]) return null; return <button className="slot-off" onClick={() => fashion.unequipSlot(slot)}>Retirer</button>; }
function Detail() {
  const st = useStore(fashion.store, (s) => s.studio)!; useStore(fashion.store, (s) => s.ecoRev); const it = st.selected ? ITEMS[st.selected] : null;
  const busy = useStore(fashion.store, (s) => !!s.buying);
  if (!it || isFree(it) || fashion.owns(it.id)) return null; const worn = st.draft.slots[it.slot] === it.id; const ok = fashion.canAfford(fashion.totals([it]));
  return <div className="st-detail"><div className="dt-txt"><b>{it.name}</b><small style={{ color: RARITY[it.rarity].color }}>{RARITY[it.rarity].label}{it.price?.currency === 'diamond' ? ' · lié au compte' : ''}{it.desc ? ' · ' + it.desc : ''}</small></div>
    <Price it={it} />{worn ? <button className="btn ghost" onClick={() => fashion.removeFromCart(it.id)}>Retirer</button> : <button className="btn ghost" onClick={() => fashion.tap(it.id)}>Essayer</button>}
    <button className="btn buy" disabled={!ok || busy} onClick={() => void fashion.buy([it.id])}>{ok ? 'Acheter' : 'Solde insuffisant'}</button></div>;
}
function CartBar() {
  const st = useStore(fashion.store, (s) => s.studio)!; useStore(fashion.store, (s) => s.ecoRev); const cart = fashion.cart(); const t = fashion.totals(cart); void st;
  if (!cart.length) return <div className="st-cart empty"><span>✨ Touche un article pour l’essayer sur ton avatar. Combine plusieurs articles, puis achète la tenue complète.</span></div>;
  return <div className="st-cart"><span className="ct-n">🛍️ Essayage <b>{cart.length}</b></span><span className="ct-items">{cart.map((i) => <button key={i.id} className="ct-chip" onClick={() => fashion.removeFromCart(i.id)} title="Retirer">{i.name} ✕</button>)}</span>
    <span className="ct-tot"><TotalsView t={t} /></span><button className="btn ghost sm" onClick={() => fashion.clearCart()}>Vider</button><button className="btn buy" onClick={() => fashion.askConfirm(true)}>Acheter la tenue</button></div>;
}
function ConfirmModal() {
  useStore(fashion.store, (s) => s.ecoRev); const busy = useStore(fashion.store, (s) => !!s.buying); const cart = fashion.cart(); const t = fashion.totals(cart); const a = economy.snapshot().account; const ok = fashion.canAfford(t);
  return <div className="st-modal"><div className="md-card"><h3>Confirmer l’achat</h3>
    <ul className="md-list">{cart.map((i) => <li key={i.id}><span className="md-th"><Thumb it={i} /></span>{i.name}<small style={{ color: RARITY[i.rarity].color }}>{RARITY[i.rarity].label}</small><Price it={i} /></li>)}</ul>
    <div className="md-sum"><div>Total <TotalsView t={t} /></div><div className="muted">Après achat : 🪙 {fmt(a.gold.balance - t.gold)} · 💎 {fmt(a.diamond.balance - t.diamond)}</div>
      {t.diamond > 0 && <div className="muted">Les articles payés en 💎 restent liés à ton compte (non échangeables).</div>}<div className="muted">Soldes de TEST — aucun paiement réel.</div></div>
    <div className="row"><button className="btn ghost" onClick={() => fashion.askConfirm(false)}>Annuler</button><button className="btn buy" disabled={!ok || busy} onClick={() => void fashion.buyCart()}>{ok ? 'Confirmer l’achat' : 'Solde insuffisant'}</button></div></div></div>;
}
function LeavingModal() {
  const cart = fashion.cart(); const t = fashion.totals(cart);
  return <div className="st-modal"><div className="md-card"><h3>Articles en essai</h3><p>Tu essaies {cart.length} article(s) non acheté(s) (<TotalsView t={t} />). Que veux-tu faire ?</p>
    <div className="row wrap"><button className="btn ghost" onClick={() => fashion.store.set({ studio: { ...fashion.s.studio!, leaving: false, pending: undefined } })}>Continuer l’essayage</button>
      {fashion.s.studio?.pending ? <button className="btn" onClick={() => { const b = fashion.s.studio!.pending!; fashion.clearCart(); fashion.switchBody(b); }}>Changer d’avatar sans acheter</button>
        : <button className="btn" onClick={() => { fashion.clearCart(); void fashion.close('keep-owned'); }}>Quitter sans acheter</button>}
      <button className="btn buy" onClick={() => fashion.store.set({ studio: { ...fashion.s.studio!, leaving: false, confirm: true } })}>Acheter</button></div></div></div>;
}
function Equipped() {
  const st = useStore(fashion.store, (s) => s.studio)!; const entries = Object.entries(st.draft.slots) as [Slot, string][];
  return <div className="st-eqlist">{entries.map(([slot, id]) => { const it = ITEMS[id]; if (!it) return null; const owned = fashion.owns(id);
    return <div key={slot} className="eq-row"><span className="eq-th"><Thumb it={it} /></span><span className="eq-txt"><small>{SLOT_LABEL[slot] ?? fashion.catOf(it.category).label}</small><b>{it.name}</b></span>
      {!owned && <span className="eq-try">Essai</span>}{OPTIONAL_SLOTS.includes(slot) && <button className="btn ghost sm" onClick={() => fashion.unequipSlot(slot)}>Retirer</button>}
      <button className="btn ghost sm" onClick={() => { fashion.setTab('shop'); fashion.setCat(it.category); fashion.setTab('shop'); }}>Changer</button></div>; })}</div>;
}
export function FashionStudio() {
  const st = useStore(fashion.store, (s) => s.studio); const msg = useStore(fashion.store, (s) => s.msg); useStore(fashion.store, (s) => s.ecoRev);
  const [dance, setDance] = useState(false); const [full, setFull] = useState(false);
  if (!st) return null;
  const cat = fashion.catOf(st.cat); const sel = st.selected ? ITEMS[st.selected] : null;
  const frame: CamFrame = full ? 'body' : st.tab === 'shop' || st.tab === 'owned' ? (sel ? frameFor(sel) : cat.cam === 'body' ? 'body' : cat.cam) : 'body';
  const items = st.tab === 'owned' ? fashion.ownedItems(st.body).filter((i) => i.category === st.cat) : fashion.itemsFor(st.cat, st.body);
  const showCats = st.tab === 'shop' || st.tab === 'owned';
  return (
    <div className="st" role="dialog" aria-label="Studio mode & boutique">
      <div className="st-left">
        <div className="st-head"><button className="st-back" onClick={() => void fashion.close()} aria-label="Fermer">‹</button><b className="st-title">Style</b>
          <span className="st-body">{(['f', 'm'] as const).map((b) => <button key={b} className={st.body === b ? 'on' : ''} onClick={() => fashion.switchBody(b)}>{b === 'f' ? 'Juanita' : 'Juan'}</button>)}</span></div>
        <StudioPreview look={st.draft} base={st.base} compare={st.compare} frame={frame} dance={dance} />
        <div className="st-pills">
          <button className={'pill' + (st.compare ? ' on' : '')} onPointerDown={() => fashion.setCompare(true)} onPointerUp={() => fashion.setCompare(false)} onPointerLeave={() => fashion.setCompare(false)}>{st.compare ? 'Avant' : '◐ Avant'}</button>
          <button className={'pill' + (full ? ' on' : '')} onClick={() => setFull((f) => !f)} data-pill="full">🧍 En pied</button>
          <button className={'pill' + (dance ? ' on' : '')} onClick={() => setDance((d) => !d)}>💃 {dance ? 'Stop' : 'Danser'}</button>
          {fashion.dirty() && <button className="pill" onClick={() => fashion.resetDraft()}>↺ Annuler</button>}
        </div>
      </div>
      <div className="st-right">
        <div className="st-top">
          <nav className="st-tabs">{([['shop', '🛍️', 'Boutique'], ['owned', '🎒', 'Mes articles'], ['equipped', '✨', 'Équipé'], ['trade', '🤝', 'Échanges'], ['wallet', '👛', 'Portefeuille']] as const).map(([k, ic, l]) =>
            <button key={k} className={st.tab === k ? 'on' : ''} onClick={() => fashion.setTab(k)}>{ic}<span>{l}</span></button>)}</nav>
          <Wallet />
        </div>
        {showCats && <nav className="st-cats">{CATEGORIES.filter((c) => c.id !== 'beard' || st.body === 'm').map((c) => <button key={c.id} className={st.cat === c.id ? 'on' : ''} onClick={() => fashion.setCat(c.id)}><i>{c.icon}</i><span>{c.label}</span></button>)}</nav>}
        <div className="st-body-scroll">
          {showCats && (items.length ? <Grid items={items} /> : <p className="st-empty">{st.tab === 'owned' ? 'Aucun article acheté dans cette catégorie. Les options de base sont gratuites et toujours disponibles dans la Boutique.' : 'Rien ici.'}</p>)}
          {st.tab === 'equipped' && <Equipped />}
          {st.tab === 'trade' && <TradeLab />}
          {st.tab === 'wallet' && <WalletPanel />}
        </div>
        {showCats && <Detail />}
        {(showCats || st.tab === 'equipped') && <CartBar />}
      </div>
      {st.confirm && <ConfirmModal />}
      {st.leaving && <LeavingModal />}
      {msg && Date.now() - msg.at < 2600 && <div key={msg.at} className={'st-toast ' + msg.kind}>{msg.text}</div>}
    </div>
  );
}
