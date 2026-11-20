// UAT smoke test against the live Worker. Run from a directory where `@neondatabase/serverless` and `ws` resolve
// (deliberately NOT in package.json; the box keeps them in work-backend/neon-tools). Env: UAT_BASE (https://...), NEON_OWNER_URL (owner, used ONLY to
// mark the smoke e-mail verified, since uat has EMAIL_MODE=disabled, and to read reconciliation). Prints JSON, no secrets.
import { Pool, neonConfig } from '@neondatabase/serverless';
import WebSocket from 'ws';
neonConfig.webSocketConstructor = WebSocket;
const BASE = process.env.UAT_BASE; if (!/^https:\/\/[^/]*uat[^/]*$/.test(BASE ?? '')) throw new Error('UAT_BASE must be the https uat origin');
if (/prod/i.test(BASE)) throw new Error('refusing: prod');
const ORIGIN = process.env.UAT_ORIGIN ?? BASE; const FAKE = 'local-fake-pass';
const owner = new Pool({ connectionString: process.env.NEON_OWNER_URL });
const sql = async (q, v = []) => (await owner.query(q, v)).rows;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = {}; const t = () => performance.now(); const ms = (t0) => +(performance.now() - t0).toFixed(0);
async function http(method, p, { body, cookie, headers = {} } = {}) {
  const h = { 'content-type': 'application/json', origin: ORIGIN, ...headers }; if (cookie) h.cookie = cookie;
  const t0 = t(); const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { json = text.slice(0, 200); }
  return { status: r.status, json, headers: r.headers, ms: ms(t0) };
}
const jar = (h) => h.getSetCookie().map((c) => c.split(';')[0]).join('; ');
async function signIn(email, password) {
  const r = await http('POST', '/api/auth/sign-in/email', { body: { email, password } });
  return { status: r.status, code: r.json?.code, cookie: r.status === 200 ? jar(r.headers) : '', ms: r.ms };
}
function openWs(room, ticket) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace('https', 'wss')}/ws/${room}?ticket=${encodeURIComponent(ticket)}`, { headers: { origin: ORIGIN } });
    const c = { ws, msgs: [], closed: null, t0: t() };
    ws.on('message', (d) => { try { c.msgs.push(JSON.parse(String(d))); } catch { /* */ } });
    ws.on('close', (code) => { c.closed = { code, at: t() }; });
    ws.on('open', () => resolve(c));
    ws.on('unexpected-response', (_q, res) => reject(Object.assign(new Error(`ws ${res.statusCode}`), { status: res.statusCode })));
    ws.on('error', (e) => { if (ws.readyState !== WebSocket.OPEN) reject(e); });
  });
}
const waitFor = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = pred(); if (v) return v; await sleep(25); } return null; };
async function joinWs(cookie) {
  const j = await http('POST', '/api/rooms/beach/join', { cookie, body: {} });
  if (j.status !== 200) return { join: j.status, body: j.json };
  const t0 = t(); const c = await openWs(j.json.room, j.json.ticket);
  const w = await waitFor(() => c.msgs.find((m) => m.t === 'welcome'));
  if (w) { const me = w.players.find((p) => p.id === w.you); c.ws.send(JSON.stringify({ t: 'move', x: me.pos.x, z: me.pos.z })); }
  return { c, room: j.json.room, join_ms: j.ms, welcome: !!w, welcome_ms: ms(t0) };
}
try {
  const h = await http('GET', '/api/health'); R.health = { status: h.status, body: h.json, ms: h.ms };
  const hd = await http('GET', '/api/health/db'); R.health_db = { status: hd.status, body: hd.json, ms: hd.ms };
  const hd2 = await http('GET', '/api/health/db'); R.health_db_warm_ms = hd2.ms;
  R.dev_routes_hidden = (await http('GET', '/dev/ops/check')).status;
  R.cors_foreign_origin_post = (await http('POST', '/api/economy/daily', { headers: { origin: 'https://evil.example' } })).status;

  const email = `smoke-${Date.now().toString(36)}@yoland-uat.invalid`, password = 'uat-smoke-' + crypto.randomUUID();
  R.signup_no_human_token = (await http('POST', '/api/auth/sign-up/email', { body: { email, password, name: 'smoke' } })).status;
  const su = await http('POST', '/api/auth/sign-up/email', { body: { email, password, name: 'smoke' }, headers: { 'x-turnstile-token': FAKE } });
  R.signup = { status: su.status, ms: su.ms };
  const s0 = await signIn(email, password); R.signin_before_verify = { status: s0.status, code: s0.code };
  const upd = await sql(`update auth."user" set "emailVerified" = true where email = $1 returning id`, [email]);   // EMAIL_MODE=disabled: verify by SQL
  R.verified_by_sql = upd.length === 1;
  const a = await signIn(email, password); R.signin = { status: a.status, ms: a.ms };
  const me = await http('GET', '/api/me', { cookie: a.cookie }); R.me = { status: me.status, ms: me.ms };

  const key = `uat-smoke-${crypto.randomUUID()}`;
  const g1 = await http('POST', '/api/economy/test-grant', { cookie: a.cookie, body: { amount: 100 }, headers: { 'idempotency-key': key } });
  const g2 = await http('POST', '/api/economy/test-grant', { cookie: a.cookie, body: { amount: 100 }, headers: { 'idempotency-key': key } });
  const bal = await http('GET', '/api/economy/balance', { cookie: a.cookie });
  R.test_gold = { grant: { status: g1.status, body: g1.json, ms: g1.ms }, replay_same_key: { status: g2.status, body: g2.json }, balance: bal.json };

  const ja = await joinWs(a.cookie); R.ws_join_a = { room: ja.room, join_ms: ja.join_ms, welcome: ja.welcome, welcome_ms: ja.welcome_ms };
  const b = await signIn(email, password);                       // second session of the same user
  const jb = await joinWs(b.cookie); R.ws_join_b = { welcome: jb.welcome, same_room_peers: jb.c.msgs.find((m) => m.t === 'welcome')?.players?.length };
  await sleep(300);
  const t0 = t(); const rv = await http('POST', '/api/auth/revoke-other-sessions', { cookie: a.cookie, body: {} });
  const closedB = await waitFor(() => jb.c.closed);
  R.revocation = { revoke_status: rv.status, ws_b_close: closedB?.code ?? 'not closed', ws_b_close_ms_after_revoke: closedB ? +(closedB.at - t0).toFixed(0) : null,
    revoked_me: (await http('GET', '/api/me', { cookie: b.cookie })).status, revoked_ticket: (await http('POST', '/api/rooms/beach/join', { cookie: b.cookie, body: {} })).status,
    ws_a_closed_by_b_join: ja.c.closed?.code ?? null };           // same user, same room: the newer socket replaces the older (4001)
  const ja2 = await joinWs(a.cookie); R.ws_rejoin_a = { welcome: ja2.welcome };
  await sleep(300);
  const t1 = t(); const so = await http('POST', '/api/auth/sign-out', { cookie: a.cookie, body: {} });
  const closedA = await waitFor(() => ja2.c.closed);
  R.sign_out = { status: so.status, ws_a_close: closedA?.code ?? 'not closed', ms: closedA ? +(closedA.at - t1).toFixed(0) : null };

  const rec = (await sql('select eco.recon_summary() r, audit.verify_chain() c'))[0];
  R.reconciliation = rec.r; R.audit_chain = rec.c;
  R.smoke_user = upd[0]?.id;
} catch (e) { R.error = String(e?.stack ?? e).slice(0, 500); process.exitCode = 1; }
finally { await owner.end(); console.log(JSON.stringify(R, null, 1)); process.exit(); }
