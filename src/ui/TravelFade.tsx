import { useEffect, useRef } from 'react';
import { useStore } from '../core/store';
import { game } from '../app/services';
import { locationById } from '../data/locations';

/** Short travel transition: warm fade-out, location card, fade-in. Driven by requestAnimationFrame
 *  (not CSS transitions) so it also plays in frame-by-frame recordings. */
export function TravelFade() {
  const tr = useStore(game.store, (s) => s.transition); const el = useRef<HTMLDivElement>(null);
  const state = useRef({ op: 0, label: '' });
  useEffect(() => {
    if (tr) state.current.label = tr.to;
    const card = el.current; if (!card) return;
    const loc = locationById(state.current.label);
    (card.querySelector('.fade-icon') as HTMLElement).textContent = loc?.icon ?? '';
    (card.querySelector('.fade-name') as HTMLElement).textContent = loc?.name ?? '';
    let raf = 0, last = performance.now();
    const tick = () => {
      const now = performance.now(), dt = (now - last) / 1000; last = now;
      const goal = tr ? 1 : 0; const s = state.current;
      s.op = goal > s.op ? Math.min(1, s.op + dt / 0.42) : Math.max(0, s.op - dt / 0.5);
      card.style.opacity = String(s.op); card.style.visibility = s.op > 0.001 ? 'visible' : 'hidden';
      (card.firstElementChild as HTMLElement).style.transform = `translateY(${(1 - s.op) * 14}px) scale(${0.94 + s.op * 0.06})`;
      if (s.op !== goal) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [tr]);
  return <div ref={el} className="travel-fade" style={{ opacity: 0, visibility: 'hidden' }}><div className="fade-card"><span className="fade-icon" /><b className="fade-name" /><small>En route…</small></div></div>;
}
