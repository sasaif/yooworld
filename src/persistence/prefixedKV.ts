import { isProdKey, looksLikeFullKey, type SaveEnv } from './saveEnv';
import type { KV } from './LocalStorageRepository';

/** Raw Web Storage surface (localStorage / sessionStorage / a Map in tests). */
export interface RawStorage extends KV { key?(i: number): string | null; readonly length?: number }
export class SaveEnvError extends Error { constructor(msg: string) { super('[save-env] ' + msg); this.name = 'SaveEnvError'; } }

/** The ONLY way game code touches Web Storage (P0.A). Callers use logical names ('profile', 'eco:dev',
 *  'camView'); the adapter adds the env prefix. A non-prod adapter can never resolve to a production key:
 *  passing a full key ('yooworld:profile', 'yw.camView') or anything that would land in the prod keyspace
 *  throws, in every build. There is no "read the root save to be helpful" fallback. */
export class EnvKV implements KV {
  readonly prefix: string;
  constructor(readonly env: SaveEnv, private raw: RawStorage, readonly space: 'data' | 'pref') {
    this.prefix = space === 'data' ? env.dataPrefix : env.prefPrefix;
  }
  /** logical name -> full storage key (throws on legacy / full keys) */
  full(name: string): string {
    if (typeof name !== 'string' || !name) throw new SaveEnvError('empty key');
    if (looksLikeFullKey(name)) throw new SaveEnvError(`"${name}" is a full storage key; pass a logical name (env ${this.env.id})`);
    const k = this.prefix + name;
    if (!this.env.isProd && isProdKey(k)) throw new SaveEnvError(`env ${this.env.id} may not access production key "${k}"`);
    if (this.env.isProd && k.startsWith('yooworld:e:')) throw new SaveEnvError(`prod may not access env key "${k}"`);
    return k;
  }
  getItem(name: string) { return this.raw.getItem(this.full(name)); }
  setItem(name: string, v: string) { this.raw.setItem(this.full(name), v); }
  removeItem(name: string) { this.raw.removeItem(this.full(name)); }
  /** Logical names of every key of THIS env in this space (prod excludes other envs' yooworld:e:* keys). */
  keys(): string[] {
    const out: string[] = []; const n = this.raw.length ?? 0;
    for (let i = 0; i < n; i++) {
      const k = this.raw.key?.(i); if (!k || !k.startsWith(this.prefix)) continue;
      if (this.env.isProd && k.startsWith('yooworld:e:')) continue;
      out.push(k.slice(this.prefix.length));
    }
    return out.sort();
  }
}
/** In-memory RawStorage (tests, ?fresh, private mode fallback). */
export function memoryStorage(m = new Map<string, string>()): RawStorage & { m: Map<string, string> } {
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
    key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
