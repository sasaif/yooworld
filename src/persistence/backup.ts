import type { KV } from './LocalStorageRepository';
/** Save backups (P0.B). Lives in the SAME env keyspace as the data it protects (prod: yooworld:backup:*,
 *  test/combined-1: yooworld:e:test.combined-1:backup:*), so restoring can never cross environments.
 *  - snapshots: ring of MAX_SNAPSHOTS whole-env copies, taken on a clean boot, before a schema-changing write,
 *    and before any explicit reset. Identical consecutive snapshots are not duplicated.
 *  - raw copies: the exact bytes of a record that could not be read (corrupt / future schema), kept before
 *    anything else happens, up to MAX_RAW distinct copies per record. Never overwritten by a later copy. */
export interface Snapshot { at: number; env: string; buildId: string; reason: string; entries: Record<string, string> }
export interface RawCopy { at: number; buildId: string; reason: string; raw: string }
export const SNAP_KEY = 'backup:snap';
export const RAW_PREFIX = 'backup:raw:';
export const MAX_SNAPSHOTS = 3; export const MAX_RAW = 5;
export const isBackupKey = (name: string) => name.startsWith('backup:');
type ListKV = KV & { keys?(): string[] };

export class SaveBackups {
  constructor(private kv: ListKV, readonly env: string, readonly buildId: string, private now: () => number = Date.now) {}
  private readJSON<T>(name: string, fallback: T): T { try { const r = this.kv.getItem(name); return r ? (JSON.parse(r) as T) : fallback; } catch { return fallback; } }
  /** current env data keys (logical names), backups excluded */
  dataKeys(): string[] { return (this.kv.keys?.() ?? []).filter((k) => !isBackupKey(k)); }
  snapshots(): Snapshot[] { const l = this.readJSON<Snapshot[]>(SNAP_KEY, []); return Array.isArray(l) ? l : []; }
  /** Copy `names` (default: every data key of this env) into the snapshot ring. Returns false if storage refused. */
  snapshot(reason: string, names = this.dataKeys()): boolean {
    const entries: Record<string, string> = {};
    for (const n of names) { const v = this.kv.getItem(n); if (v !== null) entries[n] = v; }
    if (!Object.keys(entries).length) return true;
    const list = this.snapshots(); const last = list[list.length - 1];
    if (last && JSON.stringify(last.entries) === JSON.stringify(entries)) return true;
    const next = [...list, { at: this.now(), env: this.env, buildId: this.buildId, reason, entries }].slice(-MAX_SNAPSHOTS);
    try { this.kv.setItem(SNAP_KEY, JSON.stringify(next)); return true; }
    catch (e) { console.warn('[backup] snapshot not stored', e); return false; }
  }
  rawCopies(name: string): RawCopy[] { const l = this.readJSON<RawCopy[]>(RAW_PREFIX + name, []); return Array.isArray(l) ? l : []; }
  /** Keep the exact bytes of an unreadable record. Distinct copies only; the oldest copies are kept first. */
  keepRaw(name: string, raw: string, reason: string): boolean {
    const list = this.rawCopies(name); if (list.some((c) => c.raw === raw)) return true;
    if (list.length >= MAX_RAW) return true; // keep the first copies; never overwrite evidence
    try { this.kv.setItem(RAW_PREFIX + name, JSON.stringify([...list, { at: this.now(), buildId: this.buildId, reason, raw }])); return true; }
    catch (e) { console.warn('[backup] raw copy not stored', e); return false; }
  }
  /** Write a snapshot's records back (current state is snapshotted first, so a restore is itself undoable). */
  restore(snap: Snapshot, only?: string[]) {
    this.snapshot('before-restore');
    for (const [n, v] of Object.entries(snap.entries)) if (!only || only.includes(n)) this.kv.setItem(n, v);
  }
  /** Everything a support person needs, as one JSON document (download from the recovery panel). */
  exportAll(): string {
    const data: Record<string, string | null> = {}; for (const n of this.kv.keys?.() ?? []) data[n] = this.kv.getItem(n);
    return JSON.stringify({ env: this.env, buildId: this.buildId, exportedAt: this.now(), data }, null, 1);
  }
}
const parses = (v: string | undefined) => { if (v === undefined) return false; try { JSON.parse(v); return true; } catch { return false; } };
/** Newest snapshot that holds a parseable copy of every given record (what the recovery panel offers to restore). */
export function restorableSnapshot(list: Snapshot[], keys: string[]): Snapshot | null {
  for (let i = list.length - 1; i >= 0; i--) if (keys.every((k) => parses(list[i].entries[k]))) return list[i];
  return null;
}
