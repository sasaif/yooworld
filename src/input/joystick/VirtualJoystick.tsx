import { useEffect, useRef } from 'react';
import { resetStick, setStick, stick, stickFromOffset, onStickReset } from './joystickState';

/**
 * Bottom-left virtual joystick (touch / pen / mouse via Pointer Events).
 * - tracks its own pointerId with pointer capture, so another finger can pinch-zoom / pan the camera at the
 *   same time (multi-touch); its events never bubble to the camera controls or the 3D scene;
 * - writes the normalised vector into the shared `stick` object; the knob is moved with a direct style
 *   transform (no React render per move); the game loop reads the vector once per frame;
 * - release, pointercancel, lost capture, window blur, tab hidden or page hide → recentre and stop.
 */
export function VirtualJoystick({ hidden, panelOpen }: { hidden?: boolean; panelOpen?: boolean }) {
  const base = useRef<HTMLDivElement>(null); const knob = useRef<HTMLDivElement>(null);
  const geo = useRef({ cx: 0, cy: 0, r: 1 });
  const draw = (x: number, y: number, on: boolean) => {
    const k = knob.current, b = base.current; if (!k || !b) return; const r = geo.current.r;
    k.style.transform = `translate(-50%, -50%) translate(${(x * r).toFixed(1)}px, ${(y * r).toFixed(1)}px)`;
    b.classList.toggle('on', on);
  };
  useEffect(() => onStickReset(() => draw(0, 0, false)), []);
  useEffect(() => { if (hidden) resetStick(); }, [hidden]);
  useEffect(() => () => resetStick(), []);

  const move = (e: React.PointerEvent) => {
    const g = geo.current; const v = stickFromOffset(e.clientX - g.cx, e.clientY - g.cy, g.r);
    setStick(e.pointerId, v.x, v.y, v.mag); draw(v.x, v.y, true);
  };
  const stop = (e: React.PointerEvent) => { e.stopPropagation(); if (e.pointerId !== stick.pointerId) return; resetStick(); };
  return (
    <div ref={base} className={'joy' + (hidden ? ' joy-hidden' : '') + (panelOpen ? ' panel-open' : '')} aria-label="Joystick : glisse pour marcher" role="application"
      onPointerDown={(e) => {
        e.preventDefault(); e.stopPropagation();
        if (stick.active && stick.pointerId !== e.pointerId) return; // one finger drives the stick
        geo.current = joyGeometry(base.current!, knob.current!);
        try { base.current!.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
        move(e);
      }}
      onPointerMove={(e) => { e.stopPropagation(); if (e.pointerId === stick.pointerId) { e.preventDefault(); move(e); } }}
      onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}
      onContextMenu={(e) => e.preventDefault()} onClick={(e) => e.stopPropagation()}>
      <div className="joy-ring" />
      <div className="joy-arrows" aria-hidden><i /><i /><i /><i /></div>
      <div ref={knob} className="joy-knob" />
    </div>
  );
}
/**
 * Stick geometry in CSS px. Uses the LAYOUT sizes (offsetWidth), not getBoundingClientRect sizes: the base has a
 * scale() press / release transition, so a rect read mid-transition used to give a travel radius up to ~3 % off
 * (a thumb on the rim then read d≈0.97). The centre is taken from the rect (a centred scale does not move it).
 * Max thumb travel: the knob centre may reach the base rim.
 */
export function joyGeometry(base: HTMLElement, knob: HTMLElement) {
  const r = base.getBoundingClientRect();
  return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: stickRadius(base.offsetWidth, knob.offsetWidth) };
}
export const stickRadius = (baseW: number, knobW: number) => Math.max(20, baseW / 2 - knobW * 0.18);

const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches;
/**
 * Joystick on touch-first devices: a coarse primary pointer, OR any touch screen without a fine hovering primary
 * pointer (iPadOS Safari in "desktop" mode reports a Mac UA; some Android tablets / Chromebooks in tablet mode
 * misreport pointer:coarse). A touch laptop driven by its trackpad (fine + hover) keeps click / keyboard controls.
 * `?joystick=1` forces it, `?joystick=0` hides it.
 */
export function wantsJoystick(search = typeof location !== 'undefined' ? location.search : '', coarse = mq('(pointer: coarse)'),
  touchPoints = typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0, fineHover = mq('(hover: hover) and (pointer: fine)')) {
  const q = new URLSearchParams(search).get('joystick');
  if (q === '1') return true; if (q === '0') return false;
  return coarse || (touchPoints > 0 && !fineHover);
}
