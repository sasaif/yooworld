/** `?net=1` dev flag (OFF by default). Returns null when the flag is off. Pure.
 *  Server choice:
 *   - build config `VITE_YW_API_URL` (passed in by the composition root): must be a loopback origin or EXACTLY one of
 *     ALLOWED_API_ORIGINS (hardcoded: the uat Worker). Anything else (other host, path, wildcard) -> null (no network).
 *   - `?server=` query override: loopback ONLY, as before. Never an arbitrary URL from the query string.
 *   - otherwise the local wrangler dev default. */
export interface LiveNetConfig { server: string; ws: string }
export const DEFAULT_SERVER = 'http://127.0.0.1:8787';
/** Hardcoded allowlist of non-loopback API origins the client may talk to (uat Worker only; no prod yet). */
export const ALLOWED_API_ORIGINS: readonly string[] = ['https://yoland-api-uat.yoland.workers.dev'];
const LOOPBACK = ['127.0.0.1', 'localhost', '[::1]'];
const parse = (s: string) => { try { return new URL(s); } catch { return null; } };
const isLoopback = (u: URL) => LOOPBACK.includes(u.hostname) && ['http:', 'https:'].includes(u.protocol);
/** Build-time API URL accepted? (exact allowlisted origin, or loopback). Returns its origin or null. */
export function allowedBuildApi(v: string | undefined): string | null {
  if (!v) return null;
  const u = parse(v.trim()); if (!u) return null;
  if (isLoopback(u)) return u.origin;
  return ALLOWED_API_ORIGINS.includes(u.origin) && (u.pathname === '/' || u.pathname === '') && !u.search && !u.hash && !u.username && !u.password ? u.origin : null;
}
export function liveNetConfig(search: string, buildApi?: string): LiveNetConfig | null {
  const q = new URLSearchParams(search);
  if (q.get('net') !== '1') return null;
  let server: string;
  const qs = q.get('server');
  if (qs) { const u = parse(qs); if (!u || !isLoopback(u)) return null; server = u.origin; }
  else if (buildApi) { const o = allowedBuildApi(buildApi); if (!o) return null; server = o; }
  else server = DEFAULT_SERVER;
  return { server, ws: server.replace(/^http/, 'ws') };
}
