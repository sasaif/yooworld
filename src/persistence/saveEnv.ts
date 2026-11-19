/** Save environments (P0.A). GitHub Pages serves every YooWorld folder from ONE origin, and localStorage /
 *  sessionStorage are per origin, not per path. Each build therefore gets a build-time env id
 *  (tools/save-env-rules.mjs, injected by vite.config.ts) and may only touch its own keyspace:
 *
 *   env        data keys (saves, economy, looks)     UI prefs (localStorage + sessionStorage)
 *   prod       yooworld:<name>   (legacy, unchanged)  yw.<name>   (legacy, unchanged)
 *   test/<f>   yooworld:e:test.<f>:<name>             yw:e:test.<f>:<name>
 *   dev        yooworld:e:dev:<name>                  yw:e:dev:<name>
 *
 *  Vercel (feature/vercel-env): base '/', each deployment / branch alias / domain is its own origin; production of
 *  `main` -> prod, preview of branch <b> -> test/<slug(b)>, vercel dev -> dev (tools/save-env-rules.mjs, fail closed).
 *
 *  prod = only the public root build (/yooworld/) or the Vercel production build of `main`. The build SHA is NOT part of the key (stable per folder,
 *  owner decision 2026-11-19); it is recorded in save envelopes / backups as `buildId`. */
declare const __YW_ENV__: string | undefined;
declare const __YW_BUILD_ID__: string | undefined;

export interface SaveEnv {
  /** 'prod' | 'dev' | 'dev/<name>' | 'test/<folder>' */
  readonly id: string;
  readonly isProd: boolean;
  /** key-safe form of the id ('test/combined-1' -> 'test.combined-1') */
  readonly tag: string;
  /** full key prefix for data records and for UI prefs */
  readonly dataPrefix: string;
  readonly prefPrefix: string;
  readonly buildId: string;
}
const SEG = /^[a-z0-9][a-z0-9._-]{0,40}$/i;
export const isValidEnvId = (id: string) => id === 'prod' || id === 'dev' || (/^(dev|test)\//.test(id) && SEG.test(id.slice(id.indexOf('/') + 1)));
export const envTag = (id: string) => id.replace(/\//g, '.');
/** The production (legacy, un-namespaced) keyspace: any yooworld:* key that is not an env key, and any bare yw.* key. */
export const isProdKey = (k: string) => (k.startsWith('yooworld:') && !k.startsWith('yooworld:e:')) || k.startsWith('yw.');
/** Any key that looks like a full storage key rather than a logical name (callers must pass logical names). */
export const looksLikeFullKey = (k: string) => k.startsWith('yooworld:') || k.startsWith('yw.') || k.startsWith('yw:');

export function makeSaveEnv(id: string, buildId = 'unknown'): SaveEnv {
  if (!isValidEnvId(id)) throw new Error(`[save-env] invalid env id "${id}"`);
  const isProd = id === 'prod'; const tag = envTag(id);
  return Object.freeze({ id, isProd, tag, buildId,
    dataPrefix: isProd ? 'yooworld:' : `yooworld:e:${tag}:`,
    prefPrefix: isProd ? 'yw.' : `yw:e:${tag}:` });
}
/** The env this bundle was built for. Anything not explicitly built as prod is 'dev' (never prod by accident). */
export const SAVE_ENV: SaveEnv = makeSaveEnv(typeof __YW_ENV__ === 'string' ? __YW_ENV__ : 'dev', typeof __YW_BUILD_ID__ === 'string' ? __YW_BUILD_ID__ : 'unknown');
