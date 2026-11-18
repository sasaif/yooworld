/**
 * Destination marker lifecycle (pure state, rendered by <TapMarker/>; unit-tested).
 *   show(p)      → 'active'  : soft ring pulsing on the floor while the avatar walks there
 *   arrive()     → 'fading'  : quick fade-out when the avatar reaches it
 *   cancel()     → 'fading'  : joystick took over / new non-floor action / travel
 *   invalid(p)   → 'invalid' : brief muted "no" ripple where an unreachable spot was tapped (no movement)
 *   step(dt)     → advances timers; fading / invalid end in 'hidden'
 */
export type MarkerPhase = 'hidden' | 'active' | 'fading' | 'invalid';
export const MARKER_CFG = { fade: 0.35, invalid: 0.6, appear: 0.18 };
export const marker = { phase: 'hidden' as MarkerPhase, x: 0, z: 0, t: 0, alpha: 0, from: 1, seq: 0, owner: '' as string };

export function showMarker(x: number, z: number, owner = '') { marker.phase = 'active'; marker.x = x; marker.z = z; marker.t = 0; marker.seq++; marker.owner = owner; }
export function invalidMarker(x: number, z: number) { marker.phase = 'invalid'; marker.x = x; marker.z = z; marker.t = 0; marker.seq++; marker.owner = ''; }
export function arriveMarker() { if (marker.phase === 'active') { marker.phase = 'fading'; marker.from = Math.max(marker.alpha, 0.6); marker.t = 0; } }
export const cancelMarker = arriveMarker;
export function resetMarker() { marker.phase = 'hidden'; marker.t = 0; marker.alpha = 0; }

/** Advance the timers; returns the current opacity (0..1). */
export function stepMarker(dt: number): number {
  marker.t += Math.max(0, dt);
  switch (marker.phase) {
    case 'active': marker.alpha = Math.min(1, marker.t / MARKER_CFG.appear); break;
    case 'fading': marker.alpha = marker.from * Math.max(0, 1 - marker.t / MARKER_CFG.fade); if (marker.t >= MARKER_CFG.fade) { marker.phase = 'hidden'; marker.alpha = 0; } break;
    case 'invalid': marker.alpha = Math.max(0, 1 - marker.t / MARKER_CFG.invalid); if (marker.t >= MARKER_CFG.invalid) { marker.phase = 'hidden'; marker.alpha = 0; } break;
    default: marker.alpha = 0;
  }
  return marker.alpha;
}
