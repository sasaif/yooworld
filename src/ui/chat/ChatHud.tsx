import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { storage } from '../../persistence/storage';
import { world } from '../../game/world';
import { AVATARS } from '../../data/avatars';
import { locationById } from '../../data/locations';
import { chatScopeNote, netBadge } from '../../net/netStatus';
import { QUALITY } from '../../render/quality';
import { chatGlassFallback, setChatGlassFallback } from './chatGlass';
import type { ChatMessage } from '../../game/social/social';
import './chat-glass.css';

const CHAT_COLLAPSED = 'chatCollapsed';
const writeCollapsed = (v: boolean) => { try { storage.prefs.setItem(CHAT_COLLAPSED, v ? '1' : '0'); } catch { /* private mode */ } };

const EMOJIS = ['😊', '✨', '❤️', '🎉', '👋'];
const STICKERS = [
  { id: 'star', glyph: '🌟', label: 'Sticker étoile' },
  { id: 'heart', glyph: '💖', label: 'Sticker cœur' },
  { id: 'wave', glyph: '🌈', label: 'Sticker arc-en-ciel' },
  { id: 'candy', glyph: '🍬', label: 'Sticker bonbon' },
];

type Tab = 'room' | 'nearby' | 'friends';

const CANDY = ['pink', 'lav', 'mint', 'sun', 'blue', 'teal'] as const;
function candyOf(id: string) {
  let n = 0; for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % CANDY.length;
  return CANDY[n];
}

function portrait(from: string, name: string) {
  const av = (AVATARS as Record<string, { tagColor: string } | undefined>)[from];
  const letter = (name || from || '?').trim().charAt(0).toUpperCase() || '?';
  return { letter, color: av?.tagColor ?? '#c9a0d8' };
}

function localCount() { return Object.keys(world.chars).length; }

function useHistory() {
  const [log, setLog] = useState<ChatMessage[]>(() => game.chat.history());
  useEffect(() => game.chat.subscribe(setLog), []);
  return log;
}

function useOpaque() {
  const [opaque, setOpaque] = useState(() => chatGlassFallback({
    quality: QUALITY, search: typeof location !== 'undefined' ? location.search : '', win: typeof window !== 'undefined' ? window : null,
  }));
  useEffect(() => {
    const apply = () => setOpaque(chatGlassFallback({
      quality: QUALITY, search: location.search, win: window,
    }));
    const mq = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    mq?.addEventListener?.('change', apply);
    const w = window as unknown as { __setChatGlassFallback: typeof setChatGlassFallback };
    const prev = w.__setChatGlassFallback;
    w.__setChatGlassFallback = (on: boolean | null) => { setChatGlassFallback(on); apply(); };
    return () => { mq?.removeEventListener?.('change', apply); w.__setChatGlassFallback = prev ?? setChatGlassFallback; };
  }, []);
  return opaque;
}

function ChatPortrait({ from, name }: { from: string; name: string }) {
  const p = portrait(from, name);
  return <span className="chat-av" style={{ background: p.color }} aria-hidden>{p.letter}</span>;
}

function ChatPreview({ opaque, unread, last }: { opaque: boolean; unread: number; last: ChatMessage | undefined }) {
  const name = last ? (world.chars[last.from]?.name ?? last.from) : '';
  return (
    <button type="button" className={'chat-preview' + (opaque ? ' chat-opaque' : '')} data-chat-glass={opaque ? 'opaque' : 'filter'}
      aria-label={last ? `Ouvrir le chat. Dernier message de ${name} : ${last.text}${unread ? `. ${unread} non lus` : ''}` : 'Ouvrir le chat'}
      onClick={() => game.setPanel('chat')}>
      {last ? <>
        <ChatPortrait from={last.from} name={name} />
        <span className="chat-preview-line"><b>{name}</b> · {last.text}</span>
      </> : <span className="chat-preview-line">💬 Chat</span>}
      {unread > 0 && <span className="chat-unread">{unread > 99 ? '99+' : unread}</span>}
    </button>
  );
}

function EmptyTab({ title, body }: { title: string; body: string }) {
  return <div className="chat-empty"><b>{title}</b><p>{body}</p></div>;
}

export function ChatHud() {
  const ready = useStore(game.store, (s) => s.ready);
  const mode = useStore(game.store, (s) => s.mode);
  const panel = useStore(game.store, (s) => s.panel);
  const loc = useStore(game.store, (s) => s.location);
  const active = useStore(game.store, (s) => s.activeChar);
  const history = useHistory();
  const opaque = useOpaque();
  const [unread, setUnread] = useState(0);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<Tab>('room');
  const [noteOpen, setNoteOpen] = useState(false);
  const [stickers, setStickers] = useState(false);
  const [freshAt, setFreshAt] = useState(0);
  const open = panel === 'chat';
  const openRef = useRef(open); openRef.current = open;
  const log = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => game.chat.onMessage((m) => {
    if (!openRef.current) setUnread((n) => n + 1);
    if (m.at) setFreshAt(m.at);
  }), []);

  useEffect(() => {
    if (open) { setUnread(0); writeCollapsed(false); setTab('room'); }
    else writeCollapsed(true);
  }, [open]);

  useEffect(() => { const el = log.current; if (el && pinned.current) el.scrollTop = el.scrollHeight; });
  useEffect(() => {
    const el = log.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, [open]);

  if (!ready || mode !== 'play') return null;

  const local = netBadge(game.net.status).tone === 'local';
  const note = chatScopeNote(game.net.status);
  const place = locationById(loc)?.name ?? loc;
  const who = localCount();
  const skin = opaque ? ' chat-opaque' : '';

  if (!open) return <ChatPreview opaque={opaque} unread={unread} last={history[history.length - 1]} />;

  const close = () => game.setPanel(null);
  const send = (text: string) => { const t = text.trim(); if (!t) return; game.sendChat(t); setMsg(''); setStickers(false); };
  const roomLog = history.slice(-40);

  return (
    <div className={'sheet chat-sheet chat-glass' + skin} data-chat-glass={opaque ? 'opaque' : 'filter'}>
      <h3>
        <button type="button" className="chat-fold" onClick={close} aria-expanded="true" aria-label="Réduire le chat">▾ Chat</button>
        <span className={'chat-mode net-' + netBadge(game.net.status).tone}>{local ? 'Mode local · hors ligne' : netBadge(game.net.status).short}</span>
        <button className="x" onClick={close}>✕</button>
      </h3>
      <div className="chat-head">
        <div className="chat-loc">📍 {place}</div>
        <div className="chat-players" title={local ? 'Avatars locaux sur cet appareil (pas de joueurs en ligne)' : 'Joueurs présents'}>
          👥 {who}{local ? ' avatars' : ' joueurs'}
        </div>
      </div>
      <p className={'chat-scope' + (noteOpen ? ' open' : '')} onClick={() => setNoteOpen(!noteOpen)}>
        {local && !noteOpen ? 'Visible seulement sur cet appareil.' : note}
        {local && <span className="more">{noteOpen ? ' ▴' : ' ⓘ'}</span>}
      </p>
      <div className="chat-tabs" role="tablist" aria-label="Filtrer le chat">
        <button type="button" role="tab" aria-selected={tab === 'room'} className={'chat-tab' + (tab === 'room' ? ' on' : '')} onClick={() => setTab('room')}>Salon</button>
        <button type="button" role="tab" aria-selected={tab === 'nearby'} className={'chat-tab' + (tab === 'nearby' ? ' on' : '')} onClick={() => setTab('nearby')}>Proches</button>
        <button type="button" role="tab" aria-selected={tab === 'friends'} className={'chat-tab' + (tab === 'friends' ? ' on' : '')} onClick={() => setTab('friends')}>Amis</button>
      </div>
      <div className="chatlog" ref={log} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8; }}>
        {tab === 'nearby' && <EmptyTab title="Aucun joueur à proximité" body="Le mode local n’affiche que tes avatars sur cet appareil. Les proches arriveront avec le multijoueur." />}
        {tab === 'friends' && <EmptyTab title="Aucun ami pour l’instant" body="La liste d’amis n’est pas encore branchée. Rien n’est inventé." />}
        {tab === 'room' && roomLog.map((m, i) => {
          const name = world.chars[m.from]?.name ?? m.from;
          const mine = m.from === active;
          const fresh = m.at === freshAt && i === roomLog.length - 1;
          return (
            <div key={(m.at || i) + '-' + i} className={'chat-msg c-' + candyOf(m.from) + (mine ? ' mine' : '') + (fresh ? ' new' : '')} dir="auto">
              <ChatPortrait from={m.from} name={name} />
              <div className="chat-col">
                <div className="chat-nm">{name}</div>
                <div className="chat-bub"><bdi>{m.text}</bdi></div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="quick chat-emoji">
        {EMOJIS.map((e) => <button type="button" key={e} aria-label={`Emoji ${e}`} onClick={() => setMsg((t) => (t + e).slice(0, 200))}>{e}</button>)}
        <button type="button" className="chat-sticker-btn" aria-expanded={stickers} aria-label="Stickers" onClick={() => setStickers((v) => !v)}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="1" y="1.5" width="10.5" height="10.5" rx="2.2" fill="#ffb4e0" stroke="#6a2070" strokeWidth="1.1" />
            <circle cx="5" cy="6.2" r=".8" fill="#6a2070" />
            <circle cx="8.2" cy="6.2" r=".8" fill="#6a2070" />
            <path d="M4.6 8.6c1 1.2 2.8 1.2 3.8 0" fill="none" stroke="#6a2070" strokeWidth="1" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      {stickers && (
        <div className="chat-stickers" role="menu" aria-label="Stickers">
          {STICKERS.map((s) => (
            <button type="button" key={s.id} role="menuitem" aria-label={s.label} onClick={() => { send(s.glyph); }}>{s.glyph}</button>
          ))}
        </div>
      )}
      <form className="chatbar" onSubmit={(e) => { e.preventDefault(); send(msg); }}>
        <input ref={inputRef} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Écrire un message…" maxLength={200} dir="auto" />
        <button className="btn primary" type="submit">Envoyer</button>
      </form>
    </div>
  );
}
