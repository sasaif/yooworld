// Online e2e (BUG-U5): revocation -> open WebSocket closed 4401, measured against the live uat Worker, repeated.
// Env: UAT_BASE, UAT_EMAIL + UAT_PASSWORD (existing verified uat account), REPS (default 5), THRESHOLD_MS (2000).
// Metrics per trial, from the start of the revoking request:
//   http_ms   : response time of sign-out / revoke-*; x-ws-revoked = server fan-out stats (inside the request)
//   frame_ms  : 'session_revoked' frame received;  close_ms : close frame received (4401) by the `ws` client
// plus an informative 'native-nosend' trial (Node's built-in WebSocket that never sent a frame, like the QA script):
//   close_event_ms is when that client fires onclose (it waits for the TCP close, see runbook §7 BUG-U5).
// Exit code 1 if any frame/close of the gated trials exceeds THRESHOLD_MS. No secrets printed.
import WS from 'ws';
const BASE = process.env.UAT_BASE; if (!/^https:\/\/[^/]*uat[^/]*$/.test(BASE ?? '') || /prod/i.test(BASE)) throw new Error('UAT_BASE must be the https uat origin');
const ORIGIN = BASE, REPS = Number(process.env.REPS || 5), LIMIT = Number(process.env.THRESHOLD_MS || 2000);
const email = process.env.UAT_EMAIL, password = process.env.UAT_PASSWORD; if (!email || !password) throw new Error('UAT_EMAIL / UAT_PASSWORD required');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function http(method, p, { body, cookie } = {}) {
  const h = { 'content-type': 'application/json', origin: ORIGIN }; if (cookie) h.cookie = cookie;
  const t0 = performance.now(); const r = await fetch(BASE + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const tx = await r.text(); let json = null; try { json = JSON.parse(tx); } catch { /* */ }
  return { status: r.status, json, headers: r.headers, ms: Math.round(performance.now() - t0) };
}
let lastSignIn = 0;
async function signIn() {                                   // Better Auth: 5 sign-ins / min / IP
  const wait = lastSignIn + 12_500 - Date.now(); if (wait > 0) await sleep(wait); lastSignIn = Date.now();
  const r = await http('POST', '/api/auth/sign-in/email', { body: { email, password } });
  if (r.status !== 200) throw new Error(`sign-in ${r.status}`);
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}
function open(kind, room, ticket) {
  return new Promise((resolve, reject) => {
    const url = `${BASE.replace('https', 'wss')}/ws/${room}?ticket=${encodeURIComponent(ticket)}`;
    const c = { msgs: [], frameAt: null, closeAt: null, code: null };
    const onMsg = (d) => { let m; try { m = JSON.parse(String(d)); } catch { return; } c.msgs.push(m); if (m.t === 'error' && m.code === 'session_revoked' && !c.frameAt) c.frameAt = performance.now(); };
    if (kind === 'ws') { const w = new WS(url, { headers: { origin: ORIGIN } }); c.w = w; w.on('message', onMsg); w.on('close', (code) => { c.closeAt = performance.now(); c.code = code; }); w.on('open', () => resolve(c)); w.on('error', reject); }
    else { const w = new WebSocket(url); c.w = w; w.onmessage = (e) => onMsg(e.data); w.onclose = (e) => { c.closeAt = performance.now(); c.code = e.code; }; w.onopen = () => resolve(c); w.onerror = () => reject(new Error('ws error')); }
  });
}
async function trial(path, kind, sendFirst) {
  const victim = await signIn(); const actor = path === 'revoke-other-sessions' ? await signIn() : victim;
  const j = await http('POST', '/api/rooms/beach/join', { cookie: victim, body: {} });
  const c = await open(kind, j.json.room, j.json.ticket);
  const t = performance.now(); while (!c.msgs.find((m) => m.t === 'welcome') && performance.now() - t < 5000) await sleep(10);
  const w = c.msgs.find((m) => m.t === 'welcome');
  if (sendFirst && w) { const me = w.players.find((p) => p.id === w.you); c.w.send(JSON.stringify({ t: 'move', x: me.pos.x, z: me.pos.z })); }
  await sleep(800);
  const t0 = performance.now();
  const r = await http('POST', `/api/auth/${path}`, { cookie: actor, body: {} });
  while (!c.closeAt && performance.now() - t0 < 25_000) await sleep(5);
  if (path === 'revoke-other-sessions') await http('POST', '/api/auth/sign-out', { cookie: actor, body: {} });
  try { c.w.close(); } catch { /* */ }
  return { path, client: `${kind}-${sendFirst ? 'sent' : 'nosend'}`, status: r.status, http_ms: r.ms, x_ws_revoked: r.headers.get('x-ws-revoked'),
    frame_ms: c.frameAt ? Math.round(c.frameAt - t0) : null, [kind === 'ws' ? 'close_ms' : 'close_event_ms']: c.closeAt ? Math.round(c.closeAt - t0) : null, code: c.code };
}
const trials = [];
for (let rep = 0; rep < REPS; rep++) {
  for (const path of ['sign-out', 'revoke-sessions', 'revoke-other-sessions']) trials.push(await trial(path, 'ws', true));
  trials.push(await trial('sign-out', 'ws', false));
  trials.push(await trial('sign-out', 'native', false));
  process.stderr.write(`rep ${rep + 1}/${REPS} done\n`);
}
const stat = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? { n: s.length, min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) } : null; };
const groups = {};
for (const t of trials) { const k = `${t.path} / ${t.client}`; (groups[k] ??= []).push(t); }
const summary = Object.fromEntries(Object.entries(groups).map(([k, a]) => [k, { http_ms: stat(a.map((x) => x.http_ms)), frame_ms: stat(a.map((x) => x.frame_ms)),
  close_ms: stat(a.map((x) => x.close_ms ?? null)), close_event_ms: stat(a.map((x) => x.close_event_ms ?? null)), codes: [...new Set(a.map((x) => x.code))], x_ws_revoked_present: a.every((x) => /closed=[1-9]/.test(x.x_ws_revoked ?? '')) }]));
const gated = trials.filter((t) => t.client.startsWith('ws-'));
const fail = gated.filter((t) => t.code !== 4401 || t.frame_ms === null || t.frame_ms > LIMIT || t.close_ms === null || t.close_ms > LIMIT);
console.log(JSON.stringify({ base: BASE, reps: REPS, threshold_ms: LIMIT, pass: fail.length === 0, failures: fail, summary }, null, 1));
process.exit(fail.length ? 1 : 0);
