// Cross-site front (uat: Vercel front -> workers.dev API): APP_ORIGINS adds exact browser origins to CORS, the CSRF
// check, Better Auth trustedOrigins and the WebSocket upgrade; the session cookie becomes SameSite=None; Secure;
// Partitioned; AUTH_BEARER=on adds the signed bearer token fallback (Safari/iOS ITP). Other origins stay refused.
import { it, expect, afterAll } from 'vitest';
import WebSocket from 'ws';
import { startWrangler, stopWrangler, http, su, signUp, BASE, WSB, ORIGIN, freshIp } from './harness';
const FRONT = 'http://front.localhost:5180';                 // another host than the API = cross-site cookies
const EVIL = 'http://evil.example';
const pool = su();
afterAll(async () => { await stopWrangler(); await pool.end(); });
const wsStatus = (room: string, ticket: string, origin?: string) => new Promise<number>((res) => {
  const ws = new WebSocket(`${WSB}/ws/${room}?ticket=${encodeURIComponent(ticket)}`, origin ? { origin } : {});
  ws.on('open', () => { ws.close(); res(101); });
  ws.on('unexpected-response', (_q, r) => res(r.statusCode ?? 0));
  ws.on('error', () => res(-1));
});
it('APP_ORIGINS front: CORS + CSRF + trustedOrigins, cross-site cookie attributes, bearer fallback, WS origin check', async () => {
  await startWrangler({ APP_ORIGINS: FRONT, AUTH_BEARER: 'on' });
  // CORS: the extra origin gets credentialed CORS, may send Authorization and read set-auth-token; others get nothing
  const pre = await fetch(`${BASE}/api/auth/get-session`, { method: 'OPTIONS', headers: { origin: FRONT, 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' } });
  expect(pre.headers.get('access-control-allow-origin')).toBe(FRONT);
  expect(pre.headers.get('access-control-allow-credentials')).toBe('true');
  expect(pre.headers.get('access-control-allow-headers')?.toLowerCase()).toContain('authorization');
  const evil = await fetch(`${BASE}/api/auth/get-session`, { method: 'OPTIONS', headers: { origin: EVIL, 'access-control-request-method': 'GET' } });
  expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  // account created through the normal origin, then signed in FROM THE FRONT ORIGIN
  const u = await signUp(pool, 'xo');
  expect((await http('POST', '/api/auth/sign-in/email', { body: { email: u.email, password: u.password }, origin: EVIL, ip: freshIp() })).status).toBe(403);
  const ip = freshIp();
  const r = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: FRONT, 'cf-connecting-ip': ip }, body: JSON.stringify({ email: u.email, password: u.password }) });
  expect(r.status).toBe(200);
  expect(r.headers.get('access-control-allow-origin')).toBe(FRONT);
  expect(r.headers.get('access-control-expose-headers')?.toLowerCase()).toContain('set-auth-token');
  const sc = r.headers.getSetCookie().find((c) => /session_token=/.test(c))!;
  expect(sc).toMatch(/SameSite=None/i); expect(sc).toMatch(/;\s*Secure/i); expect(sc).toMatch(/Partitioned/i);
  const token = r.headers.get('set-auth-token')!;
  expect(token).toMatch(/\./);                                  // signed token (requireSignature)
  // bearer only (no cookie): session OK; a tampered token is not a session
  const gs = await (await fetch(`${BASE}/api/auth/get-session`, { headers: { authorization: `Bearer ${token}`, origin: FRONT, 'cf-connecting-ip': ip } })).json();
  expect(gs?.user?.id).toBe(u.id);
  const bad = await (await fetch(`${BASE}/api/auth/get-session`, { headers: { authorization: `Bearer ${token.slice(0, -2)}xx`, origin: FRONT, 'cf-connecting-ip': ip } })).json();
  expect(bad?.user?.id).toBeUndefined();
  // app route with the bearer token: ticket for the beach
  const j = await http('POST', '/api/rooms/beach/join', { body: {}, origin: FRONT, ip, headers: { authorization: `Bearer ${token}` } });
  expect(j.status).toBe(200); expect(j.json.ticket).toBeTruthy();
  // WebSocket: browser Origin must be allowed; non-browser (no Origin) is gated by the ticket alone
  expect(await wsStatus(j.json.room, j.json.ticket, EVIL)).toBe(403);
  expect(await wsStatus(j.json.room, j.json.ticket, FRONT)).toBe(101);
  const j2 = await http('POST', '/api/rooms/beach/join', { body: {}, origin: ORIGIN, ip, headers: { authorization: `Bearer ${token}` } });
  expect(await wsStatus(j2.json.room, j2.json.ticket)).toBe(101);
  // sign-out with the bearer token from the front: the token is no longer a session
  expect((await http('POST', '/api/auth/sign-out', { body: {}, origin: FRONT, ip, headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
  const after = await (await fetch(`${BASE}/api/auth/get-session`, { headers: { authorization: `Bearer ${token}`, origin: FRONT, 'cf-connecting-ip': ip } })).json();
  expect(after?.user?.id).toBeUndefined();
  await stopWrangler();
  // default config (no APP_ORIGINS, no AUTH_BEARER): the front origin is refused and bearer tokens are ignored
  await startWrangler();
  expect((await fetch(`${BASE}/api/health`, { headers: { origin: FRONT } })).headers.get('access-control-allow-origin')).toBeNull();
  const u2 = await signUp(pool, 'xo2');
  const r2 = await fetch(`${BASE}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': freshIp() }, body: JSON.stringify({ email: u2.email, password: u2.password }) });
  expect(r2.headers.get('set-auth-token')).toBeNull();
  expect(r2.headers.getSetCookie().find((c) => /session_token=/.test(c))).not.toMatch(/Partitioned|SameSite=None/i);
}, 120_000);
