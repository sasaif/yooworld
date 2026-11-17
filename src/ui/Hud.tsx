import { useState } from 'react';
import { AVATARS } from '../data/avatars';
import { goTo, say, world } from '../game/world';

export function Hud({ sel, setSel }: { sel: string; setSel: (id: string) => void }) {
  const [chat, setChat] = useState(false); const [msg, setMsg] = useState(''); const [, force] = useState(0);
  const c = world.chars[sel];
  const seat = (id: string) => { const s = world.seats.find((x) => x.id === id); if (s) { goTo(sel, s.front, { seat: s }); window.dispatchEvent(new Event('yw:follow')); } };
  return (
    <>
      <div className="hud-top">
        {Object.values(AVATARS).map((a) => (
          <button key={a.id} className="chip" style={{ opacity: sel === a.id ? 1 : 0.55, color: a.tagColor }} onClick={() => setSel(a.id)}>
            ● {world.chars[a.id].name}{a.id !== 'f' && <span className="badge-local">LOCAL</span>}
          </button>
        ))}
      </div>
      {chat && (
        <div className="sheet">
          <form className="chatbar" onSubmit={(e) => { e.preventDefault(); if (msg.trim()) say(sel, msg.trim()); setMsg(''); }}>
            <input autoFocus value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Dire quelque chose…" maxLength={80} />
            <button className="btn primary" type="submit">Envoyer</button>
          </form>
        </div>
      )}
      <nav className="dock">
        <button onClick={() => seat('sofa')}>🛋️<span>Canapé</span></button>
        <button onClick={() => { c.emote = !c.emote; force((n) => n + 1); }} className={c.emote ? 'on' : ''}>🎉<span>Danse</span></button>
        <button onClick={() => setChat(!chat)} className={chat ? 'on' : ''}>💬<span>Chat</span></button>
      </nav>
    </>
  );
}
