import { useEffect, useId, useRef, useState } from 'react';
import { expressionBus, installChatExpressions, type ChatLike, type ExpressionBus } from '../../avatar/expressions';
import { moodItems } from './moodItems';
import './mood.css';
/** Dock button "Humeur" + popover with the 5 expressions (mobile-first: 48 px targets, opens above the dock).
 *  Accessible: menu button pattern (aria-haspopup/expanded/controls), arrow keys move, Esc closes and returns focus,
 *  tap outside closes, picking closes. Writes to the expression bus only (the avatar reads it every frame). */
export function MoodMenu({ charId, bus = expressionBus }: { charId: string; bus?: ExpressionBus }) {
  const [open, setOpen] = useState(false); const id = useId(); const wrap = useRef<HTMLDivElement>(null); const btn = useRef<HTMLButtonElement>(null);
  const items = moodItems();
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', away); wrap.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  const pick = (e: (typeof items)[number]['id']) => { bus.trigger(charId, e, { source: 'menu' }); setOpen(false); btn.current?.focus(); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); return; }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const els = Array.from(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []); const i = els.indexOf(document.activeElement as HTMLButtonElement);
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1; els[(i + d + els.length) % els.length]?.focus(); e.preventDefault();
  };
  return (
    <div className="mood-wrap" ref={wrap} onKeyDown={onKey}>
      <button ref={btn} type="button" className={open ? 'on' : ''} aria-haspopup="menu" aria-expanded={open} aria-controls={id} aria-label="Humeur : choisir une expression" onClick={() => setOpen(!open)}>🙂<span>Humeur</span></button>
      {open && (
        <div className="mood-menu" id={id} role="menu" aria-label="Expressions">
          {items.map((m) => <button key={m.id} type="button" role="menuitem" aria-label={m.aria} onClick={() => pick(m.id)}><span className="mood-emoji" aria-hidden="true">{m.emoji}</span><span className="mood-label">{m.label}</span></button>)}
        </div>
      )}
    </div>
  );
}
/** Renders nothing: links chat emojis to the senders' expressions while mounted. */
export function ExpressionChatBridge({ chat, isChar, bus = expressionBus }: { chat: ChatLike; isChar: (id: string) => boolean; bus?: ExpressionBus }) {
  useEffect(() => installChatExpressions(chat, bus, (from) => (isChar(from) ? from : null)), [chat, bus, isChar]);
  return null;
}
