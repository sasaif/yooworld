import { useEffect, useRef, useState } from 'react';
import { motion, onRunChange, setRun } from '../../game/movement/playerMotion';
import { inputEnabled } from './joystickState';

/** Walk / run toggle next to the joystick (touch) + the R key (keyboard). Hidden with the joystick; absent in ?move=classic. */
export function RunButton({ hidden, showButton }: { hidden?: boolean; showButton: boolean }) {
  const [on, setOn] = useState(motion.run);
  /** time of the last touch / pen toggle: the click the browser may send after it is ignored */
  const touchAt = useRef(-1e9);
  useEffect(() => onRunChange(() => setOn(motion.run)), []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; if (e.code !== 'KeyR' || e.repeat || e.metaKey || e.ctrlKey || e.altKey || !inputEnabled() || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))) return; setRun(!motion.run); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, []);
  if (motion.profile.classic || !showButton) return null;
  return (
    <button className={'run-btn' + (on ? ' on' : '') + (hidden ? ' joy-hidden' : '')} aria-pressed={on} aria-label={on ? 'Courir : activé (touche R)' : 'Courir : désactivé (touche R)'}
      onPointerDown={(e) => {
        e.stopPropagation();
        // touch: toggle on press. A second finger tapping 🏃 while the thumb holds the joystick gets no click event in
        // mobile browsers (multi-touch), so the click alone could not switch Run off / on while moving.
        if (e.pointerType !== 'mouse') { touchAt.current = performance.now(); setRun(!motion.run); }
      }}
      onClick={(e) => { e.stopPropagation(); if (performance.now() - touchAt.current < 800) return; setRun(!motion.run); }}>
      <span aria-hidden>🏃</span><small>{on ? 'Course' : 'Marche'}</small>
    </button>
  );
}
