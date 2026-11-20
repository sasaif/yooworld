// Environment separation at runtime: the Worker refuses to serve with a mixed configuration.
import { it, expect, afterEach } from 'vitest';
import { startWrangler, stopWrangler, http, VARS, BASE, ORIGIN } from './harness';
afterEach(async () => { await stopWrangler(); });
it('ENV_TAG=uat with a loopback database and placeholder secrets -> every route 500 env_invalid', async () => {
  await startWrangler({ ENV_TAG: 'uat' }, 500);
  const r = await http('GET', '/api/health');
  expect(r.json.code).toBe('env_invalid');
  expect(r.json.errors.join(' ')).toMatch(/loopback/);
  expect(r.json.errors.join(' ')).toMatch(/placeholder/);
  expect((await http('POST', '/api/auth/sign-in/email', { body: { email: 'a@b.c', password: 'x' } })).status).toBe(500);
});
it('reused secret (ticket = session secret) -> refused', async () => {
  await startWrangler({ TICKET_SECRET: VARS.BETTER_AUTH_SECRET }, 500);
  expect((await http('GET', '/api/health')).json.errors.join(' ')).toMatch(/must differ/);
});
it('human check (Turnstile hook, fake verifier): sign-up and password reset need a valid token; other routes untouched', async () => {
  await startWrangler({ TURNSTILE_MODE: 'fake' });
  const email = `hc-${Date.now()}@e2e.local`; const body = { email, password: 'correct-horse-battery-9', name: 'h' };
  const no = await http('POST', '/api/auth/sign-up/email', { body, ip: '198.19.9.1' });
  expect(no.status).toBe(403); expect(no.json.code).toBe('human_check_failed');
  expect((await http('POST', '/api/auth/sign-up/email', { body, ip: '198.19.9.1', headers: { 'x-turnstile-token': 'forged' } })).status).toBe(403);
  expect((await http('POST', '/api/auth/sign-up/email', { body, ip: '198.19.9.1', headers: { 'x-turnstile-token': 'local-fake-pass' } })).status).toBe(200);
  expect((await http('POST', '/api/auth/request-password-reset', { body: { email }, ip: '198.19.9.2' })).json.code).toBe('human_check_failed');
  expect((await http('POST', '/api/auth/request-password-reset', { body: { email }, ip: '198.19.9.2', headers: { 'x-turnstile-token': 'local-fake-pass' } })).status).toBe(200);
  expect((await http('POST', '/api/auth/sign-in/email', { body: { email, password: 'wrong-password-zz' }, ip: '198.19.9.3' })).status).toBe(401);   // not gated
});
it('CORS: only APP_ORIGIN gets credentialed CORS headers (preflight and response); other origins get none', async () => {
  await startWrangler();
  const pre = await fetch(`${BASE}/api/rooms/beach/join`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
  expect(pre.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  expect(pre.headers.get('access-control-allow-credentials')).toBe('true');
  const evil = await fetch(`${BASE}/api/rooms/beach/join`, { method: 'OPTIONS', headers: { origin: 'http://evil.example', 'access-control-request-method': 'POST' } });
  expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  const g = await fetch(`${BASE}/api/health`, { headers: { origin: ORIGIN } });
  expect(g.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  expect((await fetch(`${BASE}/api/health`, { headers: { origin: 'http://evil.example' } })).headers.get('access-control-allow-origin')).toBeNull();
});
