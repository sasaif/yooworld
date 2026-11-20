import * as THREE from 'three';
import { game } from '../../app/services';
import { world } from '../../game/world';
import { stackOffsets, type Box, type StackItem } from './bubbleStack';
/** Speech-bubble upkeep, ~8 times per second (never per frame, no React state):
 *  1. ticks the BubbleDirector (expiry, queued messages get freed slots, cap holds);
 *  2. tells the director which speakers are on screen (off-screen speakers take no slot);
 *  3. de-overlaps the visible bubbles (each other, the top HUD chips, other name tags): own / nearer bubble keeps its
 *     spot, an overlapping one is lifted above it or steps aside;
 *  4. toggles `.on` for the Glass Candy pop-in / fade-out. */
export const BUBBLE_TICK_MS = 120;
const speakerLabel = (id: string) => world.chars[id]?.name ?? id;
const _v = new THREE.Vector3();
export function installBubbleLayer(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onScreen = (id: string) => {
    const c = world.chars[id]; const cam = (window as unknown as { __cam?: THREE.Camera }).__cam;
    if (!c || !cam) return undefined;
    _v.set(c.pos.x, 1.2, c.pos.z).project(cam);
    return Math.abs(_v.x) <= 1.02 && Math.abs(_v.y) <= 1.02 && _v.z < 1;
  };
  game.bubbles.setOnScreen(onScreen);
  const tick = () => {
    game.bubbles.update();
    const self = game.s.activeChar;
    const items: StackItem[] = []; const els = new Map<string, HTMLElement>();
    document.querySelectorAll<HTMLElement>('.tagwrap[data-char]').forEach((w) => {
      const el = w.querySelector<HTMLElement>('.bubble'); if (!el) return;
      const id = w.dataset.char!; const on = el.style.opacity === '1' && !!el.textContent;
      if (el.classList.contains('on') !== on) el.classList.toggle('on', on);
      if (!on) { if (el.dataset.dy && el.dataset.dy !== '0 0') { el.dataset.dy = '0 0'; el.style.translate = ''; } if (el.classList.contains('squeeze')) el.classList.remove('squeeze'); if (el.classList.contains('moved')) el.classList.remove('moved'); return; }
      if (el.dataset.txt !== el.textContent) { el.dataset.txt = el.textContent ?? ''; el.classList.remove('squeeze'); }
      // layout box without our own translate (offsets ignore it, so a running slide does not skew the maths)
      const P = (el.offsetParent as HTMLElement | null)?.getBoundingClientRect(); if (!P) return;
      const l = P.left + el.offsetLeft, t = P.top + el.offsetTop;
      items.push({ id, self: id === self, box: { l, t, r: l + el.offsetWidth, b: t + el.offsetHeight } }); els.set(id, el);
    });
    if (!items.length) return;
    const obstacles: Box[] = [];
    const add = (e: Element, owner?: string) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.width > 0 && cs.visibility !== 'hidden' && +cs.opacity > 0) obstacles.push({ l: r.left, t: r.top, r: r.right, b: r.bottom, owner }); };
    document.querySelectorAll('.hud-top > *').forEach((e) => add(e));
    document.querySelectorAll<HTMLElement>('.tagwrap[data-char] .nametag').forEach((e) => add(e, (e.parentElement as HTMLElement).dataset.char));
    const offs = stackOffsets(items, obstacles, { w: innerWidth, h: innerHeight });
    for (const [id, o] of offs) {
      const el = els.get(id)!; const v = `${Math.round(o.dx)} ${Math.round(o.dy)}`;
      if (o.stuck && !el.classList.contains('squeeze')) el.classList.add('squeeze'); // smaller box: re-placed next tick
      if (el.dataset.dy !== v) { el.dataset.dy = v; el.style.translate = o.dx || o.dy ? `${Math.round(o.dx)}px ${Math.round(o.dy)}px` : ''; }
      // moved away from its speaker: prefix the speaker's name in their tag colour (clear attribution)
      const moved = Math.abs(o.dx) > 24 || o.dy < -36;
      if (moved !== el.classList.contains('moved')) {
        el.classList.toggle('moved', moved);
        if (moved) { const tag = el.parentElement?.querySelector<HTMLElement>('.nametag'); el.dataset.who = speakerLabel(id); if (tag?.style.background) el.style.setProperty('--who', tag.style.background); }
      }
    }
  };
  const t = setInterval(tick, BUBBLE_TICK_MS);
  return () => { clearInterval(t); game.bubbles.setOnScreen(undefined); };
}
