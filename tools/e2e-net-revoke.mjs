import { createRequire } from 'module'; const { chromium } = createRequire(import.meta.url)(process.env.PW ?? 'playwright-core');
/**
 * U5 client (?net=1 only): when A's session is revoked FROM ANOTHER CONTEXT (a second sign-in of A in Node, then
 * revoke-other-sessions / revoke-sessions), A's UI must go offline within 2 s: HUD chip no longer "En ligne", remote
 * avatars (net-*) gone from the scene, no reconnect, sign-in form offered again. Times are measured in the page (shared
 * wall clock with Node) from the revoke request start; the native WebSocket 'close' event time is recorded too.
 * usage: node tools/e2e-net-revoke.mjs <app url> <server url> <emailA> <emailB> <password> [reps=4]
 * Server rate limit: 5 sign-ins / IP, window restarted by each request -> reps spaced > 60 s (REP_GAP_MS).
 */
const [url, server, emailA, emailB, password, repsArg] = process.argv.slice(2);
const REPS = Number(repsArg ?? 4), LIMIT_MS = 2000;
const b = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const results = []; const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (extra !== undefined ? ' ' + JSON.stringify(extra) : '')); results.push({ ok: !!c, test: m }); if (!c) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const origin = new URL(url).origin;

async function page(u) {
  const ctx = await b.newContext({ viewport: { width: 1000, height: 640 } });
  const p = await ctx.newPage(); const errs = []; const sockets = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('websocket', (w) => sockets.push(w.url()));
  await p.goto(u); await p.waitForFunction(() => window.game?.s.ready, null, { timeout: 180000 }); await p.waitForTimeout(1500);
  return { ctx, p, errs, sockets };
}
const signIn = async (P, email) => {
  await P.p.waitForSelector('[data-net-login]', { timeout: 30000 }).catch(async (e) => { console.log('no sign-in form', JSON.stringify(await P.p.evaluate(() => ({ status: window.__live?.status, why: window.__live?.lastError, rc: window.__live?.['rc']?.state })))); throw e; });
  await P.p.fill('[data-net-login] input[name=email]', email); await P.p.fill('[data-net-login] input[name=password]', password);
  await P.p.click('[data-net-login] button');
};
const hasAvatar = (P, id) => P.p.evaluate((id) => { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (o.userData?.avatarId === 'net-' + id) f = true; }); return f; }, id);
const online = (P) => P.p.waitForFunction(() => window.__live.status === 'online' && window.__live.sync.remotes.size >= 1 && /En ligne/.test(document.querySelector('.chip.net')?.textContent ?? ''), null, { timeout: 25000 }).then(() => true, () => false);
/** Second session of A, outside the browser ("another context"): returns its cookie header. */
async function nodeSession(email) {
  const r = await fetch(`${server}/api/auth/sign-in/email`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ email, password }) });
  if (r.status !== 200) throw new Error('node sign-in ' + r.status + ' ' + (await r.text()).slice(0, 120));
  return r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
}

const on = `${url}?net=1&lieu=beach&server=${encodeURIComponent(server)}`;
const A = await page(on), B = await page(on);
await signIn(A, emailA); await signIn(B, emailB);
ok(await online(A) && await online(B), 'setup: A and B signed in through the dev form, online, see each other');
const bId = await B.p.evaluate(() => window.__live.sync.you), aId = await A.p.evaluate(() => window.__live.sync.you);
const times = [];
for (let rep = 0; rep < REPS; rep++) {
  const how = rep % 2 ? 'revoke-sessions' : 'revoke-other-sessions';
  if (rep) { await sleep(Number(process.env.REP_GAP_MS ?? 65000)); await signIn(A, emailA); if (!(await online(A))) { ok(false, `rep ${rep + 1}: A back online after re-sign-in`, await A.p.evaluate(() => ({ status: window.__live.status, why: window.__live.lastError, form: document.querySelector('[data-net-login] [data-err]')?.textContent ?? null }))); break; } }
  await A.p.waitForFunction((id) => { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (o.userData?.avatarId === 'net-' + id) f = true; }); return f; }, bId, { timeout: 30000 }).catch(() => {});
  ok(await hasAvatar(A, bId), `rep ${rep + 1}: before revoke, A shows B's avatar`);
  const cookie = await nodeSession(emailA);
  const wsBefore = A.sockets.length;
  // watcher in A: first wall-clock time each UI condition holds (checked every animation frame + 5 ms timer)
  await A.p.evaluate(() => {
    const w = (window.__u5 = { hudOff: 0, avatarsGone: 0, status: 0, wsClose: 0 });
    window.__live['rc'].ws?.addEventListener('close', () => { w.wsClose = Date.now(); });
    const check = () => {
      const now = Date.now();
      if (!w.status && window.__live.status !== 'online') w.status = now;
      if (!w.hudOff && !/En ligne/.test(document.querySelector('.chip.net')?.textContent ?? '')) w.hudOff = now;
      if (!w.avatarsGone) { let sc = window.__cam; while (sc?.parent) sc = sc.parent; let f = false; sc?.traverse((o) => { if (String(o.userData?.avatarId ?? '').startsWith('net-')) f = true; }); if (!f && window.__live.sync.remotes.size === 0) w.avatarsGone = now; }
    };
    const raf = () => { check(); if (!(w.hudOff && w.avatarsGone && w.wsClose)) requestAnimationFrame(raf); };
    requestAnimationFrame(raf); const iv = setInterval(() => { check(); if (w.hudOff && w.avatarsGone && w.wsClose) clearInterval(iv); }, 5);
  });
  const t0 = Date.now();
  const r = await fetch(`${server}/api/auth/${how}`, { method: 'POST', headers: { 'content-type': 'application/json', origin, cookie }, body: '{}' });
  const tResp = Date.now();
  await A.p.waitForFunction(() => window.__u5.hudOff && window.__u5.avatarsGone && window.__u5.wsClose, null, { timeout: 15000 }).catch(() => {});
  const u = await A.p.evaluate(() => window.__u5);
  const d = (t) => (t ? t - t0 : null);
  const m = { how, http: r.status, response: tResp - t0, status: d(u.status), hudOff: d(u.hudOff), avatarsGone: d(u.avatarsGone), nativeClose: d(u.wsClose) };
  times.push(m);
  ok(r.status === 200 && m.hudOff != null && m.hudOff < LIMIT_MS && m.avatarsGone != null && m.avatarsGone < LIMIT_MS, `rep ${rep + 1}: ${how} -> A offline (HUD) and remote avatars gone in < ${LIMIT_MS} ms`, m);
  await sleep(4000);   // no reconnect: still offline, no new socket, sign-in form offered, B no longer sees A
  const s = await A.p.evaluate(() => ({ status: window.__live.status, why: window.__live.lastError, rc: window.__live['rc'].state, form: !!document.querySelector('[data-net-login]'), chip: document.querySelector('.chip.net')?.textContent }));
  ok(s.status === 'offline' && s.rc === 'stopped' && A.sockets.length === wsBefore && s.form, `rep ${rep + 1}: no auto-reconnect after revoke (late onclose ignored), sign-in form offered`, { ...s, newSockets: A.sockets.length - wsBefore });
  ok(!(await hasAvatar(B, aId)) && await B.p.evaluate(() => window.__live.status === 'online'), `rep ${rep + 1}: B stays online and no longer shows A`);
}
const st = (k) => { const v = times.map((t) => t[k]).filter((x) => x != null).sort((a, b) => a - b); return v.length ? { min: v[0], median: v[Math.floor((v.length - 1) / 2)], max: v.at(-1) } : null; };
console.log('TIMES ms (from revoke request start):', JSON.stringify({ n: times.length, response: st('response'), hudOff: st('hudOff'), avatarsGone: st('avatarsGone'), nativeClose: st('nativeClose') }));
ok(A.errs.length === 0 && B.errs.length === 0, 'no page error', [...A.errs, ...B.errs]);
await b.close();
const pass = results.filter((r) => r.ok).length; console.log(`SUMMARY net-revoke: ${pass}/${results.length} passed`);
