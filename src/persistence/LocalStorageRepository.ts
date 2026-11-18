import type { ApartmentLayout } from '../game/apartment/ApartmentModel';
import type { Inventory } from '../game/inventory/Inventory';
import type { GameRepository, Profile } from './types';

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void }
interface Envelope<T> { schema: number; savedAt: number; data: T }
export const SCHEMA = 1;

/** MVP persistence in localStorage (or any KV). Every record is wrapped in a versioned envelope;
 *  `migrate` upgrades older schemas so saves stay compatible across releases. */
export class LocalStorageRepository implements GameRepository {
  constructor(private kv: KV, private prefix = 'yooworld:') {}
  private read<T>(key: string): T | null {
    const raw = this.kv.getItem(this.prefix + key); if (!raw) return null;
    try { const env = JSON.parse(raw) as Envelope<T>; return migrate(key, env.schema ?? 0, env.data ?? (env as unknown as T)); }
    catch { return null; } // corrupted record: behave as "no save" rather than crash
  }
  private write<T>(key: string, data: T) { const env: Envelope<T> = { schema: SCHEMA, savedAt: Date.now(), data }; this.kv.setItem(this.prefix + key, JSON.stringify(env)); }
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
  if (from < 1) d = { version: 1, ...d };
  return d as unknown as T;
}

/** In-memory implementation (tests, guests, server-less previews). */
export class MemoryRepository extends LocalStorageRepository {
  constructor(readonly store = new Map<string, string>()) {
    super({ getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) });
  }
}
