/** Signed (HMAC-SHA-256), short-lived, room-bound, single-use room tickets. Portable: Web Crypto only.
 *  Format: base64url(payload).base64url(hmac). Single use is enforced by the room (jti stored durably). */
export interface TicketClaims { sub: string; room: string; env: string; kind: string; cap?: number; owner?: string; sid?: string }
export interface Ticket extends TicketClaims { exp: number; jti: string; iat: number }
export const TICKET_TTL_MS = 30_000;
const enc = new TextEncoder();
const b64u = (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const keyCache = new Map<string, Promise<CryptoKey>>();
const key = (secret: string) => {
  let k = keyCache.get(secret);
  if (!k) { k = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); keyCache.set(secret, k); }
  return k;
};
export async function signTicket(secret: string, c: TicketClaims, ttlMs = TICKET_TTL_MS, now = Date.now()): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('ticket secret too short');
  const body: Ticket = { ...c, iat: now, exp: now + ttlMs, jti: crypto.randomUUID() };
  const p = b64u(enc.encode(JSON.stringify(body)));
  return `${p}.${b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(p)))}`;
}
export type TicketError = 'malformed' | 'bad_signature' | 'expired' | 'wrong_room' | 'wrong_env' | 'not_yet_valid';
export async function verifyTicket(secret: string, tok: string, room: string, env: string, now = Date.now()): Promise<Ticket | { error: TicketError }> {
  const parts = String(tok ?? '').split('.'); if (parts.length !== 2 || !parts[0] || !parts[1] || tok.length > 2048) return { error: 'malformed' };
  const [p, s] = parts;
  let ok = false; try { ok = await crypto.subtle.verify('HMAC', await key(secret), unb64u(s), enc.encode(p)); } catch { return { error: 'malformed' }; }
  if (!ok) return { error: 'bad_signature' };
  let t: Ticket; try { t = JSON.parse(new TextDecoder().decode(unb64u(p))); } catch { return { error: 'malformed' }; }
  if (typeof t.exp !== 'number' || t.exp < now) return { error: 'expired' };
  if (typeof t.iat !== 'number' || t.iat > now + 5_000) return { error: 'not_yet_valid' };
  if (t.room !== room) return { error: 'wrong_room' };
  if (t.env !== env) return { error: 'wrong_env' };
  return t;
}
/** HMAC-SHA-256 (base64url) of a string: used to sign server-computed game results room → API. */
export async function hmac(secret: string, data: string): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('secret too short');
  return b64u(await crypto.subtle.sign('HMAC', await key(secret), enc.encode(data)));
}

/** Hex SHA-256 (Web Crypto: workerd and Node). */
export async function sha256Hex(s: string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
