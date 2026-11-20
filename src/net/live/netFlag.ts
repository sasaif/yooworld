/** `?net=1` dev flag (OFF by default). Phase B: the client may only talk to a LOCAL wrangler dev server, so the
 *  optional `?server=` override is restricted to loopback hosts. Returns null when the flag is off. Pure. */
export interface LiveNetConfig { server: string; ws: string }
export const DEFAULT_SERVER = 'http://127.0.0.1:8787';
export function liveNetConfig(search: string): LiveNetConfig | null {
  const q = new URLSearchParams(search);
  if (q.get('net') !== '1') return null;
  let u: URL;
  try { u = new URL(q.get('server') || DEFAULT_SERVER); } catch { return null; }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname) || !['http:', 'https:'].includes(u.protocol)) return null;
  const server = u.origin;
  return { server, ws: server.replace(/^http/, 'ws') };
}
