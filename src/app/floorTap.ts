import type * as THREE from 'three';
import { game } from './services';
import { world } from '../game/world';
import { resolveTapTarget, type TapReason } from '../game/movement/tapTarget';
import { invalidMarker, showMarker } from '../game/movement/marker';
import { floorTapMoves, lastPointerKind, moveSettings, primaryInput } from '../input/moveSettings';

const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches;
export const devicePrimaryInput = () => primaryInput(mq('(pointer: coarse)'), typeof navigator !== 'undefined' ? navigator.maxTouchPoints ?? 0 : 0, mq('(hover: hover) and (pointer: fine)'));

export type FloorTapResult = 'moved' | 'snapped' | 'ignored' | `invalid:${TapReason}` | 'failed';
/** e2e / debug: what the last floor taps did (read via window.__move().tap). */
export const floorTapLog = { last: null as null | { result: FloorTapResult; kind: string | null; x: number; z: number; tx?: number; tz?: number; at: number }, count: 0, ignored: 0, moved: 0, invalid: 0 };

/**
 * Floor tap / click in play mode (apartment floor or beach sand). Furniture, props and avatars handle their own
 * taps before this (they stop propagation), so their menus work whatever the movement setting.
 * - mouse / pen click → click-to-move (always);
 * - touch → only when "Joystick + toucher pour aller" is enabled; otherwise the tap only closes an open menu.
 */
export function onFloorTap(point: THREE.Vector3, dbl: boolean): FloorTapResult {
  const kind = lastPointerKind(); floorTapLog.count++;
  const log = (result: FloorTapResult, t?: THREE.Vector3) => { floorTapLog.last = { result, kind, x: point.x, z: point.z, tx: t?.x, tz: t?.z, at: performance.now() }; return result; };
  if (!floorTapMoves(kind, moveSettings.get(), devicePrimaryInput())) {
    if (game.s.menuItem) game.store.set({ menuItem: null });
    floorTapLog.ignored++; return log('ignored');
  }
  const me = world.chars[game.s.activeChar]; if (!me) return log('failed');
  const from = me.mode === 'sitting' && me.sitOn ? me.sitOn.front : me.pos;
  const t = resolveTapTarget(world.nav, from, point);
  if (!t.ok) { if (game.s.menuItem) game.store.set({ menuItem: null }); invalidMarker(point.x, point.z); floorTapLog.invalid++; return log(`invalid:${t.reason}`); }
  if (!game.walkTo(t.point.clone(), dbl)) { invalidMarker(point.x, point.z); floorTapLog.invalid++; return log('failed'); }
  window.dispatchEvent(new Event('yw:follow'));
  showMarker(t.point.x, t.point.z, me.id); floorTapLog.moved++;
  return log(t.snapped ? 'snapped' : 'moved', t.point);
}
