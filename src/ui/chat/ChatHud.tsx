import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../../core/store';
import { game } from '../../app/services';
import { chatUi } from '../../persistence/storage';
import { world } from '../../game/world';
import { AVATARS } from '../../data/avatars';
import { locationById } from '../../data/locations';
import { chatScopeNote, netBadge } from '../../net/netStatus';
import { QUALITY } from '../../render/quality';
import { keyboardInset } from '../../app/viewportFill';
import { chatGlassFallback, setChatGlassFallback } from './chatGlass';
import { installBubbleLayer } from './bubbleLayer';
import {
  keyboardPanel, movePanel, parsePrefs, prefsFromRect, rectFromPrefs, resizePanel, stepPanel,
  type PanelPrefs, type PanelViewport, type Rect,
} from './panelLayout';
import type { ChatMessage } from '../../game/social/social';
import './chat-glass.css';

/** Option C + Glass Candy, vertical edition: speech bubbles first (above avatars), history second.
 *  Closed by default (compact Chat button + unread badge); opening shows a narrow vertical panel that can be moved
 *  (drag the header) and resized (grip / − +), persisted under ywchatui.<env>.panel. Closing never stops reception:
 *  ChatStore keeps the history and BubbleDirector keeps showing bubbles. */
const PANEL_KEY = 'panel';
const readPrefs = () => parsePrefs(chatUi.getItem(PANEL_KEY));
const writePrefs = (p: PanelPrefs | null) => { if (p) chatUi.setItem(PANEL_KEY, JSON.stringify(p)); else chatUi.removeItem(PANEL_KEY); };

const EMOJIS = ['😊', '✨', '❤️', '🎉', '👋'];
const STICKERS = [
  { id: 'star', glyph: '🌟', label: 'Sticker étoile' },
  { id: 'heart', glyph: '💖', label: 'Sticker cœur' },
  { id: 'wave', glyph: '🌈', label: 'Sticker arc-en-ciel' },
  { id: 'candy', glyph: '🍬', label: 'Sticker bonbon' },
];
type Tab = 'room' | 'nearby' | 'friends';
const CANDY = ['pink', 'lav', 'mint', 'sun', 'blue', 'teal'] as const;
function candyOf(id: string) { let n = 0; for (let i = 0; i < id.length; i++) n = (n + id.charCodeAt(i) * (i + 1)) % CANDY.length; return CANDY[n]; }
export const speakerName = (id: string) => world.chars[id]?.name ?? game.virtualSpeakers.get(id)?.name ?? id;
function portrait(from: string, name: string) {
  const av = (AVATARS as Record<string, { tagColor: string } | undefined>)[from];
  const letter = (name || from || '?').trim().charAt(0).toUpperCase() || '?';
  return { letter, color: av?.tagColor ?? '#c9a0d8' };
}
function ChatPortrait({ from, name }: { from: string; name: string }) {
  const p = portrait(from, name);
  return <span className="chat-av" style={{ background: p.color }} aria-hidden>{p.letter}</span>;
}

function useHistory() {
  const [log, setLog] = useState<ChatMessage[]>(() => game.chat.history());
  useEffect(() => game.chat.subscribe(setLog), []);
  return log;
}
function useOpaque() {
  const [opaque, setOpaque] = useState(() => chatGlassFallback({ quality: QUALITY, search: typeof location !== 'undefined' ? location.search : '', win: typeof window !== 'undefined' ? window : null }));
  useEffect(() => {
    const apply = () => setOpaque(chatGlassFallback({ quality: QUALITY, search: location.search, win: window }));
    const mq = window.matchMedia?.('(prefers-reduced-transparency: reduce)');
    mq?.addEventListener?.('change', apply);
    const w = window as unknown as { __setChatGlassFallback: typeof setChatGlassFallback };
    const prev = w.__setChatGlassFallback;
    w.__setChatGlassFallback = (on: boolean | null) => { setChatGlassFallback(on); apply(); };
    return () => { mq?.removeEventListener?.('change', apply); w.__setChatGlassFallback = prev ?? setChatGlassFallback; };
  }, []);
  return opaque;
}

interface Vp extends PanelViewport { kb: boolean; vvH: number; vvTop: number }
const typingNow = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
function measureVp(): Vp {
  const vw = window.innerWidth, vh = window.innerHeight;
  let topMin = 8;
  document.querySelectorAll<HTMLElement>('.hud-top > *').forEach((e) => {
    const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    if (r.width > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0) topMin = Math.max(topMin, Math.ceil(r.bottom) + 6);
  });
  const d = document.querySelector('.dock')?.getBoundingClientRect();
  const sar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sar')) || 0;
  const kb = keyboardInset(window, typingNow());
  return { vw, vh, topMin, dock: d && d.width ? { l: d.left, r: d.right, t: d.top } : null, sar, kb: kb.open, vvH: kb.vh, vvTop: kb.open ? Math.round(window.visualViewport?.offsetTop ?? 0) : 0 };
}
const sameVp = (a: Vp, b: Vp) => a.vw === b.vw && a.vh === b.vh && a.topMin === b.topMin && a.kb === b.kb && a.vvH === b.vvH && a.vvTop === b.vvTop && (a.dock?.t ?? 0) === (b.dock?.t ?? 0) && (a.dock?.l ?? 0) === (b.dock?.l ?? 0);
/** Re-measured on resize / keyboard / focus and every 400 ms (state only changes when a value changed). */
function useViewport(active: boolean) {
  const [vp, setVp] = useState<Vp | null>(null);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const run = () => { raf = 0; const n = measureVp(); setVp((o) => (o && sameVp(o, n) ? o : n)); };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    const t = setInterval(on, 400);
    addEventListener('resize', on); window.visualViewport?.addEventListener('resize', on); window.visualViewport?.addEventListener('scroll', on);
    document.addEventListener('focusin', on); document.addEventListener('focusout', on);
    return () => { clearInterval(t); if (raf) cancelAnimationFrame(raf); removeEventListener('resize', on); window.visualViewport?.removeEventListener('resize', on); window.visualViewport?.removeEventListener('scroll', on); document.removeEventListener('focusin', on); document.removeEventListener('focusout', on); };
  }, [active]);
  return vp;
}

function ChatButton({ opaque, unread, last }: { opaque: boolean; unread: number; last: ChatMessage | undefined }) {
  const name = last ? speakerName(last.from) : '';
  return (
    <button type="button" className={'chat-preview chat-fab' + (opaque ? ' chat-opaque' : '')} data-chat-glass={opaque ? 'opaque' : 'filter'}
      aria-label={`Ouvrir le chat${last ? `. Dernier message de ${name} : ${last.text}` : ''}${unread ? `. ${unread} non lus` : ''}`}
      onClick={() => game.setPanel('chat')}>
      <span className="chat-fab-ico" aria-hidden>💬</span>
      <span className="chat-preview-line">Chat</span>
      {unread > 0 && <span className="chat-unread" data-unread={unread}>{unread > 99 ? '99+' : unread}</span>}
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
  const open = panel === 'chat';
  const vp = useViewport(open && ready && mode === 'play');
  const [unread, setUnread] = useState(0);
  const [missedFrom, setMissedFrom] = useState<{ id: string; n: number } | null>(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<Tab>('room');
  const [noteOpen, setNoteOpen] = useState(false);
  const [tray, setTray] = useState(false);
  const [freshId, setFreshId] = useState('');
  const [prefs, setPrefs] = useState<PanelPrefs | null>(() => readPrefs());
  const [drag, setDrag] = useState<Rect | null>(null);
  const openRef = useRef(open); openRef.current = open;
  const unreadRef = useRef(0); unreadRef.current = unread;
  const log = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const gesture = useRef<{ kind: 'move' | 'size'; x: number; y: number; start: Rect; id: number } | null>(null);

  // speech bubbles keep working whatever the panel does (director tick + de-overlap, ~8 Hz)
  useEffect(() => installBubbleLayer(), []);
  // reception never depends on the panel: count what arrives while it is closed
  useEffect(() => game.chat.onMessage((m) => {
    if (!openRef.current && !m.local) setUnread((n) => n + 1);
    setFreshId(m.id);
  }), []);
  useEffect(() => {
    if (open) {
      const n = unreadRef.current; const h = game.chat.history();
      setMissedFrom(n > 0 && h.length ? { id: h[Math.max(0, h.length - n)].id, n } : null);
      setUnread(0); setTab('room'); pinned.current = true;
    } else { setTray(false); setDrag(null); }
  }, [open]);
  useLayoutEffect(() => {
    const el = log.current; if (!el || !pinned.current) return;
    const mark = missedFrom && el.querySelector<HTMLElement>('.chat-missed');
    el.scrollTop = el.scrollHeight;
    if (mark && open && unread === 0 && el.dataset.missedShown !== missedFrom.id) { el.dataset.missedShown = missedFrom.id; el.scrollTop = Math.max(0, mark.offsetTop - 4); pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8; }
  });
  // keyboard opens / closes: the card changes height -> keep the newest message in view
  useEffect(() => { const el = log.current; if (el && vp) { pinned.current = true; el.scrollTop = el.scrollHeight; } }, [vp?.kb]);
  useEffect(() => {
    const el = log.current; if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (pinned.current) el.scrollTop = el.scrollHeight; });
    ro.observe(el); return () => ro.disconnect();
  }, [open]);

  if (!ready || mode !== 'play') return null;
  if (!open) return <ChatButton opaque={opaque} unread={unread} last={history[history.length - 1]} />;

  const local = netBadge(game.net.status).tone === 'local';
  const sim = (game.net as { simulated?: boolean }).simulated === true;
  const note = chatScopeNote(game.net.status);
  const place = locationById(loc)?.name ?? loc;
  const who = Object.keys(world.chars).length;
  const skin = opaque ? ' chat-opaque' : '';
  const close = () => game.setPanel(null);
  const send = (text: string) => { const t = text.trim(); if (!t) return; game.sendChat(t); setMsg(''); setTray(false); pinned.current = true; };
  const roomLog = history;

  // geometry: user rect (persisted) clamped to the viewport; keyboard: docked right above it
  const base: Rect | null = vp ? (drag ?? rectFromPrefs(prefs, vp)) : null;
  const rect: Rect | null = base && vp ? (vp.kb ? keyboardPanel(base, vp, vp.vvH, 150, vp.vvTop) : base) : null;
  const style = rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, right: 'auto', bottom: 'auto', maxHeight: 'none', margin: 0 } : { visibility: 'hidden' as const };
  const startGesture = (kind: 'move' | 'size') => (e: RPointerEvent<HTMLElement>) => {
    if (!base || vp?.kb) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button')) return;
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    gesture.current = { kind, x: e.clientX, y: e.clientY, start: base, id: e.pointerId };
  };
  const onGesture = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current; if (!g || g.id !== e.pointerId || !vp) return;
    const dx = e.clientX - g.x, dy = e.clientY - g.y;
    setDrag(g.kind === 'move' ? movePanel(g.start, dx, dy, vp) : resizePanel(g.start, dx, dy, vp));
  };
  const endGesture = (e: RPointerEvent<HTMLElement>) => {
    const g = gesture.current; if (!g || g.id !== e.pointerId) return;
    gesture.current = null;
    if (drag && vp) { const p = prefsFromRect(drag, vp); setPrefs(p); writePrefs(p); }
    setDrag(null);
  };
  const step = (dir: -1 | 1) => { if (!base || !vp) return; const r = stepPanel(base, dir, vp); const p = prefsFromRect(r, vp); setPrefs(p); writePrefs(p); };
  const resetPos = () => { setPrefs(null); writePrefs(null); };
  const gestureProps = { onPointerMove: onGesture, onPointerUp: endGesture, onPointerCancel: endGesture };

  return (
    <div ref={sheet} className={'sheet chat-sheet chat-glass chat-vertical' + skin + (drag ? ' dragging' : '')} data-chat-glass={opaque ? 'opaque' : 'filter'}
      data-kb={vp?.kb ? '1' : '0'} style={style} role="dialog" aria-label="Chat">
      <span className="chat-grip" role="separator" aria-label="Redimensionner le chat (glisser)" title="Glisser pour agrandir ou réduire"
        onPointerDown={startGesture('size')} {...gestureProps} />
      <h3 className="chat-drag" onPointerDown={startGesture('move')} {...gestureProps} onDoubleClick={resetPos} title="Glisser pour déplacer · double-clic : position d’origine">
        <button type="button" className="chat-fold" onClick={close} aria-expanded="true" aria-label="Réduire le chat">▾ Chat</button>
        <span className={'chat-mode net-' + netBadge(game.net.status).tone}>{local ? (sim ? 'Mode local · simulation' : 'Mode local · hors ligne') : netBadge(game.net.status).short}</span>
        <button type="button" className="chat-size" aria-label="Réduire la taille du chat" onClick={() => step(-1)}>−</button>
        <button type="button" className="chat-size" aria-label="Agrandir le chat" onClick={() => step(1)}>+</button>
        <button type="button" className="x" onClick={close} aria-label="Fermer le chat">✕</button>
      </h3>
      <p className={'chat-scope' + (noteOpen ? ' open' : '')} onClick={() => setNoteOpen(!noteOpen)}>
        <span className="chat-loc">📍 {place}</span>
        <span className="chat-players" title={local ? 'Avatars locaux sur cet appareil (pas de joueurs en ligne)' : 'Joueurs présents'}>👥 {who}{local ? ' avatars' : ''}</span>
        <span className="chat-note">{local && !noteOpen ? 'Visible seulement sur cet appareil.' : note}</span>
        {local && <span className="more">{noteOpen ? ' ▴' : ' ⓘ'}</span>}
      </p>
      <div className="chat-tabs" role="tablist" aria-label="Filtrer le chat">
        <button type="button" role="tab" aria-selected={tab === 'room'} className={'chat-tab' + (tab === 'room' ? ' on' : '')} onClick={() => setTab('room')}>Salon</button>
        <button type="button" role="tab" aria-selected={tab === 'nearby'} className={'chat-tab' + (tab === 'nearby' ? ' on' : '')} onClick={() => setTab('nearby')}>Proches</button>
        <button type="button" role="tab" aria-selected={tab === 'friends'} className={'chat-tab' + (tab === 'friends' ? ' on' : '')} onClick={() => setTab('friends')}>Amis</button>
      </div>
      <div className="chatlog" ref={log} aria-live="polite" onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8; }}>
        {tab === 'nearby' && <EmptyTab title="Aucun joueur à proximité" body="Le mode local n’affiche que tes avatars sur cet appareil. Les proches arriveront avec le multijoueur." />}
        {tab === 'friends' && <EmptyTab title="Aucun ami pour l’instant" body="La liste d’amis n’est pas encore branchée. Rien n’est inventé." />}
        {tab === 'room' && roomLog.length === 0 && <EmptyTab title="Pas encore de message" body="Écris un mot : il s’affiche au-dessus de ton avatar." />}
        {tab === 'room' && roomLog.map((m) => {
          const name = speakerName(m.from);
          const mine = m.local && m.from === active;
          return (
            <div key={m.id} data-id={m.id} className="chat-row">
              {missedFrom?.id === m.id && <div className="chat-missed" role="note">{missedFrom.n} message{missedFrom.n > 1 ? 's' : ''} manqué{missedFrom.n > 1 ? 's' : ''}</div>}
              <div className={'chat-msg c-' + candyOf(m.from) + (mine ? ' mine' : '') + (m.id === freshId ? ' new' : '')} dir="auto">
                <ChatPortrait from={m.from} name={name} />
                <div className="chat-col">
                  <div className="chat-nm">{name}</div>
                  <div className="chat-bub"><bdi>{m.text}</bdi></div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {tray && (
        <div className="chat-tray" role="menu" aria-label="Emojis et stickers">
          {EMOJIS.map((e) => <button type="button" key={e} role="menuitem" aria-label={`Emoji ${e}`} onClick={() => setMsg((t) => (t + e).slice(0, 200))}>{e}</button>)}
          {STICKERS.map((s) => <button type="button" key={s.id} role="menuitem" className="sticker" aria-label={s.label} onClick={() => send(s.glyph)}>{s.glyph}</button>)}
        </div>
      )}
      <form className="chatbar" onSubmit={(e) => { e.preventDefault(); send(msg); }}>
        <button type="button" className="chat-tray-btn" aria-expanded={tray} aria-label="Emojis et stickers" onClick={() => setTray((v) => !v)}>😊</button>
        <input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Écrire…" maxLength={200} dir="auto" enterKeyHint="send" />
        <button className="btn primary" type="submit">Envoyer</button>
      </form>
    </div>
  );
}
