import type { ApartmentLayout } from '../game/apartment/ApartmentModel';
import type { Inventory } from '../game/inventory/Inventory';
import type { GameRepository, Profile } from './types';
import type { SaveBackups } from './backup';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
/** `env` / `buildId` are diagnostics only (which build wrote this record); readers ignore them. */
interface Envelope<T> { schema: number; savedAt: number; data: T; env?: string; buildId?: string }
export const SCHEMA = 1;

/** A record exists but cannot be used safely. Nothing has been written; the raw bytes are in backup:raw:<key>. */
export type SaveProblemKind = 'corrupt' | 'future_schema' | 'invalid';
export interface SaveProblem { key: string; kind: SaveProblemKind; detail: string }
export class SaveLoadError extends Error {
  constructor(readonly problem: SaveProblem) { super(`save ${problem.key}: ${problem.kind} (${problem.detail})`); this.name = 'SaveLoadError'; }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Minimal shape checks: a record that fails is reported, never replaced by a starter. */
const VALID: Record<string, (d: unknown) => boolean> = {
  profile: (d) => isObj(d) && typeof d.id === 'string' && typeof d.homeId === 'string',
  apt: (d) => isObj(d) && typeof d.id === 'string' && Array.isArray(d.items),
  inv: (d) => isObj(d) && typeof d.ownerId === 'string' && isObj(d.items),
};

/** Persistence through any KV (in the app: storage.data, the env-namespaced adapter, so `key` is a logical name
 *  like 'profile' or 'apt:home_x'). Every record is wrapped in a versioned envelope; `migrate` upgrades older
 *  schemas. Safe load (P0.B): a missing record returns null (caller may create a starter); a corrupt, invalid or
 *  newer-schema record THROWS SaveLoadError after its raw bytes were copied to the backups — it is never
 *  overwritten by a starter. An older-schema record is snapshotted before the upgraded version is written. */
export class LocalStorageRepository implements GameRepository {
  constructor(private kv: KV, private prefix = '', private backups?: SaveBackups, private meta: { env?: string; buildId?: string } = {}) {}
  private read<T>(key: string): T | null {
    const k = this.prefix + key; const raw = this.kv.getItem(k); if (raw === null || raw === '') return null;
    const kind = key.split(':')[0];
    const fail = (p: SaveProblemKind, detail: string): never => { this.backups?.keepRaw(k, raw, p); throw new SaveLoadError({ key: k, kind: p, detail }); };
    let env: Envelope<T>;
    try { env = JSON.parse(raw) as Envelope<T>; } catch (e) { return fail('corrupt', String((e as Error).message ?? e).slice(0, 120)); }
    if (!isObj(env)) return fail('corrupt', 'not an object');
    const wrapped = typeof env.schema === 'number' && 'data' in env;
    const from = wrapped ? env.schema : 0;
    if (from > SCHEMA) return fail('future_schema', `schema ${from} > ${SCHEMA} (written by a newer build)`);
    const data = migrate(key, from, (wrapped ? env.data : env) as T);
    if (VALID[kind] && !VALID[kind](data)) return fail('invalid', `${kind} record has an unexpected shape`);
    if (from < SCHEMA) this.backups?.snapshot(`migrate ${k} v${from}->v${SCHEMA}`, [k]); // backup BEFORE the upgraded write
    return data;
  }
  private write<T>(key: string, data: T) {
    const env: Envelope<T> = { schema: SCHEMA, savedAt: Date.now(), data, ...(this.meta.env ? { env: this.meta.env } : {}), ...(this.meta.buildId ? { buildId: this.meta.buildId } : {}) };
    this.kv.setItem(this.prefix + key, JSON.stringify(env));
  }
  async loadProfile() { return this.read<Profile>('profile'); }
  async saveProfile(p: Profile) { this.write('profile', p); }
  async loadApartment(id: string) { return this.read<ApartmentLayout>('apt:' + id); }
  async saveApartment(a: ApartmentLayout) { this.write('apt:' + a.id, a); }
  async loadInventory(ownerId: string) { return this.read<Inventory>('inv:' + ownerId); }
  async saveInventory(inv: Inventory) { this.write('inv:' + inv.ownerId, inv); }
}
/** Schema migrations, keyed by record type. v0 = bare object without envelope. */
function migrate<T>(_key: string, from: number, data: T): T {
  let d = data as unknown as Record<string, unknown>;
  if (from < 1 && isObj(d)) d = { version: 1, ...d };
  return d as unknown as T;
}

/** In-memory implementation (tests, guests, server-less previews, temporary recovery sessions). */
export class MemoryRepository extends LocalStorageRepository {
  constructor(readonly store = new Map<string, string>()) {
    super({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
  }
}
