import { useEffect, useState } from 'react';
import { useStore } from '../core/store';
import { game } from '../app/services';
import { AVATARS } from '../data/avatars';
import { FURNITURE, CATEGORY_LABEL, RARITY_COLOR, type Category } from '../data/furniture';
import { FLOORS, WALLS } from '../data/finishes';
import { LOCATIONS, locationById } from '../data/locations';
import { count } from '../game/inventory/Inventory';
import { world } from '../game/world';
import { enterLandscape } from '../app/screen';

const REASON: Record<string, string> = { bounds: 'Hors de la pièce', collision: 'Place occupée', door: 'Laisse la porte libre', noSurface: 'À poser sur un meuble', unknown: '?' };

export function Hud() {
  const s = useStore(game.store, (x) => x);
  if (!s.ready) return <div className="loading">Chargement…</div>;
  return (
    <>
      <TopBar />
      {s.toast && Date.now() - s.toast.at < 2500 && <div className="toast" key={s.toast.at}>{s.toast.text}</div>}
      {s.mode === 'play' ? <PlayDock /> : <EditDock />}
      {s.panel === 'catalog' && <CatalogSheet />}
      {s.panel === 'finishes' && <FinishesSheet />}
      {s.panel === 'chat' && <ChatSheet />}
      {s.panel === 'profile' && <ProfileSheet />}
      {s.panel === 'places' && <PlacesSheet />}
      {s.mode === 'edit' && (s.placing ? <PlacingBar /> : s.selItem ? <SelectionBar /> : null)}
    </>
  );
}
function useTick(ms = 1000) { const [, f] = useState(0); useEffect(() => { const i = setInterval(() => f((n) => n + 1), ms); return () => clearInterval(i); }, [ms]); }

function TopBar() {
  useTick(1500);
  const p = useStore(game.store, (s) => s.profile)!; const coins = useStore(game.store, (s) => s.inventory?.coins ?? 0); const active = useStore(game.store, (s) => s.activeChar);
  return (
    <div className="hud-top">
      <button className="chip" onClick={() => game.setPanel('profile')}>
        <span className="avatar-dot" style={{ background: AVATARS[active].tagColor }} />{world.chars[active]?.name ?? p.name}
      </button>
      <span className="chip coin">🪙 {coins}</span>
      <span className="spacer" />
      <LocationChip />
      {document.fullscreenEnabled && !document.fullscreenElement && matchMedia('(pointer: coarse)').matches && <button className="chip fs" title="Plein écran" aria-label="Plein écran" onClick={() => void enterLandscape()}>⛶</button>}
      <span className="chip net" title="Aucun serveur : seuls les personnages locaux sont présents">● Hors ligne</span>
    </div>
  );
}
function LocationChip() {
  const loc = useStore(game.store, (s) => s.location); const l = locationById(loc);
  return <button className="chip loc" onClick={() => game.setPanel('places')}>{l?.icon} <span className="hide-sm">{l?.name}</span></button>;
}
const MOOD = { day: ['☀️', 'Jour'], sunset: ['🌅', 'Coucher'], cycle: ['🔄', 'Auto'] } as const;
function PlayDock() {
  const panel = useStore(game.store, (s) => s.panel); const active = useStore(game.store, (s) => s.activeChar);
  const loc = useStore(game.store, (s) => s.location); const mood = useStore(game.store, (s) => s.mood);
  const emote = !!world.chars[active]?.emote;
  return (
    <nav className="dock">
      <button onClick={() => game.setPanel('places')} className={panel === 'places' ? 'on' : ''}>🗺️<span>Lieux</span></button>
      {loc === 'home' ? <>
        <button onClick={() => game.setMode('edit')}>🛋️<span>Décorer</span></button>
        <button onClick={() => game.setPanel('catalog')} className={panel === 'catalog' ? 'on' : ''}>🎒<span>Sac</span></button>
      </> : <button onClick={() => game.cycleMood()} title="Ambiance : jour, coucher de soleil ou cycle automatique">{MOOD[mood][0]}<span>{MOOD[mood][1]}</span></button>}
      <button onClick={() => game.toggleEmote()} className={emote ? 'on' : ''}>🎉<span>Danse</span></button>
      <button onClick={() => game.setPanel('chat')} className={panel === 'chat' ? 'on' : ''}>💬<span>Chat</span></button>
    </nav>
  );
}
function EditDock() {
  const panel = useStore(game.store, (s) => s.panel); const n = useStore(game.store, (s) => (s.inventory ? count(s.inventory) : 0));
  return (
    <nav className="dock edit">
      <button onClick={() => game.setMode('play')} className="done">✓<span>Terminé</span></button>
      <button onClick={() => game.setPanel('catalog')} className={panel === 'catalog' ? 'on' : ''}>➕<span>Ajouter ({n})</span></button>
      <button onClick={() => game.setPanel('finishes')} className={panel === 'finishes' ? 'on' : ''}>🎨<span>Sol & murs</span></button>
    </nav>
  );
}
function SelectionBar() {
  const uid = useStore(game.store, (s) => s.selItem)!; const it = game.s.apartment!.items.find((i) => i.uid === uid); if (!it) return null; const d = FURNITURE[it.defId];
  return (
    <div className="editbar">
      <div className="editbar-title"><img src={`${import.meta.env.BASE_URL}thumbs/${d.id}.webp`} alt="" />{d.name}</div>
      <div className="row">
        <button className="btn" onClick={() => game.rotateSelected()}>↻ Tourner</button>
        <button className="btn" onClick={() => game.startMove(uid)}>✥ Déplacer</button>
        <button className="btn danger" onClick={() => game.storeSelected()}>📦 Ranger</button>
      </div>
    </div>
  );
}
function PlacingBar() {
  const p = useStore(game.store, (s) => s.placing)!; const d = FURNITURE[p.defId];
  return (
    <div className="editbar">
      <div className="editbar-title"><img src={`${import.meta.env.BASE_URL}thumbs/${d.id}.webp`} alt="" />{d.name}
        <span className={'status ' + (p.valid.ok ? 'ok' : 'bad')}>{p.valid.ok ? 'OK' : REASON[p.valid.reason]}</span></div>
      <div className="hint">Touche le sol pour choisir l’emplacement</div>
      <div className="row">
        <button className="btn" onClick={() => game.ghostRotate()}>↻ Tourner</button>
        <button className="btn primary" disabled={!p.valid.ok} onClick={() => game.confirmPlace()}>✓ Poser</button>
        <button className="btn" onClick={() => game.cancelPlace()}>✕ Annuler</button>
      </div>
    </div>
  );
}
function CatalogSheet() {
  const inv = useStore(game.store, (s) => s.inventory)!; const mode = useStore(game.store, (s) => s.mode);
  const [tab, setTab] = useState<'inv' | 'shop'>('inv'); const [cat, setCat] = useState<Category | 'all'>('all');
  const owned = Object.entries(inv.items).filter(([k]) => FURNITURE[k]);
  const shop = Object.values(FURNITURE).filter((d) => cat === 'all' || d.category === cat);
  const place = (id: string) => { if (mode !== 'edit') game.setMode('edit'); game.startPlace(id); };
  return (
    <div className="sheet">
      <h3><span className="tabs"><button className={tab === 'inv' ? 'on' : ''} onClick={() => setTab('inv')}>🎒 Mon sac</button><button className={tab === 'shop' ? 'on' : ''} onClick={() => setTab('shop')}>🛍️ Boutique</button></span><button className="x" onClick={() => game.setPanel(null)}>✕</button></h3>
      {tab === 'shop' && <div className="chips">{(['all', ...Object.keys(CATEGORY_LABEL)] as (Category | 'all')[]).map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c === 'all' ? 'Tout' : CATEGORY_LABEL[c]}</button>)}</div>}
      <div className="grid">
        {tab === 'inv' && (owned.length ? owned.map(([id, n]) => (
          <button key={id} className="card" onClick={() => place(id)}><img src={`${import.meta.env.BASE_URL}thumbs/${id}.webp`} alt="" /><b>{FURNITURE[id].name}</b><small>×{n} · poser</small></button>
        )) : <p className="empty">Ton sac est vide. Range un meuble ou passe à la boutique.</p>)}
        {tab === 'shop' && shop.map((d) => (
          <button key={d.id} className="card" onClick={() => game.buyItem(d)} disabled={inv.coins < d.price}>
            <img src={`${import.meta.env.BASE_URL}thumbs/${d.id}.webp`} alt="" /><b>{d.name}</b><small><span style={{ color: RARITY_COLOR[d.rarity] }}>●</span> 🪙 {d.price}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
function FinishesSheet() {
  const apt = useStore(game.store, (s) => s.apartment)!; useStore(game.store, (s) => s.inventory);
  return (
    <div className="sheet">
      <h3>Sol & murs <button className="x" onClick={() => game.setPanel(null)}>✕</button></h3>
      <div className="label">Sol</div>
      <div className="swatches">{FLOORS.map((f) => <button key={f.id} className={'sw' + (apt.floor === f.id ? ' on' : '')} onClick={() => game.setFinish('floor', f.id)}>
        <i style={{ background: f.kind === 'tiles' ? `repeating-conic-gradient(${f.a} 0 25%, ${f.b} 0 50%) 0 0/16px 16px` : f.kind === 'planks' ? `repeating-linear-gradient(0deg, ${f.a} 0 7px, ${f.b} 7px 8px)` : f.a }} />
        <small>{f.name}</small><em>{game.ownsFinish('floor', f.id, f.price) ? '✓' : `🪙 ${f.price}`}</em></button>)}</div>
      <div className="label">Murs</div>
      <div className="swatches">{WALLS.map((w) => <button key={w.id} className={'sw' + (apt.wall === w.id ? ' on' : '')} onClick={() => game.setFinish('wall', w.id)}>
        <i style={{ background: w.kind === 'stripes' ? `repeating-linear-gradient(90deg, ${w.a} 0 6px, ${w.b} 6px 12px)` : w.kind === 'dots' ? `radial-gradient(${w.b} 25%, ${w.a} 26%) 0 0/9px 9px` : w.a }} />
        <small>{w.name}</small><em>{game.ownsFinish('wall', w.id, w.price) ? '✓' : `🪙 ${w.price}`}</em></button>)}</div>
    </div>
  );
}
function ChatSheet() {
  const [msg, setMsg] = useState(''); const [, f] = useState(0);
  useEffect(() => game.chat.onMessage(() => f((n) => n + 1)), []);
  return (
    <div className="sheet">
      <h3>Chat <small className="muted">local · hors ligne</small><button className="x" onClick={() => game.setPanel(null)}>✕</button></h3>
      <div className="chatlog">{game.chat.history().slice(-6).map((m, i) => <div key={i}><b>{world.chars[m.from]?.name ?? m.from}</b> {m.text}</div>)}</div>
      <form className="chatbar" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) game.sendChat(msg); setMsg(''); }}>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Dire quelque chose…" maxLength={80} />
        <button className="btn primary" type="submit">Envoyer</button>
      </form>
      <div className="quick">{(game.s.location === 'beach' ? ['Salut ! 👋', 'On se baigne ? 🌊', 'Un smoothie ? 🥭', 'On danse ? 🎉'] : ['Salut ! 👋', 'Bienvenue chez moi 🏠', 'Trop cool !', 'On danse ? 🎉']).map((q) => <button key={q} onClick={() => game.sendChat(q)}>{q}</button>)}</div>
    </div>
  );
}
function ProfileSheet() {
  const p = useStore(game.store, (s) => s.profile)!; const active = useStore(game.store, (s) => s.activeChar); const [name, setName] = useState(world.chars[active]?.name ?? p.name);
  return (
    <div className="sheet">
      <h3>Profil <button className="x" onClick={() => game.setPanel(null)}>✕</button></h3>
      <div className="row"><input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={16} /><button className="btn primary" onClick={() => game.rename(name)}>OK</button></div>
      <div className="label">Avatar contrôlé</div>
      <div className="row">{Object.values(AVATARS).map((a) => <button key={a.id} className={'btn' + (active === a.id ? ' primary' : '')} onClick={() => game.setBody(a.id as 'f' | 'm')}>{a.label}</button>)}</div>
      <p className="muted">L’autre avatar est un personnage local de test (pas un joueur en ligne). Garde-robe et coiffures : phase 3.</p>
      <button className="btn danger" onClick={() => { if (confirm('Réinitialiser l’appartement et le sac ?')) game.resetSave(); }}>Réinitialiser la sauvegarde</button>
    </div>
  );
}
function PlacesSheet() {
  const loc = useStore(game.store, (s) => s.location);
  return (
    <div className="sheet">
      <h3>Lieux <button className="x" onClick={() => game.setPanel(null)}>✕</button></h3>
      <div className="grid">{LOCATIONS.map((l) => { const here = l.id === loc;
        return <button key={l.id} className={'card' + (here ? ' here' : '')} disabled={l.status !== 'playable'} onClick={() => (here ? game.setPanel(null) : game.travelWithFade(l.id))}>
          <span className="big">{l.icon}</span><b>{l.name}</b><small>{l.status !== 'playable' ? 'Bientôt' : here ? 'Tu y es' : <span className="places-card-go">Y aller →</span>}</small></button>; })}</div>
      <p className="muted">Lieux publics hors ligne : seuls tes deux avatars locaux y sont (pas de faux joueurs).</p>
    </div>
  );
}
