/** Pure helpers for `?net=1` remote avatars (unit-tested; no three.js / React). */
/** Stable look per player id (FNV-1a), so a player keeps the same look across reconnects and for every viewer. */
export function remoteLookIndex(id: string, n: number) {
  let h = 0x811c9dc5; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) % Math.max(1, n);
}
export const REMOTE_SNAP_M = 6;      // farther than this (teleport / spawn / missed snapshots): snap, don't walk across
export const REMOTE_RUN_M = 1.5;     // behind by more than this: run to catch up
export const REMOTE_EPS_M = 0.05;
export function remoteTarget(x: number, z: number, tx: number, tz: number) {
  const d = Math.hypot(tx - x, tz - z);
  return { d, snap: d > REMOTE_SNAP_M, move: d > REMOTE_EPS_M, run: d > REMOTE_RUN_M };
}
/** Number shown in the HUD when the flag is on: me + the remotes of the room, only once the server welcomed us. */
export const onlinePlayers = (sync: { you: string | null; remotes: { size: number } }) => (sync.you ? sync.remotes.size + 1 : 0);
